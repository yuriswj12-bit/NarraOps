BEGIN;

CREATE TYPE agent_task_status AS ENUM (
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled'
);

CREATE TABLE agent_tasks (
  task_id UUID PRIMARY KEY,
  request_id VARCHAR(128) NOT NULL,
  task_type VARCHAR(100) NOT NULL,
  status agent_task_status NOT NULL DEFAULT 'queued',
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  failure JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX agent_tasks_status_created_idx ON agent_tasks (status, created_at);
CREATE INDEX agent_tasks_request_id_idx ON agent_tasks (request_id);

CREATE TABLE agent_task_events (
  event_id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
  event_type VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_task_events_task_created_idx ON agent_task_events (task_id, created_at);

CREATE TABLE narrative_artifacts (
  narrative_id UUID PRIMARY KEY,
  source_task_id UUID NOT NULL REFERENCES agent_tasks(task_id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE launch_packages (
  package_id UUID PRIMARY KEY,
  source_task_id UUID NOT NULL REFERENCES agent_tasks(task_id),
  chain VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL,
  executable BOOLEAN NOT NULL DEFAULT FALSE CHECK (executable = FALSE),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
