BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.web3_users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.web3_identities (
  identity_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.web3_users(user_id) ON DELETE CASCADE,
  chain TEXT NOT NULL CHECK (chain IN ('evm', 'solana')),
  address TEXT NOT NULL,
  address_normalized TEXT NOT NULL,
  chain_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chain, address_normalized)
);

CREATE INDEX IF NOT EXISTS web3_identities_user_idx
  ON public.web3_identities (user_id);

CREATE TABLE IF NOT EXISTS public.web3_auth_challenges (
  challenge_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain TEXT NOT NULL CHECK (chain IN ('evm', 'solana')),
  address TEXT NOT NULL,
  address_normalized TEXT NOT NULL,
  chain_id BIGINT,
  message TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web3_auth_challenges_expiry_idx
  ON public.web3_auth_challenges (expires_at);

CREATE TABLE IF NOT EXISTS public.web3_sessions (
  session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.web3_users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS web3_sessions_user_idx
  ON public.web3_sessions (user_id);

ALTER TABLE public.web3_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web3_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web3_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.web3_sessions ENABLE ROW LEVEL SECURITY;

-- These tables are private to the NarraOps API. No anon/authenticated policies
-- are created; the server-side Supabase secret key is required.
REVOKE ALL ON public.web3_users FROM anon, authenticated;
REVOKE ALL ON public.web3_identities FROM anon, authenticated;
REVOKE ALL ON public.web3_auth_challenges FROM anon, authenticated;
REVOKE ALL ON public.web3_sessions FROM anon, authenticated;

COMMIT;
