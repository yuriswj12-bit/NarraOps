create table if not exists public.pulse_dev_wallet_sample (
  creator_wallet text primary key,
  total_tokens integer not null check (total_tokens >= 0),
  rugged_tokens integer not null check (rugged_tokens >= 0 and rugged_tokens <= total_tokens),
  rug_percentage numeric not null check (rug_percentage between 0 and 100),
  wilson_lower_pct numeric not null check (wilson_lower_pct between 0 and 100),
  sample_score numeric not null,
  tier text not null check (tier in ('A-Core', 'B-Primary', 'C-Watch')),
  sample_status text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_launch_at timestamptz,
  consecutive_active_runs integer not null default 0 check (consecutive_active_runs >= 0),
  consecutive_inactive_runs integer not null default 0 check (consecutive_inactive_runs >= 0),
  status text not null default 'active'
    check (status in ('candidate', 'active', 'inactive', 'archived')),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pulse_dev_wallet_sample_status_tier_idx
  on public.pulse_dev_wallet_sample (status, tier);
create index if not exists pulse_dev_wallet_sample_last_seen_idx
  on public.pulse_dev_wallet_sample (last_seen_at desc);

comment on table public.pulse_dev_wallet_sample is
  'Versioned NarraOps Dev-wallet panel. Rows are retained through inactive and archived states rather than deleted.';

create table if not exists public.pulse_dev_wallet_period_pnl (
  creator_wallet text not null
    references public.pulse_dev_wallet_sample (creator_wallet) on delete restrict,
  timeframe text not null check (timeframe in ('24h', '7d', '30d')),
  observed_at timestamptz not null,
  realized_pnl_usd numeric not null,
  buy_usd numeric,
  sell_usd numeric,
  bought_cost_usd numeric,
  sold_income_usd numeric,
  last_activity_at timestamptz,
  data_source text not null default 'gmgn-portfolio-stats',
  source_period text not null check (source_period in ('1d', '7d', '30d')),
  source_status text not null default 'complete'
    check (source_status in ('complete', 'partial', 'failed')),
  source_payload jsonb not null default '{}'::jsonb,
  collection_run_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (creator_wallet, timeframe, observed_at)
);

create index if not exists pulse_dev_wallet_period_pnl_window_idx
  on public.pulse_dev_wallet_period_pnl (timeframe, observed_at desc);
create index if not exists pulse_dev_wallet_period_pnl_wallet_idx
  on public.pulse_dev_wallet_period_pnl (creator_wallet, observed_at desc);

comment on table public.pulse_dev_wallet_period_pnl is
  'Signed wallet-level realized PnL returned by GMGN for 1D, 7D, and 30D periods. It is not token-level closed-position PnL.';

create table if not exists public.pulse_dev_pnl_collection_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  requested_timeframes text[] not null default array['24h', '7d', '30d']::text[],
  wallets_attempted integer not null default 0 check (wallets_attempted >= 0),
  wallets_succeeded integer not null default 0 check (wallets_succeeded >= 0),
  wallets_failed integer not null default 0 check (wallets_failed >= 0),
  observations_written integer not null default 0 check (observations_written >= 0),
  snapshots_created integer not null default 0 check (snapshots_created >= 0),
  cursor_wallet text,
  error_summary jsonb not null default '{}'::jsonb,
  collector_version text not null default 'gmgn-wallet-period-v1',
  created_at timestamptz not null default now()
);

alter table public.pulse_dev_wallet_period_pnl
  drop constraint if exists pulse_dev_wallet_period_pnl_collection_run_id_fkey;
alter table public.pulse_dev_wallet_period_pnl
  add constraint pulse_dev_wallet_period_pnl_collection_run_id_fkey
  foreign key (collection_run_id)
  references public.pulse_dev_pnl_collection_runs (id)
  on delete set null;

create index if not exists pulse_dev_pnl_collection_runs_started_idx
  on public.pulse_dev_pnl_collection_runs (started_at desc);

create table if not exists public.pulse_dev_wallet_pnl_snapshots (
  snapshot_at timestamptz not null,
  timeframe text not null check (timeframe in ('24h', '7d', '30d')),
  total_realized_pnl_usd numeric not null,
  included_wallet_count integer not null check (included_wallet_count >= 0),
  profitable_wallet_count integer not null check (profitable_wallet_count >= 0),
  losing_wallet_count integer not null check (losing_wallet_count >= 0),
  zero_pnl_wallet_count integer not null check (zero_pnl_wallet_count >= 0),
  a_core_pnl_usd numeric not null default 0,
  b_primary_pnl_usd numeric not null default 0,
  c_watch_pnl_usd numeric not null default 0,
  eligible_wallet_count integer not null check (eligible_wallet_count >= 0),
  data_coverage_pct numeric not null check (data_coverage_pct between 0 and 100),
  source_status text not null
    check (source_status in ('warming_up', 'partial', 'ready', 'stale')),
  calculation_version text not null default 'gmgn-wallet-period-v1',
  collection_run_id bigint
    references public.pulse_dev_pnl_collection_runs (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (snapshot_at, timeframe)
);

create index if not exists pulse_dev_wallet_pnl_snapshots_range_idx
  on public.pulse_dev_wallet_pnl_snapshots (timeframe, snapshot_at desc);

comment on table public.pulse_dev_wallet_pnl_snapshots is
  'Frontend-ready aggregates of signed GMGN wallet-period realized PnL. Coverage and tier contributions are persisted with every snapshot.';

alter table public.pulse_dev_wallet_sample enable row level security;
alter table public.pulse_dev_wallet_period_pnl enable row level security;
alter table public.pulse_dev_pnl_collection_runs enable row level security;
alter table public.pulse_dev_wallet_pnl_snapshots enable row level security;

revoke all on public.pulse_dev_wallet_sample from anon, authenticated;
revoke all on public.pulse_dev_wallet_period_pnl from anon, authenticated;
revoke all on public.pulse_dev_pnl_collection_runs from anon, authenticated;
revoke all on public.pulse_dev_wallet_pnl_snapshots from anon, authenticated;

