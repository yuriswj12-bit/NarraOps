-- Deployment mirror of database/migrations/023_agent_runtime_durability.sql.
-- NarraOps Agent Runtime v2 durable task transitions and replayable event outbox.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agent_tasks'
      AND column_name = 'status' AND data_type = 'USER-DEFINED'
  ) THEN
    ALTER TABLE public.agent_tasks ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE public.agent_tasks ALTER COLUMN status TYPE text USING status::text;
    ALTER TABLE public.agent_tasks ALTER COLUMN status SET DEFAULT 'queued';
  END IF;
END $$;

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS actor_id uuid NULL,
  ADD COLUMN IF NOT EXISTS client text NULL,
  ADD COLUMN IF NOT EXISTS capability text NULL,
  ADD COLUMN IF NOT EXISTS context_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL,
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lease_owner text NULL,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_tasks'::regclass
      AND conname = 'agent_tasks_runtime_v2_status_check'
  ) THEN
    ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_runtime_v2_status_check
      CHECK (status IN (
        'queued', 'running', 'waiting_input', 'waiting_approval', 'executing',
        'reconciliation_required', 'succeeded', 'failed', 'cancelled', 'expired'
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS agent_tasks_actor_idempotency_idx
  ON public.agent_tasks (actor_id, idempotency_key)
  WHERE actor_id IS NOT NULL AND idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS agent_tasks_recovery_idx
  ON public.agent_tasks (status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS public.agent_event_outbox (
  outbox_sequence bigserial PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  task_id uuid NOT NULL REFERENCES public.agent_tasks(task_id) ON DELETE CASCADE,
  task_sequence integer NOT NULL,
  event_type text NOT NULL,
  aggregate_type text NOT NULL DEFAULT 'task',
  aggregate_id uuid NOT NULL,
  actor_id uuid NULL,
  conversation_id uuid NULL REFERENCES public.agent_conversations(conversation_id) ON DELETE SET NULL,
  trace_id text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz NULL,
  publish_attempts integer NOT NULL DEFAULT 0,
  last_publish_error text NULL,
  UNIQUE (task_id, task_sequence)
);
CREATE INDEX IF NOT EXISTS agent_event_outbox_task_sequence_idx
  ON public.agent_event_outbox (task_id, task_sequence);
CREATE INDEX IF NOT EXISTS agent_event_outbox_unpublished_idx
  ON public.agent_event_outbox (outbox_sequence) WHERE published_at IS NULL;

CREATE TABLE IF NOT EXISTS public.agent_tool_calls (
  tool_call_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.agent_tasks(task_id) ON DELETE CASCADE,
  actor_id uuid NULL,
  tool_name text NOT NULL,
  tool_version text NOT NULL,
  risk text NOT NULL,
  status text NOT NULL,
  input_digest text NOT NULL,
  safe_input jsonb NOT NULL DEFAULT '{}'::jsonb,
  safe_output jsonb NULL,
  failure jsonb NULL,
  approval_id uuid NULL,
  idempotency_key text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  started_at timestamptz NULL,
  completed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS public.agent_artifacts (
  artifact_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.agent_tasks(task_id) ON DELETE CASCADE,
  conversation_id uuid NULL REFERENCES public.agent_conversations(conversation_id) ON DELETE SET NULL,
  actor_id uuid NULL,
  artifact_type text NOT NULL,
  schema_version text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_tool_calls_task_created_idx ON public.agent_tool_calls (task_id, created_at);
CREATE INDEX IF NOT EXISTS agent_artifacts_conversation_updated_idx ON public.agent_artifacts (conversation_id, updated_at DESC);

ALTER TABLE public.agent_event_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_event_outbox FROM anon, authenticated;
REVOKE ALL ON public.agent_tool_calls FROM anon, authenticated;
REVOKE ALL ON public.agent_artifacts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_append_task_event_v2(p_task_id uuid, p_event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  next_sequence integer;
  inserted public.agent_event_outbox;
  task_row public.agent_tasks;
BEGIN
  SELECT * INTO task_row FROM public.agent_tasks WHERE task_id = p_task_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_task_id::text, 0));
  SELECT COALESCE(MAX(task_sequence), 0) + 1 INTO next_sequence
  FROM public.agent_event_outbox WHERE task_id = p_task_id;
  INSERT INTO public.agent_event_outbox (
    event_id, task_id, task_sequence, event_type, aggregate_type,
    aggregate_id, actor_id, conversation_id, trace_id, payload, created_at
  ) VALUES (
    (p_event->>'eventId')::uuid, p_task_id, next_sequence, p_event->>'type',
    COALESCE(p_event->>'aggregateType', 'task'),
    COALESCE((p_event->>'aggregateId')::uuid, p_task_id),
    task_row.actor_id, task_row.conversation_id,
    COALESCE(p_event->>'traceId', task_row.request_id), p_event,
    COALESCE((p_event->>'createdAt')::timestamptz, now())
  )
  ON CONFLICT (event_id) DO UPDATE SET event_id = EXCLUDED.event_id
  RETURNING * INTO inserted;
  RETURN to_jsonb(inserted);
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_transition_task_v2(
  p_task_id uuid, p_expected_statuses text[], p_expected_version integer,
  p_patch jsonb, p_event jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  current_task public.agent_tasks;
  next_task public.agent_tasks;
  persisted_event jsonb;
  next_status text;
BEGIN
  SELECT * INTO current_task FROM public.agent_tasks WHERE task_id = p_task_id FOR UPDATE;
  IF NOT FOUND OR current_task.status <> ALL(p_expected_statuses)
     OR current_task.state_version <> p_expected_version THEN RETURN NULL;
  END IF;
  next_status := COALESCE(p_patch->>'status', current_task.status);
  IF NOT (
    next_status = current_task.status OR
    (current_task.status, next_status) IN (VALUES
      ('queued', 'running'), ('queued', 'failed'), ('queued', 'cancelled'), ('queued', 'expired'),
      ('running', 'waiting_input'), ('running', 'waiting_approval'), ('running', 'executing'),
      ('running', 'reconciliation_required'), ('running', 'succeeded'), ('running', 'failed'),
      ('running', 'cancelled'), ('running', 'expired'),
      ('waiting_input', 'queued'), ('waiting_input', 'cancelled'), ('waiting_input', 'expired'),
      ('waiting_approval', 'queued'), ('waiting_approval', 'executing'),
      ('waiting_approval', 'cancelled'), ('waiting_approval', 'expired'),
      ('executing', 'reconciliation_required'), ('executing', 'succeeded'),
      ('executing', 'failed'), ('executing', 'expired'),
      ('reconciliation_required', 'succeeded'), ('reconciliation_required', 'failed'),
      ('reconciliation_required', 'expired')
    )
  ) THEN
    RAISE EXCEPTION 'invalid Agent task transition from % to %', current_task.status, next_status
      USING ERRCODE = '23514';
  END IF;
  UPDATE public.agent_tasks SET
    status = next_status,
    progress = COALESCE((p_patch->>'progress')::integer, progress),
    result = CASE WHEN p_patch ? 'result' THEN p_patch->'result' ELSE result END,
    failure = CASE WHEN p_patch ? 'failure' THEN p_patch->'failure' ELSE failure END,
    completed_at = CASE WHEN p_patch ? 'completed_at' THEN (p_patch->>'completed_at')::timestamptz ELSE completed_at END,
    updated_at = COALESCE((p_patch->>'updated_at')::timestamptz, now()),
    lease_owner = CASE WHEN p_patch ? 'lease_owner' THEN p_patch->>'lease_owner' ELSE lease_owner END,
    lease_expires_at = CASE WHEN p_patch ? 'lease_expires_at' THEN (p_patch->>'lease_expires_at')::timestamptz ELSE lease_expires_at END,
    attempt_count = COALESCE((p_patch->>'attempt_count')::integer, attempt_count),
    state_version = state_version + 1
  WHERE task_id = p_task_id RETURNING * INTO next_task;
  IF p_event IS NOT NULL THEN persisted_event := public.agent_append_task_event_v2(p_task_id, p_event); END IF;
  RETURN jsonb_build_object('task', to_jsonb(next_task), 'event', persisted_event);
END;
$$;

REVOKE ALL ON FUNCTION public.agent_append_task_event_v2(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_transition_task_v2(uuid, text[], integer, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_append_task_event_v2(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_transition_task_v2(uuid, text[], integer, jsonb, jsonb) TO service_role;
COMMENT ON TABLE public.agent_event_outbox IS
  'Durable ordered NarraOps Agent events used for cursor polling, SSE replay, audit, and recovery.';
