create table if not exists public.pulse_dev_wallets (
  chain text not null check (chain = 'solana'),
  wallet_address text not null,
  first_launch_at timestamptz not null,
  last_launch_at timestamptz not null,
  total_launch_count bigint not null default 0 check (total_launch_count >= 0),
  launch_count_15d bigint not null default 0 check (launch_count_15d >= 0),
  launch_count_30d bigint not null default 0 check (launch_count_30d >= 0),
  lifecycle_status text not null default 'observed'
    check (lifecycle_status in ('observed', 'recent', 'long_term', 'inactive')),
  source text not null,
  updated_at timestamptz not null default now(),
  primary key (chain, wallet_address)
);

create table if not exists public.pulse_launch_events (
  chain text not null check (chain = 'solana'),
  token_address text not null,
  creator_address text not null,
  launchpad_platform text,
  launched_at timestamptz not null,
  graduated_at timestamptz,
  source text not null,
  source_coverage text not null
    check (source_coverage in ('bounded_sample', 'complete')),
  observed_at timestamptz not null default now(),
  primary key (chain, token_address)
);

create index if not exists pulse_launch_events_creator_launched_idx
  on public.pulse_launch_events (creator_address, launched_at desc);

create table if not exists public.pulse_market_observations (
  observed_on date primary key,
  long_term_dev_count bigint check (long_term_dev_count >= 0),
  recent_dev_count bigint check (recent_dev_count >= 0),
  daily_launch_count bigint check (daily_launch_count >= 0),
  graduated_count bigint check (graduated_count >= 0),
  dex_volume_usd numeric check (dex_volume_usd >= 0),
  long_term_dev_score numeric check (long_term_dev_score between 0 and 100),
  recent_dev_score numeric check (recent_dev_score between 0 and 100),
  daily_launch_score numeric check (daily_launch_score between 0 and 100),
  graduated_score numeric check (graduated_score between 0 and 100),
  dex_volume_score numeric check (dex_volume_score between 0 and 100),
  market_activity_index numeric check (market_activity_index between 0 and 100),
  calculation_status text not null
    check (calculation_status in ('partial_data', 'insufficient_history', 'ready')),
  component_status jsonb not null default '{}'::jsonb,
  source_status jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);

alter table public.pulse_dev_wallets enable row level security;
alter table public.pulse_launch_events enable row level security;
alter table public.pulse_market_observations enable row level security;

-- These tables are worker-written and server-read. No direct browser policy is
-- created; the service role bypasses RLS and the public API exposes a bounded
-- read model.

create or replace function public.refresh_pulse_dev_wallets(
  p_observed_at timestamptz default now(),
  p_long_term_age_days integer default 60,
  p_long_term_window_days integer default 15,
  p_long_term_daily_launches integer default 20,
  p_recent_age_days integer default 10,
  p_inactive_days integer default 10
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.pulse_dev_wallets (
    chain,
    wallet_address,
    first_launch_at,
    last_launch_at,
    total_launch_count,
    launch_count_15d,
    launch_count_30d,
    lifecycle_status,
    source,
    updated_at
  )
  select
    chain,
    creator_address,
    min(launched_at),
    max(launched_at),
    count(*)::bigint,
    count(*) filter (
      where launched_at >= p_observed_at - make_interval(days => p_long_term_window_days)
    )::bigint,
    count(*) filter (
      where launched_at >= p_observed_at - interval '30 days'
    )::bigint,
    case
      when max(launched_at) <= p_observed_at - make_interval(days => p_inactive_days)
        then 'inactive'
      when min(launched_at) <= p_observed_at - make_interval(days => p_long_term_age_days)
        and count(*) filter (
          where launched_at >= p_observed_at - make_interval(days => p_long_term_window_days)
        ) >= p_long_term_window_days * p_long_term_daily_launches
        then 'long_term'
      when min(launched_at) >= p_observed_at - make_interval(days => p_recent_age_days)
        then 'recent'
      else 'observed'
    end,
    'gmgn',
    p_observed_at
  from public.pulse_launch_events
  group by chain, creator_address
  on conflict (chain, wallet_address) do update set
    first_launch_at = excluded.first_launch_at,
    last_launch_at = excluded.last_launch_at,
    total_launch_count = excluded.total_launch_count,
    launch_count_15d = excluded.launch_count_15d,
    launch_count_30d = excluded.launch_count_30d,
    lifecycle_status = excluded.lifecycle_status,
    source = excluded.source,
    updated_at = excluded.updated_at;
$$;

revoke all on function public.refresh_pulse_dev_wallets(
  timestamptz, integer, integer, integer, integer, integer
) from public, anon, authenticated;

