-- Runtime v2 durable execution transitions and reconciliation foundation.
-- This function records execution state only. It does not sign or broadcast.
-- Callers must commit `submitted` with the derived tx hash/signature before
-- attempting provider broadcast.

CREATE OR REPLACE FUNCTION public.agent_transition_execution_v1(
  p_record jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  execution uuid;
  actor uuid;
  expected_status text;
  expected_version integer;
  next_status text;
  next_tx_hash text;
  next_failure jsonb;
  transition_time timestamptz := now();
  current_execution public.agent_executions;
  persisted public.agent_executions;
  current_task public.agent_tasks;
  task_transition jsonb;
  task_event jsonb;
BEGIN
  execution := (p_record->>'executionId')::uuid;
  actor := (p_record->>'actorId')::uuid;
  expected_status := p_record->>'expectedStatus';
  expected_version := (p_record->>'expectedStateVersion')::integer;
  next_status := p_record->>'status';
  next_failure := p_record->'failure';

  IF expected_version < 1
     OR expected_status NOT IN (
       'reserved','submitted','reconciliation_required','confirmed','failed','cancelled'
     )
     OR next_status NOT IN (
       'reserved','submitted','reconciliation_required','confirmed','failed','cancelled'
     ) THEN
    RAISE EXCEPTION 'invalid execution transition record' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO current_execution
  FROM public.agent_executions
  WHERE execution_id = execution AND actor_id = actor
  FOR UPDATE;

  IF NOT FOUND
     OR current_execution.status <> expected_status
     OR current_execution.state_version <> expected_version THEN
    RETURN NULL;
  END IF;

  IF NOT ((current_execution.status, next_status) IN (VALUES
    ('reserved', 'submitted'),
    ('reserved', 'failed'),
    ('reserved', 'cancelled'),
    ('submitted', 'reconciliation_required'),
    ('submitted', 'confirmed'),
    ('submitted', 'failed'),
    ('reconciliation_required', 'confirmed'),
    ('reconciliation_required', 'failed')
  )) THEN
    RAISE EXCEPTION 'invalid execution transition from % to %',
      current_execution.status, next_status
      USING ERRCODE = '23514';
  END IF;

  next_tx_hash := COALESCE(NULLIF(p_record->>'txHash', ''), current_execution.tx_hash);
  IF next_status IN ('submitted', 'reconciliation_required', 'confirmed')
     AND next_tx_hash IS NULL THEN
    RAISE EXCEPTION '% requires a persisted transaction hash or signature', next_status
      USING ERRCODE = '23514';
  END IF;
  IF current_execution.tx_hash IS NOT NULL
     AND NULLIF(p_record->>'txHash', '') IS NOT NULL
     AND current_execution.tx_hash <> p_record->>'txHash' THEN
    RAISE EXCEPTION 'execution transaction hash or signature is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF next_status = 'failed'
     AND COALESCE(next_failure->>'code', '') = '' THEN
    RAISE EXCEPTION 'failed execution requires a stable failure code'
      USING ERRCODE = '23514';
  END IF;
  IF next_status <> 'failed' AND next_failure IS NOT NULL THEN
    RAISE EXCEPTION 'failure details are only valid for failed execution'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.agent_executions SET
    status = next_status,
    state_version = state_version + 1,
    tx_hash = next_tx_hash,
    failure = CASE WHEN next_status = 'failed' THEN next_failure ELSE failure END,
    updated_at = transition_time,
    submitted_at = CASE
      WHEN next_status = 'submitted' THEN COALESCE(submitted_at, transition_time)
      ELSE submitted_at
    END,
    completed_at = CASE
      WHEN next_status IN ('confirmed', 'failed', 'cancelled') THEN transition_time
      ELSE completed_at
    END
  WHERE execution_id = execution
  RETURNING * INTO persisted;

  UPDATE public.agent_tool_calls SET
    status = CASE
      WHEN next_status = 'confirmed' THEN 'succeeded'
      WHEN next_status = 'failed' THEN 'failed'
      WHEN next_status = 'cancelled' THEN 'cancelled'
      ELSE status
    END,
    failure = CASE WHEN next_status = 'failed' THEN next_failure ELSE failure END,
    completed_at = CASE
      WHEN next_status IN ('confirmed', 'failed', 'cancelled') THEN transition_time
      ELSE completed_at
    END
  WHERE tool_call_id = persisted.tool_call_id
    AND task_id = persisted.task_id
    AND actor_id = actor;

  INSERT INTO public.agent_execution_audit (
    execution_id, actor_id, event_type, state_version, payload, created_at
  ) VALUES (
    execution, actor, 'execution.' || next_status, persisted.state_version,
    jsonb_strip_nulls(jsonb_build_object(
      'from_status', current_execution.status,
      'to_status', next_status,
      'tx_hash', next_tx_hash,
      'failure', next_failure,
      'task_id', persisted.task_id,
      'tool_call_id', persisted.tool_call_id
    )),
    transition_time
  );

  task_event := jsonb_build_object(
    'eventId', gen_random_uuid(),
    'type', 'task.execution_' || next_status,
    'aggregateType', 'execution',
    'aggregateId', execution,
    'traceId', execution::text,
    'createdAt', transition_time,
    'payload', jsonb_strip_nulls(jsonb_build_object(
      'execution_id', execution,
      'tool_call_id', persisted.tool_call_id,
      'status', next_status,
      'tx_hash', next_tx_hash,
      'failure', next_failure
    ))
  );

  SELECT * INTO current_task
  FROM public.agent_tasks
  WHERE task_id = persisted.task_id
  FOR UPDATE;

  IF FOUND AND next_status = 'reconciliation_required'
     AND current_task.status = 'executing' THEN
    task_transition := public.agent_transition_task_v2(
      persisted.task_id,
      ARRAY['executing'],
      current_task.state_version,
      jsonb_build_object('status', 'reconciliation_required', 'updated_at', transition_time),
      task_event
    );
  ELSIF FOUND THEN
    PERFORM public.agent_append_task_event_v2(persisted.task_id, task_event);
  END IF;

  RETURN to_jsonb(persisted);
END;
$$;

REVOKE ALL ON FUNCTION public.agent_transition_execution_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_transition_execution_v1(jsonb) TO service_role;

COMMENT ON FUNCTION public.agent_transition_execution_v1(jsonb) IS
  'Atomically records fixed execution transitions and audit events; never signs or broadcasts.';
