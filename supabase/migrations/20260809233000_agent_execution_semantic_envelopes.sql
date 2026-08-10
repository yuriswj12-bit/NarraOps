-- Runtime v2 durable approved semantic envelopes.
-- This migration persists verified transaction meaning and requires it before
-- submitted state. It does not decode, sign, or broadcast transactions.

ALTER TABLE public.agent_executions
  ADD COLUMN IF NOT EXISTS semantic_envelope jsonb NULL,
  ADD COLUMN IF NOT EXISTS semantic_envelope_digest text NULL,
  ADD COLUMN IF NOT EXISTS semantics_verified_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_executions'::regclass
      AND conname = 'agent_executions_semantic_digest_check'
  ) THEN
    ALTER TABLE public.agent_executions
      ADD CONSTRAINT agent_executions_semantic_digest_check CHECK (
        semantic_envelope_digest IS NULL
        OR (
          semantic_envelope_digest ~ '^[a-f0-9]{64}$'
          AND semantic_envelope IS NOT NULL
          AND semantic_envelope->>'envelopeDigest' = semantic_envelope_digest
          AND semantics_verified_at IS NOT NULL
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.agent_executions'::regclass
      AND conname = 'agent_executions_submitted_semantics_check'
  ) THEN
    ALTER TABLE public.agent_executions
      ADD CONSTRAINT agent_executions_submitted_semantics_check CHECK (
        status NOT IN ('submitted', 'reconciliation_required', 'confirmed')
        OR semantic_envelope_digest IS NOT NULL
      );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.agent_bind_execution_envelope_v1(
  p_record jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  execution uuid;
  actor uuid;
  expected_version integer;
  envelope jsonb := p_record->'envelope';
  verified_at timestamptz := now();
  current_execution public.agent_executions;
  persisted public.agent_executions;
  task_event jsonb;
BEGIN
  execution := (p_record->>'executionId')::uuid;
  actor := (p_record->>'actorId')::uuid;
  expected_version := (p_record->>'expectedStateVersion')::integer;

  IF expected_version < 1
     OR COALESCE(envelope->>'schemaVersion', '') <> 'agent.execution_envelope.v1'
     OR COALESCE(envelope->>'executionId', '') <> execution::text
     OR COALESCE(envelope->>'actorId', '') <> actor::text
     OR COALESCE(envelope->>'intentDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(envelope->>'envelopeDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(jsonb_typeof(envelope->'transactions'), '') <> 'array'
     OR jsonb_array_length(envelope->'transactions') < 1
     OR jsonb_array_length(envelope->'transactions') > 100
     OR COALESCE(envelope->>'createdAt', '') = ''
     OR COALESCE(envelope->>'expiresAt', '') = ''
     OR (envelope->>'createdAt')::timestamptz > (envelope->>'expiresAt')::timestamptz
     OR (envelope->>'expiresAt')::timestamptz <= now() THEN
    RAISE EXCEPTION 'invalid approved execution semantic envelope'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_execution
  FROM public.agent_executions
  WHERE execution_id = execution AND actor_id = actor
  FOR UPDATE;

  IF NOT FOUND
     OR current_execution.status <> 'reserved'
     OR current_execution.state_version <> expected_version
     OR current_execution.semantic_envelope IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF envelope->>'intentDigest' <> current_execution.intent_digest
     OR envelope->>'action' <> current_execution.action THEN
    RAISE EXCEPTION 'semantic envelope does not match execution intent'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agent_executions SET
    semantic_envelope = envelope,
    semantic_envelope_digest = envelope->>'envelopeDigest',
    semantics_verified_at = verified_at,
    state_version = state_version + 1,
    updated_at = verified_at
  WHERE execution_id = execution
  RETURNING * INTO persisted;

  INSERT INTO public.agent_execution_audit (
    execution_id, actor_id, event_type, state_version, payload, created_at
  ) VALUES (
    execution, actor, 'execution.semantics_verified', persisted.state_version,
    jsonb_build_object(
      'envelope_digest', persisted.semantic_envelope_digest,
      'intent_digest', persisted.intent_digest,
      'transaction_count', jsonb_array_length(envelope->'transactions'),
      'task_id', persisted.task_id,
      'tool_call_id', persisted.tool_call_id
    ),
    verified_at
  );

  task_event := jsonb_build_object(
    'eventId', gen_random_uuid(),
    'type', 'task.execution_semantics_verified',
    'aggregateType', 'execution',
    'aggregateId', execution,
    'traceId', execution::text,
    'createdAt', verified_at,
    'payload', jsonb_build_object(
      'execution_id', execution,
      'tool_call_id', persisted.tool_call_id,
      'envelope_digest', persisted.semantic_envelope_digest
    )
  );
  PERFORM public.agent_append_task_event_v2(persisted.task_id, task_event);

  RETURN to_jsonb(persisted);
END;
$$;

REVOKE ALL ON FUNCTION public.agent_bind_execution_envelope_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_bind_execution_envelope_v1(jsonb)
  TO service_role;

COMMENT ON FUNCTION public.agent_bind_execution_envelope_v1(jsonb) IS
  'Binds one Runtime-verified semantic envelope to a reserved execution; never signs or broadcasts.';
