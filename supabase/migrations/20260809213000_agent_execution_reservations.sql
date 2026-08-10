-- Runtime v2 execution reservation foundation.
-- Approval consumption and execution reservation are one transaction.
-- No function in this migration signs or broadcasts a transaction.

ALTER TABLE public.agent_authorization_intents
  ADD COLUMN IF NOT EXISTS task_id uuid NULL,
  ADD COLUMN IF NOT EXISTS tool_call_id uuid NULL;
ALTER TABLE public.agent_authorizations
  ADD COLUMN IF NOT EXISTS task_id uuid NULL,
  ADD COLUMN IF NOT EXISTS tool_call_id uuid NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.agent_authorizations WHERE task_id IS NULL OR tool_call_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.agent_authorization_intents WHERE task_id IS NULL OR tool_call_id IS NULL) THEN
    RAISE EXCEPTION 'authorization rows must be task/tool bound before migration 026';
  END IF;
END $$;

ALTER TABLE public.agent_authorization_intents
  ALTER COLUMN task_id SET NOT NULL,
  ALTER COLUMN tool_call_id SET NOT NULL;
ALTER TABLE public.agent_authorizations
  ALTER COLUMN task_id SET NOT NULL,
  ALTER COLUMN tool_call_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_authorization_intents_task_fk') THEN
    ALTER TABLE public.agent_authorization_intents
      ADD CONSTRAINT agent_authorization_intents_task_fk
      FOREIGN KEY (task_id) REFERENCES public.agent_tasks(task_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_authorization_intents_tool_call_fk') THEN
    ALTER TABLE public.agent_authorization_intents
      ADD CONSTRAINT agent_authorization_intents_tool_call_fk
      FOREIGN KEY (tool_call_id) REFERENCES public.agent_tool_calls(tool_call_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_authorizations_task_fk') THEN
    ALTER TABLE public.agent_authorizations
      ADD CONSTRAINT agent_authorizations_task_fk
      FOREIGN KEY (task_id) REFERENCES public.agent_tasks(task_id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_authorizations_tool_call_fk') THEN
    ALTER TABLE public.agent_authorizations
      ADD CONSTRAINT agent_authorizations_tool_call_fk
      FOREIGN KEY (tool_call_id) REFERENCES public.agent_tool_calls(tool_call_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.agent_executions (
  execution_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.agent_tasks(task_id) ON DELETE CASCADE,
  tool_call_id uuid NOT NULL REFERENCES public.agent_tool_calls(tool_call_id) ON DELETE CASCADE,
  approval_id uuid NOT NULL UNIQUE REFERENCES public.agent_authorizations(approval_id) ON DELETE RESTRICT,
  intent_id uuid NOT NULL REFERENCES public.agent_authorization_intents(intent_id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL,
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
  provider text NULL,
  chain text NULL,
  status text NOT NULL CHECK (status IN (
    'reserved','submitted','reconciliation_required','confirmed','failed','cancelled'
  )),
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  tx_hash text NULL,
  failure jsonb NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  submitted_at timestamptz NULL,
  completed_at timestamptz NULL,
  UNIQUE (actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.agent_execution_audit (
  audit_id bigserial PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES public.agent_executions(execution_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  event_type text NOT NULL,
  state_version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_executions_task_created_idx
  ON public.agent_executions (task_id, created_at);
CREATE INDEX IF NOT EXISTS agent_executions_status_updated_idx
  ON public.agent_executions (status, updated_at);
ALTER TABLE public.agent_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_execution_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_executions FROM anon, authenticated;
REVOKE ALL ON public.agent_execution_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_request_approval_v2(p_record jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  intent_input jsonb := p_record->'intent';
  actor uuid;
  task uuid;
  tool_call uuid;
  request_key text;
  expires timestamptz;
  existing_approval public.agent_authorizations;
  existing_intent public.agent_authorization_intents;
  persisted_approval public.agent_authorizations;
  persisted_intent public.agent_authorization_intents;
BEGIN
  IF COALESCE(p_record->>'schemaVersion', '') <> 'agent.approval.v1'
     OR COALESCE(intent_input->>'schemaVersion', '') <> 'agent.execution_intent.v1'
     OR COALESCE(p_record->>'status', '') <> 'requested'
     OR COALESCE(intent_input->>'status', '') <> 'requested'
     OR COALESCE(p_record->>'actorId', '') <> COALESCE(intent_input->>'actorId', '')
     OR COALESCE(p_record->>'policy', '') NOT IN ('explicit', 'explicit_and_recent_auth')
     OR COALESCE(intent_input->>'risk', '') <> 'financial_irreversible'
     OR COALESCE(intent_input->>'intentDigest', '') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'invalid task-bound approval request' USING ERRCODE = '22023';
  END IF;

  actor := (p_record->>'actorId')::uuid;
  task := (p_record->>'taskId')::uuid;
  tool_call := (p_record->>'toolCallId')::uuid;
  request_key := p_record->>'idempotencyKey';
  expires := (p_record->>'expiresAt')::timestamptz;
  IF request_key !~ '^[A-Za-z0-9._:-]{8,255}$'
     OR expires <= now()
     OR expires > now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'invalid approval request lifetime or idempotency key'
      USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_tasks
    WHERE task_id = task AND actor_id = actor AND status = 'waiting_approval'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.agent_tool_calls
    WHERE tool_call_id = tool_call AND task_id = task AND actor_id = actor
      AND status = 'waiting_approval' AND risk = 'financial_irreversible'
  ) THEN
    RAISE EXCEPTION 'approval task or tool call is not waiting for approval'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || request_key, 0));
  SELECT * INTO existing_approval
  FROM public.agent_authorizations
  WHERE actor_id = actor AND idempotency_key = request_key;
  IF FOUND THEN
    SELECT * INTO existing_intent
    FROM public.agent_authorization_intents
    WHERE intent_id = existing_approval.intent_id;
    IF existing_intent.intent_digest <> intent_input->>'intentDigest'
       OR existing_approval.task_id <> task
       OR existing_approval.tool_call_id <> tool_call THEN
      RAISE EXCEPTION 'approval idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'approval', to_jsonb(existing_approval),
      'intent', to_jsonb(existing_intent),
      'idempotentReplay', true
    );
  END IF;

  INSERT INTO public.agent_authorization_intents (
    intent_id, task_id, tool_call_id, actor_id, action, resource_type,
    resource_id, parameters, intent_digest, risk, status, approval_policy,
    idempotency_key, state_version, created_at, expires_at
  ) VALUES (
    (intent_input->>'intentId')::uuid, task, tool_call, actor,
    intent_input->>'action', intent_input->>'resourceType',
    intent_input->>'resourceId', COALESCE(intent_input->'parameters', '{}'::jsonb),
    intent_input->>'intentDigest', intent_input->>'risk', 'requested',
    p_record->>'policy', request_key, 1,
    (intent_input->>'createdAt')::timestamptz, expires
  ) RETURNING * INTO persisted_intent;

  INSERT INTO public.agent_authorizations (
    approval_id, intent_id, task_id, tool_call_id, actor_id, intent_digest,
    status, approval_policy, idempotency_key, state_version, requested_at, expires_at
  ) VALUES (
    (p_record->>'approvalId')::uuid, persisted_intent.intent_id, task,
    tool_call, actor, persisted_intent.intent_digest, 'requested',
    p_record->>'policy', request_key, 1,
    (p_record->>'requestedAt')::timestamptz, expires
  ) RETURNING * INTO persisted_approval;

  UPDATE public.agent_tool_calls
  SET approval_id = persisted_approval.approval_id
  WHERE tool_call_id = tool_call;

  INSERT INTO public.agent_authorization_audit (
    approval_id, intent_id, actor_id, event_type, state_version, payload
  ) VALUES (
    persisted_approval.approval_id, persisted_intent.intent_id, actor,
    'approval.requested', 1,
    jsonb_build_object(
      'task_id', task, 'tool_call_id', tool_call,
      'action', persisted_intent.action,
      'intent_digest', persisted_intent.intent_digest,
      'policy', persisted_approval.approval_policy
    )
  );
  RETURN jsonb_build_object(
    'approval', to_jsonb(persisted_approval),
    'intent', to_jsonb(persisted_intent),
    'idempotentReplay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_reserve_execution_v1(
  p_record jsonb,
  p_expected_approval_version integer,
  p_expected_task_version integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := (p_record->>'actorId')::uuid;
  task uuid := (p_record->>'taskId')::uuid;
  tool_call uuid := (p_record->>'toolCallId')::uuid;
  approval uuid := (p_record->>'approvalId')::uuid;
  request_key text := p_record->>'idempotencyKey';
  existing public.agent_executions;
  approval_row public.agent_authorizations;
  intent_row public.agent_authorization_intents;
  persisted public.agent_executions;
  task_transition jsonb;
BEGIN
  IF COALESCE(p_record->>'schemaVersion', '') <> 'agent.execution.v1'
     OR COALESCE(p_record->>'status', '') <> 'reserved'
     OR COALESCE(p_record->>'intentDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_record->>'requestFingerprint', '') !~ '^[a-f0-9]{64}$'
     OR request_key !~ '^[A-Za-z0-9._:-]{8,255}$' THEN
    RAISE EXCEPTION 'invalid execution reservation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || request_key, 0));
  SELECT * INTO existing
  FROM public.agent_executions
  WHERE actor_id = actor AND idempotency_key = request_key;
  IF FOUND THEN
    IF existing.request_fingerprint <> p_record->>'requestFingerprint'
       OR existing.approval_id <> approval
       OR existing.task_id <> task
       OR existing.tool_call_id <> tool_call THEN
      RAISE EXCEPTION 'execution idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('reservation', to_jsonb(existing), 'idempotentReplay', true);
  END IF;

  SELECT * INTO approval_row
  FROM public.agent_authorizations
  WHERE approval_id = approval AND actor_id = actor
  FOR UPDATE;
  IF NOT FOUND OR approval_row.status <> 'approved'
     OR approval_row.state_version <> p_expected_approval_version
     OR approval_row.intent_digest <> p_record->>'intentDigest'
     OR approval_row.task_id <> task
     OR approval_row.tool_call_id <> tool_call
     OR approval_row.expires_at <= now() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO intent_row
  FROM public.agent_authorization_intents
  WHERE intent_id = approval_row.intent_id AND actor_id = actor
  FOR UPDATE;
  IF NOT FOUND OR intent_row.status <> 'approved'
     OR intent_row.state_version <> p_expected_approval_version
     OR intent_row.intent_digest <> p_record->>'intentDigest'
     OR intent_row.action <> p_record->>'action'
     OR intent_row.resource_type <> p_record->>'resourceType'
     OR intent_row.resource_id <> p_record->>'resourceId' THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.agent_tool_calls
    WHERE tool_call_id = tool_call AND task_id = task AND actor_id = actor
      AND status = 'waiting_approval' AND approval_id = approval
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.agent_executions (
    execution_id, task_id, tool_call_id, approval_id, intent_id, actor_id,
    action, resource_type, resource_id, intent_digest, idempotency_key,
    request_fingerprint, provider, chain, status, state_version,
    created_at, updated_at
  ) VALUES (
    (p_record->>'executionId')::uuid, task, tool_call, approval,
    intent_row.intent_id, actor, p_record->>'action', p_record->>'resourceType',
    p_record->>'resourceId', p_record->>'intentDigest', request_key,
    p_record->>'requestFingerprint', NULLIF(p_record->>'provider', ''),
    NULLIF(p_record->>'chain', ''), 'reserved', 1,
    (p_record->>'createdAt')::timestamptz,
    (p_record->>'updatedAt')::timestamptz
  ) RETURNING * INTO persisted;

  UPDATE public.agent_authorizations
  SET status = 'consumed', state_version = state_version + 1, consumed_at = now()
  WHERE approval_id = approval;
  UPDATE public.agent_authorization_intents
  SET status = 'consumed', state_version = state_version + 1, consumed_at = now()
  WHERE intent_id = intent_row.intent_id;
  UPDATE public.agent_tool_calls
  SET status = 'executing', approval_id = approval, started_at = COALESCE(started_at, now())
  WHERE tool_call_id = tool_call AND status = 'waiting_approval';

  task_transition := public.agent_transition_task_v2(
    task,
    ARRAY['waiting_approval'],
    p_expected_task_version,
    jsonb_build_object('status', 'executing', 'updated_at', now()),
    jsonb_build_object(
      'eventId', gen_random_uuid(),
      'type', 'task.execution_reserved',
      'aggregateType', 'execution',
      'aggregateId', persisted.execution_id,
      'traceId', p_record->>'executionId',
      'createdAt', now(),
      'payload', jsonb_build_object(
        'execution_id', persisted.execution_id,
        'approval_id', approval,
        'tool_call_id', tool_call
      )
    )
  );
  IF task_transition IS NULL THEN
    RAISE EXCEPTION 'task state changed before execution reservation'
      USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.agent_authorization_audit (
    approval_id, intent_id, actor_id, event_type, state_version, payload
  ) VALUES (
    approval, intent_row.intent_id, actor, 'approval.consumed',
    p_expected_approval_version + 1,
    jsonb_build_object('execution_id', persisted.execution_id)
  );
  INSERT INTO public.agent_execution_audit (
    execution_id, actor_id, event_type, state_version, payload
  ) VALUES (
    persisted.execution_id, actor, 'execution.reserved', 1,
    jsonb_build_object(
      'approval_id', approval, 'intent_digest', persisted.intent_digest,
      'task_id', task, 'tool_call_id', tool_call
    )
  );
  RETURN jsonb_build_object(
    'reservation', to_jsonb(persisted),
    'approval', jsonb_build_object(
      'approval_id', approval,
      'status', 'consumed',
      'state_version', p_expected_approval_version + 1
    ),
    'task', task_transition->'task',
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_request_approval_v1(jsonb) FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.agent_consume_approval_v1(uuid, uuid, text, integer) FROM PUBLIC, service_role;
REVOKE ALL ON FUNCTION public.agent_request_approval_v2(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_reserve_execution_v1(jsonb, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_request_approval_v2(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_reserve_execution_v1(jsonb, integer, integer) TO service_role;

COMMENT ON TABLE public.agent_executions IS
  'Durable execution reservations. Reservation is not signing or broadcast.';
