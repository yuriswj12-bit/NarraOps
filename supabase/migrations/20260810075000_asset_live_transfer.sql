-- NarraOps live asset transfer persistence. Service-role only.
-- Distinct from the legacy planning-only transfer_previews/transfers tables.

create table if not exists public.asset_transfer_previews (
  preview_token uuid primary key,
  confirmation_token uuid not null,
  user_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'),
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  destination jsonb not null check (jsonb_typeof(destination) = 'object'),
  amount_mode text not null check (amount_mode in ('fraction', 'amount')),
  requested_amount text null,
  fraction_bps integer null check (fraction_bps is null or (fraction_bps between 1 and 10000)),
  estimated_amount text not null,
  allocations jsonb not null check (jsonb_typeof(allocations) = 'array'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists asset_transfer_previews_user_idx
  on public.asset_transfer_previews (user_id, created_at desc);

create table if not exists public.asset_transfers (
  transfer_id uuid primary key,
  user_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'),
  preview_token uuid not null references public.asset_transfer_previews(preview_token),
  status text not null check (status in ('submitted', 'confirmed', 'partially_failed', 'failed')),
  submitted boolean not null default false,
  confirmed boolean not null default false,
  transactions jsonb not null default '[]'::jsonb,
  tx_hash text null,
  error jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists asset_transfers_user_idx
  on public.asset_transfers (user_id, created_at desc);

alter table public.asset_transfer_previews enable row level security;
alter table public.asset_transfers enable row level security;

revoke all on public.asset_transfer_previews from anon, authenticated;
revoke all on public.asset_transfers from anon, authenticated;

comment on table public.asset_transfer_previews is
  'Live transfer previews with confirmation tokens for actor-owned wallet groups.';
comment on table public.asset_transfers is
  'Live executed transfer records with per-allocation outcomes.';
