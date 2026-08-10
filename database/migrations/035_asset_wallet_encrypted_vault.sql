-- Local canonical sequence was renumbered from 021 to 035 to remove the
-- duplicate migration number with 021_go_agent_core.sql. Production Supabase
-- history remains 20260804141000_asset_wallet_encrypted_vault.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS public.asset_wallet_secrets (
  wallet_id UUID PRIMARY KEY REFERENCES public.asset_wallets(wallet_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.web3_users(user_id) ON DELETE CASCADE,
  encrypted_envelope JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS asset_wallet_secrets_user_idx
  ON public.asset_wallet_secrets (user_id);

ALTER TABLE public.asset_wallet_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.asset_wallet_secrets FROM anon, authenticated;

COMMIT;
