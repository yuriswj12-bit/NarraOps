BEGIN;

DO $$
DECLARE
  actor uuid := '32000000-0000-4000-8000-000000000001';
  task uuid := '32000000-0000-4000-8000-000000000002';
  tool_call uuid := '32000000-0000-4000-8000-000000000003';
  approval uuid := '32000000-0000-4000-8000-000000000006';
  intent uuid := '32000000-0000-4000-8000-000000000007';
  execution uuid := '32000000-0000-4000-8000-000000000008';
  resource uuid := '32000000-0000-4000-8000-000000000005';
  digest text := repeat('a', 64);
  message_hash text := repeat('b', 64);
  signer text := repeat('1', 32);
  signature text := repeat('2', 88);
  execution_record jsonb;
  evidence jsonb;
  result jsonb;
  replay jsonb;
  observed text;
BEGIN
  PERFORM public.agent_begin_financial_tool_v1(
    jsonb_build_object(
      'schemaVersion', 'agent.financial_tool_start.v1',
      'taskId', task,
      'toolCallId', tool_call,
      'eventId', '32000000-0000-4000-8000-000000000004',
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
      'resourceId', resource,
      'safeInput', jsonb_build_object('messageHash', message_hash),
      'inputDigest', digest,
      'contextRefs', '[]'::jsonb,
      'idempotencyKey', 'canary:wallet:start:1',
      'toolIdempotencyKey', 'canary:wallet:start:1:tool',
      'traceId', 'canary-wallet-start-1',
      'createdAt', now(),
      'approval', jsonb_build_object(
        'schemaVersion', 'agent.approval.v1',
        'approvalId', approval,
        'intent', jsonb_build_object(
          'schemaVersion', 'agent.execution_intent.v1',
          'intentId', intent,
          'actorId', actor,
          'action', 'launch.broadcast',
          'resourceType', 'go_launch_draft',
          'resourceId', resource,
          'parameters', jsonb_build_object(
            'message_hash', message_hash,
            'fee_payer', signer
          ),
          'intentDigest', digest,
          'risk', 'financial_irreversible',
          'status', 'requested',
          'createdAt', now(),
          'expiresAt', now() + interval '10 minutes'
        ),
        'actorId', actor,
        'taskId', task,
        'toolCallId', tool_call,
        'status', 'requested',
        'policy', 'explicit',
        'idempotencyKey', 'canary:wallet:start:1:approval',
        'stateVersion', 1,
        'requestedAt', now(),
        'expiresAt', now() + interval '10 minutes'
      )
    )
  );

  execution_record := jsonb_build_object(
    'schemaVersion', 'agent.execution.v1',
    'executionId', execution,
    'taskId', task,
    'toolCallId', tool_call,
    'approvalId', approval,
    'intentId', intent,
    'actorId', actor,
    'action', 'launch.broadcast',
    'resourceType', 'go_launch_draft',
    'resourceId', resource,
    'intentDigest', digest,
    'idempotencyKey', 'canary:wallet:execution:1',
    'requestFingerprint', repeat('c', 64),
    'provider', 'pump.fun',
    'chain', 'solana',
    'status', 'reserved',
    'stateVersion', 1,
    'createdAt', now(),
    'updatedAt', now()
  );
  evidence := jsonb_build_object(
    'schemaVersion', 'agent.wallet_signature_confirmation.v1',
    'messageHash', message_hash,
    'txSignature', signature,
    'signer', signer,
    'verifiedAt', now()
  );

  result := public.agent_reserve_wallet_signed_execution_v1(
    execution_record, evidence, 1, 1
  );
  IF result->'reservation'->>'status' <> 'reserved'
     OR result->'approval'->>'status' <> 'consumed'
     OR result->'task'->>'status' <> 'executing'
     OR result->>'idempotentReplay' <> 'false' THEN
    RAISE EXCEPTION 'wallet-signed reservation assertion failed: %', result;
  END IF;

  SELECT payload->>'confirmation_kind' INTO observed
  FROM public.agent_authorization_audit
  WHERE approval_id = approval AND event_type = 'approval.approved';
  IF observed <> 'verified_wallet_signature' THEN
    RAISE EXCEPTION 'wallet signature audit assertion failed: %', observed;
  END IF;

  replay := public.agent_reserve_wallet_signed_execution_v1(
    execution_record, evidence, 1, 1
  );
  IF replay->>'idempotentReplay' <> 'true'
     OR replay->'reservation'->>'execution_id' <> execution::text THEN
    RAISE EXCEPTION 'wallet reservation replay assertion failed: %', replay;
  END IF;

  BEGIN
    PERFORM public.agent_reserve_wallet_signed_execution_v1(
      execution_record,
      jsonb_set(evidence, '{txSignature}', to_jsonb(repeat('3', 88))),
      1,
      1
    );
    RAISE EXCEPTION 'wallet evidence drift unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.agent_executions
    WHERE execution_id = execution AND status <> 'reserved'
  ) THEN
    RAISE EXCEPTION 'reservation unexpectedly reached an execution state';
  END IF;
END;
$$;

ROLLBACK;
