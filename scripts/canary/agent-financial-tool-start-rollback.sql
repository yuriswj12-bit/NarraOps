BEGIN;

DO $$
DECLARE
  actor uuid := '30000000-0000-4000-8000-000000000001';
  task_one uuid := '30000000-0000-4000-8000-000000000002';
  tool_one uuid := '30000000-0000-4000-8000-000000000003';
  task_replay uuid := '30000000-0000-4000-8000-000000000012';
  tool_replay uuid := '30000000-0000-4000-8000-000000000013';
  intent_digest text := repeat('a', 64);
  first_input jsonb;
  replay_input jsonb;
  first_result jsonb;
  replay_result jsonb;
  observed_count integer;
BEGIN
  first_input := jsonb_build_object(
      'schemaVersion', 'agent.financial_tool_start.v1',
      'taskId', task_one,
      'toolCallId', tool_one,
      'eventId', '30000000-0000-4000-8000-000000000004',
      'actorId', actor,
      'client', 'go',
      'capability', 'launch.execute',
      'taskType', 'launch.execute',
      'taskStatus', 'waiting_approval',
      'toolName', 'launch.pump.broadcast',
      'toolVersion', '1.0.0',
      'toolStatus', 'waiting_approval',
      'risk', 'financial_irreversible',
      'resourceType', 'go_launch_draft',
      'resourceId', '30000000-0000-4000-8000-000000000005',
      'safeInput', jsonb_build_object('messageHash', repeat('b', 64)),
      'inputDigest', intent_digest,
      'contextRefs', '[]'::jsonb,
      'idempotencyKey', 'canary:pump:start:1',
      'toolIdempotencyKey', 'canary:pump:start:1:tool',
      'traceId', 'canary-pump-start-1',
      'createdAt', now(),
      'approval', jsonb_build_object(
        'schemaVersion', 'agent.approval.v1',
        'approvalId', '30000000-0000-4000-8000-000000000006',
        'intent', jsonb_build_object(
          'schemaVersion', 'agent.execution_intent.v1',
          'intentId', '30000000-0000-4000-8000-000000000007',
          'actorId', actor,
          'action', 'launch.pump',
          'resourceType', 'go_launch_draft',
          'resourceId', '30000000-0000-4000-8000-000000000005',
          'parameters', jsonb_build_object('messageHash', repeat('b', 64)),
          'intentDigest', intent_digest,
          'risk', 'financial_irreversible',
          'status', 'requested',
          'createdAt', now(),
          'expiresAt', now() + interval '10 minutes'
        ),
        'actorId', actor,
        'taskId', task_one,
        'toolCallId', tool_one,
        'status', 'requested',
        'policy', 'explicit',
        'idempotencyKey', 'canary:pump:start:1:approval',
        'stateVersion', 1,
        'requestedAt', now(),
        'expiresAt', now() + interval '10 minutes'
      )
    );
  first_result := public.agent_begin_financial_tool_v1(first_input);

  IF first_result->>'idempotentReplay' <> 'false'
     OR first_result->'task'->>'status' <> 'waiting_approval'
     OR first_result->'toolCall'->>'status' <> 'waiting_approval'
     OR first_result->'approval'->>'status' <> 'requested' THEN
    RAISE EXCEPTION 'first financial tool start assertion failed: %', first_result;
  END IF;

  SELECT count(*) INTO observed_count
  FROM public.agent_event_outbox
  WHERE task_id = task_one AND event_type = 'task.approval_requested';
  IF observed_count <> 1 THEN
    RAISE EXCEPTION 'approval event assertion failed: %', observed_count;
  END IF;

  replay_input := jsonb_build_object(
      'schemaVersion', 'agent.financial_tool_start.v1',
      'taskId', task_replay,
      'toolCallId', tool_replay,
      'eventId', '30000000-0000-4000-8000-000000000014',
      'actorId', actor,
      'client', 'go',
      'capability', 'launch.execute',
      'taskType', 'launch.execute',
      'taskStatus', 'waiting_approval',
      'toolName', 'launch.pump.broadcast',
      'toolVersion', '1.0.0',
      'toolStatus', 'waiting_approval',
      'risk', 'financial_irreversible',
      'resourceType', 'go_launch_draft',
      'resourceId', '30000000-0000-4000-8000-000000000005',
      'safeInput', jsonb_build_object('messageHash', repeat('b', 64)),
      'inputDigest', intent_digest,
      'contextRefs', '[]'::jsonb,
      'idempotencyKey', 'canary:pump:start:1',
      'toolIdempotencyKey', 'canary:pump:start:1:tool',
      'traceId', 'canary-pump-start-replay',
      'createdAt', now(),
      'approval', jsonb_build_object(
        'schemaVersion', 'agent.approval.v1',
        'approvalId', '30000000-0000-4000-8000-000000000016',
        'intent', jsonb_build_object(
          'schemaVersion', 'agent.execution_intent.v1',
          'intentId', '30000000-0000-4000-8000-000000000017',
          'actorId', actor,
          'action', 'launch.pump',
          'resourceType', 'go_launch_draft',
          'resourceId', '30000000-0000-4000-8000-000000000005',
          'parameters', jsonb_build_object('messageHash', repeat('b', 64)),
          'intentDigest', intent_digest,
          'risk', 'financial_irreversible',
          'status', 'requested',
          'createdAt', now(),
          'expiresAt', now() + interval '10 minutes'
        ),
        'actorId', actor,
        'taskId', task_replay,
        'toolCallId', tool_replay,
        'status', 'requested',
        'policy', 'explicit',
        'idempotencyKey', 'canary:pump:start:1:approval',
        'stateVersion', 1,
        'requestedAt', now(),
        'expiresAt', now() + interval '10 minutes'
      )
    );
  replay_result := public.agent_begin_financial_tool_v1(replay_input);
  IF replay_result->>'idempotentReplay' <> 'true'
     OR replay_result->'task'->>'task_id' <> task_one::text
     OR replay_result->'toolCall'->>'tool_call_id' <> tool_one::text
     OR replay_result->'intent'->>'intent_digest' <> intent_digest THEN
    RAISE EXCEPTION 'financial tool replay assertion failed: %', replay_result;
  END IF;

  BEGIN
    PERFORM public.agent_begin_financial_tool_v1(
      jsonb_set(
        jsonb_set(replay_input, '{inputDigest}', to_jsonb(repeat('c', 64))),
        '{approval,intent,intentDigest}',
        to_jsonb(repeat('c', 64))
      )
    );
    RAISE EXCEPTION 'parameter drift unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
