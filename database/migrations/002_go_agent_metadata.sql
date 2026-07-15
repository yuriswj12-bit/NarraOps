BEGIN;

ALTER TABLE agent_tasks
  ADD COLUMN requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN execution_mode VARCHAR(16) NOT NULL DEFAULT 'mock'
    CHECK (execution_mode IN ('mock', 'simulation', 'disabled')),
  ADD COLUMN parsed_input JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX agent_tasks_execution_mode_idx
  ON agent_tasks (execution_mode, status, created_at);

COMMIT;
