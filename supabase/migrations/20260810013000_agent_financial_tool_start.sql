-- Atomically creates a durable financial task, tool call, and approval request.
-- This function cannot approve, consume, reserve, sign, submit, or broadcast.

CREATE OR REPLACE FUNCTION public.agent_begin_financial_tool_v1(p_record jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := (p_record->>'actorId')::uuid;
  task uuid := (p_record->>'taskId')::uuid;
  tool_call uuid := (p_record->>'toolCallId')::uuid;
  start_key text := p_record->>'idempotencyKey';
  tool_input jsonb := COALESCE(p_record->'safeInput', '{}'::jsonb);
  approval_input jsonb := p_record->'approval';
  existing_task public.agent_tasks;
  existing_tool public.agent_tool_calls;
  existing_approval public.agent_authorizations;
  existing_intent public.agent_authorization_intents;
  persisted_task public.agent_tasks;
  persisted_tool public.agent_tool_calls;
  approval_result jsonb;
BEGIN
  IF COALESCE(p_record->>'schemaVersion', '') <> 'agent.financial_tool_start.v1'
     OR COALESCE(p_record->>'risk', '') <> 'financial_irreversible'
     OR COALESCE(p_record->>'taskStatus', '') <> 'waiting_approval'
     OR COALESCE(p_record->>'toolStatus', '') <> 'waiting_approval'
     OR COALESCE(p_record->>'inputDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_record->>'taskType', '') = ''
     OR COALESCE(p_record->>'toolName', '') = ''
     OR COALESCE(p_record->>'toolVersion', '') = ''
     OR COALESCE(p_record->>'capability', '') = ''
     OR COALESCE(p_record->>'resourceType', '') = ''
     OR COALESCE(p_record->>'resourceId', '') = ''
     OR start_key !~ '^[A-Za-z0-9._:-]{8,255}$'
     OR COALESCE(p_record->>'toolIdempotencyKey', '')
        !~ '^[A-Za-z0-9._:-]{8,255}$'
     OR COALESCE(approval_input->>'actorId', '') <> actor::text
     OR COALESCE(approval_input->>'taskId', '') <> task::text
     OR COALESCE(approval_input->>'toolCallId', '') <> tool_call::text THEN
    RAISE EXCEPTION 'invalid financial tool start' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(actor::text || ':financial-tool:' || start_key, 0)
  );

  SELECT * INTO existing_task
  FROM public.agent_tasks
  WHERE actor_id = actor AND idempotency_key = start_key;
  IF FOUND THEN
    SELECT * INTO existing_tool
    FROM public.agent_tool_calls
    WHERE task_id = existing_task.task_id
      AND idempotency_key = p_record->>'toolIdempotencyKey';
    SELECT * INTO existing_approval
    FROM public.agent_authorizations
    WHERE actor_id = actor
      AND idempotency_key = approval_input->>'idempotencyKey';
    IF existing_tool.tool_call_id IS NULL
       OR existing_approval.approval_id IS NULL
       OR existing_tool.input_digest <> p_record->>'inputDigest'
       OR existing_tool.tool_name <> p_record->>'toolName'
       OR existing_approval.task_id <> existing_task.task_id
       OR existing_approval.tool_call_id <> existing_tool.tool_call_id
       OR existing_approval.intent_digest
          <> approval_input->'intent'->>'intentDigest' THEN
      RAISE EXCEPTION 'financial tool idempotency conflict'
        USING ERRCODE = '23505';
    END IF;
    SELECT * INTO existing_intent
    FROM public.agent_authorization_intents
    WHERE intent_id = existing_approval.intent_id;
    RETURN jsonb_build_object(
      'task', to_jsonb(existing_task),
      'toolCall', to_jsonb(existing_tool),
      'approval', to_jsonb(existing_approval),
      'intent', to_jsonb(existing_intent),
      'idempotentReplay', true
    );
  END IF;

  INSERT INTO public.agent_tasks (
    task_id, conversation_id, channel, type, status, progress,
    requires_confirmation, execution_mode, input, result, failure,
    request_id, created_at, updated_at, completed_at, actor_id, client,
    capability, context_refs, idempotency_key, state_version,
    attempt_count, max_attempts, expires_at
  ) VALUES (
    task, NULL, 'api',
    p_record->>'taskType', 'waiting_approval', 60, true, 'live',
    jsonb_build_object(
      'resourceType', p_record->>'resourceType',
      'resourceId', p_record->>'resourceId',
      'safeInput', tool_input
    ),
    NULL, NULL, NULL,
    (p_record->>'createdAt')::timestamptz,
    (p_record->>'createdAt')::timestamptz,
    NULL, actor, COALESCE(NULLIF(p_record->>'client', ''), 'api'),
    p_record->>'capability', COALESCE(p_record->'contextRefs', '[]'::jsonb),
    start_key, 1, 0, 3, (approval_input->>'expiresAt')::timestamptz
  ) RETURNING * INTO persisted_task;

  INSERT INTO public.agent_tool_calls (
    tool_call_id, task_id, actor_id, tool_name, tool_version, risk, status,
    input_digest, safe_input, safe_output, failure, approval_id,
    idempotency_key, attempt_count, created_at
  ) VALUES (
    tool_call, task, actor, p_record->>'toolName', p_record->>'toolVersion',
    'financial_irreversible', 'waiting_approval', p_record->>'inputDigest',
    tool_input, NULL, NULL, NULL, p_record->>'toolIdempotencyKey', 0,
    (p_record->>'createdAt')::timestamptz
  ) RETURNING * INTO persisted_tool;

  INSERT INTO public.agent_event_outbox (
    event_id, task_id, task_sequence, event_type, aggregate_type,
    aggregate_id, actor_id, conversation_id, trace_id, payload, created_at
  ) VALUES (
    (p_record->>'eventId')::uuid, task, 1, 'task.approval_requested',
    'task', task, actor, NULL, p_record->>'traceId',
    jsonb_build_object(
      'tool_call_id', tool_call,
      'tool_name', persisted_tool.tool_name,
      'risk', persisted_tool.risk,
      'resource_type', p_record->>'resourceType',
      'resource_id', p_record->>'resourceId'
    ),
    (p_record->>'createdAt')::timestamptz
  );

  approval_result := public.agent_request_approval_v2(approval_input);
  SELECT * INTO persisted_tool
  FROM public.agent_tool_calls WHERE tool_call_id = tool_call;

  RETURN jsonb_build_object(
    'task', to_jsonb(persisted_task),
    'toolCall', to_jsonb(persisted_tool),
    'approval', approval_result->'approval',
    'intent', approval_result->'intent',
    'idempotentReplay', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agent_begin_financial_tool_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_begin_financial_tool_v1(jsonb) TO service_role;

COMMENT ON FUNCTION public.agent_begin_financial_tool_v1(jsonb) IS
  'Atomically persists a financial task, tool call, and requested approval. It cannot execute.';
