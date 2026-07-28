alter table public.pulse_pumpfun_market_observations
  alter column calculation_status drop not null,
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

create table if not exists public.pulse_pumpfun_chain_events (
  signature text not null,
  instruction_path text not null,
  event_type text not null check (event_type in ('create', 'migrate', 'buy', 'sell')),
  slot bigint not null,
  block_time timestamptz not null,
  mint text not null,
  user_address text not null,
  creator_address text,
  sampled boolean not null default false,
  parser_version text not null default 'pump-idl-2026-07',
  created_at timestamptz not null default now(),
  primary key (signature, instruction_path, event_type)
);

create index if not exists pulse_pumpfun_chain_events_time_idx
  on public.pulse_pumpfun_chain_events (block_time desc);
create index if not exists pulse_pumpfun_chain_events_mint_idx
  on public.pulse_pumpfun_chain_events (mint, event_type);

create table if not exists public.pulse_wallet_sample_panel (
  address text primary key,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  included_at timestamptz,
  removed_at timestamptz,
  panel_version text not null,
  status text not null check (status in ('candidate', 'included', 'removed')),
  updated_at timestamptz not null default now()
);

create table if not exists public.pulse_chain_collection_state (
  collector_id text primary key,
  provider text not null,
  pagination_token text,
  latest_slot bigint,
  latest_signature text,
  last_success_at timestamptz,
  sampling_rate_bps integer not null check (sampling_rate_bps between 0 and 10000),
  parser_version text not null,
  coverage_status text not null,
  updated_at timestamptz not null default now()
);

alter table public.pulse_pumpfun_chain_events enable row level security;
alter table public.pulse_wallet_sample_panel enable row level security;
alter table public.pulse_chain_collection_state enable row level security;
