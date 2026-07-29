alter table public.pulse_dev_wallet_sample
  add column if not exists pnl_last_collected_at timestamptz,
  add column if not exists pnl_collection_failures integer not null default 0
    check (pnl_collection_failures >= 0),
  add column if not exists pnl_next_retry_at timestamptz;

create index if not exists pulse_dev_wallet_sample_pnl_queue_idx
  on public.pulse_dev_wallet_sample (
    status,
    tier,
    pnl_next_retry_at,
    pnl_last_collected_at
  );

create or replace function public.mark_pulse_dev_pnl_wallet_collection(
  p_creator_wallet text,
  p_collected_at timestamptz,
  p_complete boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pulse_dev_wallet_sample
  set
    pnl_last_collected_at = case
      when p_complete then p_collected_at
      else pnl_last_collected_at
    end,
    pnl_collection_failures = case
      when p_complete then 0
      else pnl_collection_failures + 1
    end,
    pnl_next_retry_at = case
      when p_complete then null
      else p_collected_at + least(
        interval '6 hours',
        interval '15 minutes' * power(2, least(pnl_collection_failures, 4))::double precision
      )
    end,
    last_seen_at = greatest(last_seen_at, p_collected_at),
    updated_at = now()
  where creator_wallet = p_creator_wallet;
end;
$$;

create or replace function public.refresh_pulse_dev_wallet_pnl_snapshots(
  p_snapshot_at timestamptz,
  p_collection_run_id bigint
)
returns setof public.pulse_dev_wallet_pnl_snapshots
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with frames(timeframe, freshness) as (
    values
      ('24h'::text, interval '6 hours'),
      ('7d'::text, interval '24 hours'),
      ('30d'::text, interval '72 hours')
  ),
  eligible as (
    select count(*)::integer as wallet_count
    from public.pulse_dev_wallet_sample
    where status = 'active'
  ),
  latest as (
    select distinct on (p.timeframe, p.creator_wallet)
      p.timeframe,
      p.creator_wallet,
      p.realized_pnl_usd,
      s.tier
    from public.pulse_dev_wallet_period_pnl p
    join public.pulse_dev_wallet_sample s
      on s.creator_wallet = p.creator_wallet
     and s.status = 'active'
    join frames f on f.timeframe = p.timeframe
    where p.source_status = 'complete'
      and p.observed_at <= p_snapshot_at
      and p.observed_at >= p_snapshot_at - f.freshness
    order by p.timeframe, p.creator_wallet, p.observed_at desc
  ),
  aggregate_rows as (
    select
      f.timeframe,
      count(l.creator_wallet)::integer as included_wallet_count,
      coalesce(sum(l.realized_pnl_usd), 0)::numeric as total_pnl,
      count(*) filter (where l.realized_pnl_usd > 0)::integer as profitable_count,
      count(*) filter (where l.realized_pnl_usd < 0)::integer as losing_count,
      count(*) filter (where l.realized_pnl_usd = 0)::integer as zero_count,
      coalesce(sum(l.realized_pnl_usd) filter (where l.tier = 'A-Core'), 0)::numeric as a_core,
      coalesce(sum(l.realized_pnl_usd) filter (where l.tier = 'B-Primary'), 0)::numeric as b_primary,
      coalesce(sum(l.realized_pnl_usd) filter (where l.tier = 'C-Watch'), 0)::numeric as c_watch
    from frames f
    left join latest l on l.timeframe = f.timeframe
    group by f.timeframe
  ),
  inserted as (
    insert into public.pulse_dev_wallet_pnl_snapshots (
      snapshot_at,
      timeframe,
      total_realized_pnl_usd,
      included_wallet_count,
      profitable_wallet_count,
      losing_wallet_count,
      zero_pnl_wallet_count,
      a_core_pnl_usd,
      b_primary_pnl_usd,
      c_watch_pnl_usd,
      eligible_wallet_count,
      data_coverage_pct,
      source_status,
      collection_run_id
    )
    select
      p_snapshot_at,
      a.timeframe,
      a.total_pnl,
      a.included_wallet_count,
      a.profitable_count,
      a.losing_count,
      a.zero_count,
      a.a_core,
      a.b_primary,
      a.c_watch,
      e.wallet_count,
      case
        when e.wallet_count = 0 then 0
        else least(100, a.included_wallet_count * 100.0 / e.wallet_count)
      end,
      case
        when a.included_wallet_count = 0 then 'warming_up'
        when a.included_wallet_count * 100.0 / greatest(e.wallet_count, 1) >= 90 then 'ready'
        else 'partial'
      end,
      p_collection_run_id
    from aggregate_rows a
    cross join eligible e
    on conflict (snapshot_at, timeframe) do update set
      total_realized_pnl_usd = excluded.total_realized_pnl_usd,
      included_wallet_count = excluded.included_wallet_count,
      profitable_wallet_count = excluded.profitable_wallet_count,
      losing_wallet_count = excluded.losing_wallet_count,
      zero_pnl_wallet_count = excluded.zero_pnl_wallet_count,
      a_core_pnl_usd = excluded.a_core_pnl_usd,
      b_primary_pnl_usd = excluded.b_primary_pnl_usd,
      c_watch_pnl_usd = excluded.c_watch_pnl_usd,
      eligible_wallet_count = excluded.eligible_wallet_count,
      data_coverage_pct = excluded.data_coverage_pct,
      source_status = excluded.source_status,
      collection_run_id = excluded.collection_run_id
    returning *
  )
  select * from inserted order by timeframe;
end;
$$;

revoke all on function public.mark_pulse_dev_pnl_wallet_collection(text, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.refresh_pulse_dev_wallet_pnl_snapshots(timestamptz, bigint)
  from public, anon, authenticated;
grant execute on function public.mark_pulse_dev_pnl_wallet_collection(text, timestamptz, boolean)
  to service_role;
grant execute on function public.refresh_pulse_dev_wallet_pnl_snapshots(timestamptz, bigint)
  to service_role;

comment on function public.refresh_pulse_dev_wallet_pnl_snapshots(timestamptz, bigint) is
  'Aggregates only the latest fresh real observation per active wallet. Freshness: 6h for 24h PnL, 24h for 7d, and 72h for 30d.';
