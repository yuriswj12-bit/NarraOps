BEGIN;

CREATE TABLE account_portfolio_snapshots (
  snapshot_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  period VARCHAR(8) NOT NULL CHECK (period IN ('1d', '7d', '30d', 'all')),
  currency VARCHAR(16) NOT NULL,
  total_balance NUMERIC NOT NULL,
  turnover NUMERIC NOT NULL,
  realized_pnl NUMERIC NOT NULL,
  unrealized_pnl NUMERIC NOT NULL,
  pnl_percent NUMERIC NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX account_portfolio_actor_period_idx ON account_portfolio_snapshots (actor_id, period, observed_at DESC);

CREATE TABLE wallet_groups (
  wallet_group_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  name VARCHAR(80) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_id, name)
);

CREATE TABLE wallet_group_wallets (
  wallet_id UUID PRIMARY KEY,
  wallet_group_id UUID NOT NULL REFERENCES wallet_groups(wallet_group_id),
  wallet_reference_id UUID REFERENCES wallet_provider_references(wallet_reference_id),
  label VARCHAR(80) NOT NULL,
  public_address VARCHAR(128) NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0 CHECK (balance >= 0),
  balance_asset VARCHAR(24) NOT NULL,
  provisioning_status VARCHAR(32) NOT NULL CHECK (provisioning_status IN ('pending', 'provider_created', 'simulation_only', 'failed')),
  status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wallet_group_id, public_address)
);

COMMENT ON TABLE wallet_group_wallets IS 'Public/provider wallet references only. Raw private keys, seed phrases, and signing secrets are prohibited.';

CREATE TABLE wallet_delete_confirmations (
  operation_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  wallet_group_id UUID NOT NULL REFERENCES wallet_groups(wallet_group_id),
  confirmation_token_hash CHAR(64) NOT NULL UNIQUE,
  selected_wallet_ids JSONB NOT NULL,
  deletable_wallet_ids JSONB NOT NULL,
  protected_wallet_ids JSONB NOT NULL,
  recovery_strategy VARCHAR(64) NOT NULL CHECK (recovery_strategy = 'archive_zero_balance_wallets'),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE wallet_export_requests (
  export_request_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  wallet_group_id UUID NOT NULL REFERENCES wallet_groups(wallet_group_id),
  reauthenticated_at TIMESTAMPTZ,
  mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  explicit_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  status VARCHAR(32) NOT NULL CHECK (status IN ('rejected', 'disabled', 'preparing', 'ready', 'downloaded', 'expired')),
  encrypted_artifact_reference TEXT,
  one_time_download_token_hash CHAR(64),
  expires_at TIMESTAMPTZ,
  downloaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('rejected', 'disabled')),
  CHECK (status NOT IN ('ready', 'downloaded') OR (encrypted_artifact_reference IS NOT NULL AND one_time_download_token_hash IS NOT NULL))
);

COMMENT ON TABLE wallet_export_requests IS 'Contains audit metadata and encrypted artifact references only; never ordinary JSON private-key material or plaintext download tokens.';

CREATE TABLE transfer_previews (
  transfer_preview_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  confirmation_token_hash CHAR(64) NOT NULL,
  source JSONB NOT NULL,
  destination JSONB NOT NULL,
  amount_mode VARCHAR(16) NOT NULL CHECK (amount_mode IN ('fraction', 'amount')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  fraction_bps INTEGER CHECK (fraction_bps BETWEEN 1 AND 10000),
  distribution VARCHAR(16) NOT NULL CHECK (distribution IN ('random', 'equal')),
  allocation_plan JSONB NOT NULL,
  execution_mode VARCHAR(16) NOT NULL DEFAULT 'disabled' CHECK (execution_mode = 'disabled'),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_id, idempotency_key)
);

CREATE TABLE transfers (
  transfer_id UUID PRIMARY KEY,
  actor_id VARCHAR(128) NOT NULL,
  transfer_preview_id UUID NOT NULL REFERENCES transfer_previews(transfer_preview_id),
  idempotency_key VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('planned', 'signing', 'submitted', 'confirmed', 'failed')),
  execution_mode VARCHAR(16) NOT NULL DEFAULT 'disabled' CHECK (execution_mode = 'disabled'),
  signing_status VARCHAR(32) NOT NULL DEFAULT 'signing_disabled' CHECK (signing_status = 'signing_disabled'),
  broadcasting_status VARCHAR(32) NOT NULL DEFAULT 'broadcasting_disabled' CHECK (broadcasting_status = 'broadcasting_disabled'),
  tx_hash VARCHAR(160),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  failure JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (actor_id, idempotency_key),
  CHECK (execution_mode <> 'disabled' OR status IN ('planned', 'failed')),
  CHECK (status NOT IN ('submitted', 'confirmed') OR (tx_hash IS NOT NULL AND submitted_at IS NOT NULL)),
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL)
);

CREATE TABLE transfer_status_events (
  event_id UUID PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES transfers(transfer_id),
  from_status VARCHAR(16),
  to_status VARCHAR(16) NOT NULL CHECK (to_status IN ('planned', 'signing', 'submitted', 'confirmed', 'failed')),
  reason_code VARCHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX transfer_status_events_transfer_idx ON transfer_status_events (transfer_id, created_at);

CREATE TABLE security_audit_events (
  audit_id UUID PRIMARY KEY,
  actor_id VARCHAR(128),
  request_id VARCHAR(128) NOT NULL,
  event_type VARCHAR(96) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(128),
  outcome VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE security_audit_events IS 'Append-only security audit metadata. Authorization headers, cookies, raw tokens, private keys, and seed phrases are prohibited.';

COMMIT;
