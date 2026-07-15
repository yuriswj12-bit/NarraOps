BEGIN;

CREATE TYPE execution_simulation_status AS ENUM (
  'planned',
  'validating',
  'simulated',
  'requires_user_confirmation',
  'signing_disabled',
  'broadcasting_disabled',
  'failed_simulation',
  'cancelled'
);

CREATE TABLE execution_simulations (
  simulation_id UUID PRIMARY KEY,
  source_task_id UUID NOT NULL REFERENCES agent_tasks(task_id),
  simulation_type VARCHAR(64) NOT NULL CHECK (simulation_type IN (
    'wallet_group_create_simulation',
    'transfer_simulation',
    'withdraw_simulation',
    'launch_simulation',
    'batch_buy_simulation',
    'batch_sell_simulation'
  )),
  execution_mode VARCHAR(16) NOT NULL CHECK (execution_mode IN ('simulation', 'disabled')),
  execution_status execution_simulation_status NOT NULL,
  requires_user_confirmation BOOLEAN NOT NULL,
  signing_status execution_simulation_status NOT NULL DEFAULT 'signing_disabled',
  broadcasting_status execution_simulation_status NOT NULL DEFAULT 'broadcasting_disabled',
  intent JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (signing_status = 'signing_disabled'),
  CHECK (broadcasting_status = 'broadcasting_disabled')
);

CREATE INDEX execution_simulations_task_idx ON execution_simulations (source_task_id, created_at);
CREATE INDEX execution_simulations_status_idx ON execution_simulations (execution_status, created_at);

COMMIT;
