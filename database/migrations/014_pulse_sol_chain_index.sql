alter table public.pulse_pumpfun_market_observations
  alter column daily_tokens_created drop not null,
  alter column tokens_launched_24h drop not null,
  alter column graduated_tokens_24h drop not null,
  alter column daily_active_wallets drop not null,
  alter column daily_revenue_usd drop not null,
  add column if not exists launched_tokens_24h bigint,
  add column if not exists active_wallets_24h bigint,
  add column if not exists launch_score numeric,
  add column if not exists graduation_score numeric,
  add column if not exists active_wallet_score numeric,
  add column if not exists market_activity_index_raw numeric,
  add column if not exists market_activity_index_display integer,
  add column if not exists baseline_sample_count integer,
  add column if not exists history_coverage numeric,
  add column if not exists history_status text,
  add column if not exists sampling_audit jsonb not null default '{}'::jsonb,
  add column if not exists index_method_version text not null default 'solana-percentile-v1';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pulse_market_index_display_range'
  ) then
    alter table public.pulse_pumpfun_market_observations
      add constraint pulse_market_index_display_range
      check (market_activity_index_display between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'pulse_market_history_status'
  ) then
    alter table public.pulse_pumpfun_market_observations
      add constraint pulse_market_history_status
      check (history_status in ('insufficient', 'warming_up', 'partial', 'ready'));
  end if;
end $$;

comment on table public.pulse_pumpfun_market_observations is
  'Hourly Pump.fun market snapshots. New solana-percentile-v1 rows use direct chain observations and auditable sampling metadata.';
