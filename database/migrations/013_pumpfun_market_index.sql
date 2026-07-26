create table if not exists public.pulse_pumpfun_market_observations (
  observation_bucket timestamptz primary key,
  observed_at timestamptz not null default now(),
  daily_tokens_created bigint not null check (daily_tokens_created >= 0),
  tokens_launched_24h bigint not null check (tokens_launched_24h >= 0),
  graduated_tokens_24h bigint not null check (graduated_tokens_24h >= 0),
  daily_active_wallets bigint not null check (daily_active_wallets >= 0),
  daily_revenue_usd numeric not null check (daily_revenue_usd >= 0),
  daily_tokens_created_score numeric check (daily_tokens_created_score between 0 and 100),
  tokens_launched_24h_score numeric check (tokens_launched_24h_score between 0 and 100),
  graduated_tokens_24h_score numeric check (graduated_tokens_24h_score between 0 and 100),
  daily_active_wallets_score numeric check (daily_active_wallets_score between 0 and 100),
  daily_revenue_usd_score numeric check (daily_revenue_usd_score between 0 and 100),
  market_activity_index numeric check (market_activity_index between 0 and 100),
  calculation_status text not null check (
    calculation_status in ('partial_data', 'beta', 'ready')
  ),
  component_status jsonb not null default '{}'::jsonb,
  source_status jsonb not null default '{}'::jsonb
);

create index if not exists pulse_pumpfun_market_observations_observed_at_idx
  on public.pulse_pumpfun_market_observations (observed_at desc);

alter table public.pulse_pumpfun_market_observations enable row level security;

comment on table public.pulse_pumpfun_market_observations is
  'Aggregate Pump.fun market snapshots from public Dune queries; no raw token dataset is stored.';
