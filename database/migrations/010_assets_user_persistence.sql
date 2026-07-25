BEGIN;

CREATE TABLE IF NOT EXISTS public.asset_wallet_groups (
  group_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.web3_users(user_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  purpose TEXT NOT NULL DEFAULT 'general' CHECK (purpose IN ('general', 'cooking')),
  network TEXT NOT NULL CHECK (network IN ('solana', 'evm')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_wallet_groups_user_idx
  ON public.asset_wallet_groups (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.asset_wallets (
  wallet_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.asset_wallet_groups(group_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.web3_users(user_id) ON DELETE CASCADE,
  wallet_index INTEGER NOT NULL CHECK (wallet_index > 0),
  public_address TEXT,
  provisioning_status TEXT NOT NULL DEFAULT 'planned'
    CHECK (provisioning_status IN ('planned', 'active', 'archived')),
  signer_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, wallet_index)
);

CREATE INDEX IF NOT EXISTS asset_wallets_user_group_idx
  ON public.asset_wallets (user_id, group_id);

CREATE TABLE IF NOT EXISTS public.asset_transfer_plans (
  transfer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.web3_users(user_id) ON DELETE CASCADE,
  source_group_id UUID REFERENCES public.asset_wallet_groups(group_id),
  destination_group_id UUID REFERENCES public.asset_wallet_groups(group_id),
  chain TEXT NOT NULL CHECK (chain IN ('solana', 'bsc')),
  amount TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'signing', 'submitted', 'confirmed', 'failed', 'cancelled')),
  idempotency_key TEXT NOT NULL,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, idempotency_key)
);

ALTER TABLE public.asset_wallet_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_transfer_plans ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.asset_wallet_groups FROM anon, authenticated;
REVOKE ALL ON public.asset_wallets FROM anon, authenticated;
REVOKE ALL ON public.asset_transfer_plans FROM anon, authenticated;

COMMIT;
