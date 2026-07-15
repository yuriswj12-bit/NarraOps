BEGIN;

CREATE TABLE agent_conversations (
  conversation_id UUID PRIMARY KEY,
  actor_id VARCHAR(128),
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_messages (
  message_id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES agent_conversations(conversation_id),
  task_id UUID REFERENCES agent_tasks(task_id),
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_messages_conversation_idx ON agent_messages (conversation_id, created_at);

CREATE TABLE dev_wallets (
  dev_wallet_id UUID PRIMARY KEY,
  chain VARCHAR(24) NOT NULL CHECK (chain IN ('solana', 'bsc', 'robinhood')),
  address VARCHAR(128) NOT NULL,
  labels JSONB NOT NULL DEFAULT '[]'::jsonb,
  source VARCHAR(32) NOT NULL DEFAULT 'gmgn',
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  enrichment_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  UNIQUE (chain, address)
);

CREATE TABLE dev_wallet_tokens (
  dev_wallet_id UUID NOT NULL REFERENCES dev_wallets(dev_wallet_id),
  token_address VARCHAR(128) NOT NULL,
  symbol VARCHAR(32),
  name VARCHAR(128),
  launchpad_platform VARCHAR(64),
  launched_at TIMESTAMPTZ,
  PRIMARY KEY (dev_wallet_id, token_address)
);

CREATE TABLE dev_wallet_snapshots (
  snapshot_id UUID PRIMARY KEY,
  dev_wallet_id UUID NOT NULL REFERENCES dev_wallets(dev_wallet_id),
  realized_pnl_usd NUMERIC,
  unrealized_pnl_usd NUMERIC,
  creator_hold_rate NUMERIC,
  creator_token_status VARCHAR(64),
  raw_source JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX dev_wallet_snapshots_wallet_idx ON dev_wallet_snapshots (dev_wallet_id, observed_at DESC);

CREATE TABLE launch_drafts (
  launch_draft_id UUID PRIMARY KEY,
  actor_id VARCHAR(128),
  chain VARCHAR(24) NOT NULL CHECK (chain IN ('solana', 'bsc', 'robinhood')),
  platform_id VARCHAR(32) NOT NULL CHECK (platform_id IN ('pump', 'fourmeme', 'noxa')),
  narrative_url TEXT,
  narrative_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  token_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dev_wallet_reference VARCHAR(128),
  wallet_group_reference VARCHAR(128),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  confirmation_status VARCHAR(32) NOT NULL DEFAULT 'not_confirmed',
  execution_mode VARCHAR(16) NOT NULL DEFAULT 'disabled' CHECK (execution_mode = 'disabled'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wallet_provider_references (
  wallet_reference_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  provider VARCHAR(32) NOT NULL CHECK (provider IN ('external_wallet', 'privy_embedded')),
  provider_wallet_id VARCHAR(256) NOT NULL,
  chain VARCHAR(24) NOT NULL CHECK (chain IN ('solana', 'bsc', 'robinhood')),
  public_address VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_wallet_id, chain)
);

COMMENT ON TABLE wallet_provider_references IS 'Stores provider IDs and public addresses only; never raw private keys or seed phrases.';

COMMIT;
