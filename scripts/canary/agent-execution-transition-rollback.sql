BEGIN;

DO $$
DECLARE
  actor constant uuid := '8f5e6547-57b1-42f4-8567-c177eac4f891';
  task constant uuid := '3a1cae02-57b6-45e8-a74c-37c6915e2399';
  tool_call constant uuid := '08efe4b5-32ec-4f8b-8277-c32130d6f10f';
  intent constant uuid := 'bb9ad62a-b869-4965-a67a-fd0c244815e1';
  approval constant uuid := 'dc352953-2433-4b28-87e1-cd7459e407db';
  execution constant uuid := '66dbcd89-4b1e-4e72-9a62-3a65d0b33e47';
  digest constant text := repeat('a', 64);
  signature constant text := 'canary-derived-signature';
  envelope_digest constant text := repeat('c', 64);
  result jsonb;
  observed_count integer;
  observed_status text;
  observed_version integer;
BEGIN
  INSERT INTO public.agent_tasks (
    task_id, type, status, progress, requires_confirmation, execution_mode,
    input, request_id, actor_id, client, capability, idempotency_key, state_version
  ) VALUES (
    task, 'agent.execution.canary', 'executing', 50, true, 'live',
    '{}'::jsonb, execution::text, actor, 'canary', 'swap.broadcast',
    'canary:execution-transition-task', 1
  );
  INSERT INTO public.agent_tool_calls (
    tool_call_id, task_id, actor_id, tool_name, tool_version, risk, status,
    input_digest, safe_input, approval_id, idempotency_key, started_at
  ) VALUES (
    tool_call, task, actor, 'swap.broadcast', '1.0.0',
    'financial_irreversible', 'executing', digest, '{}'::jsonb,
    approval, 'canary:execution-transition-tool', now()
  );
  INSERT INTO public.agent_authorization_intents (
    intent_id, actor_id, action, resource_type, resource_id, parameters,
    intent_digest, risk, status, approval_policy, idempotency_key,
    state_version, created_at, expires_at, decided_at, consumed_at,
    task_id, tool_call_id
  ) VALUES (
    intent, actor, 'swap.broadcast', 'asset_wallet_group', 'canary-group',
    '{}'::jsonb, digest, 'financial_irreversible', 'consumed', 'explicit',
    'canary:execution-transition-intent', 3, now(), now() + interval '5 minutes',
    now(), now(), task, tool_call
  );
  INSERT INTO public.agent_authorizations (
    approval_id, intent_id, actor_id, intent_digest, status, approval_policy,
    idempotency_key, state_version, requested_at, expires_at, decided_at,
    consumed_at, task_id, tool_call_id
  ) VALUES (
    approval, intent, actor, digest, 'consumed', 'explicit',
    'canary:execution-transition-approval', 3, now(), now() + interval '5 minutes',
    now(), now(), task, tool_call
  );
  INSERT INTO public.agent_executions (
    execution_id, task_id, tool_call_id, approval_id, intent_id, actor_id,
    action, resource_type, resource_id, intent_digest, idempotency_key,
    request_fingerprint, provider, chain, status, state_version, created_at, updated_at
  ) VALUES (
    execution, task, tool_call, approval, intent, actor, 'swap.broadcast',
    'asset_wallet_group', 'canary-group', digest,
    'canary:execution-transition-reservation', repeat('b', 64),
    'canary-provider', 'solana', 'reserved', 1, now(), now()
  );

  result := public.agent_bind_execution_envelope_v1(jsonb_build_object(
    'executionId', execution,
    'actorId', actor,
    'expectedStateVersion', 1,
    'envelope', jsonb_build_object(
      'schemaVersion', 'agent.execution_envelope.v1',
      'executionId', execution,
      'actorId', actor,
      'intentDigest', digest,
      'action', 'swap.broadcast',
      'chain', jsonb_build_object('kind', 'solana', 'network', 'mainnet-beta'),
      'transactions', jsonb_build_array(jsonb_build_object(
        'transactionId', 'canary-swap-1',
        'signer', 'canary-payer',
        'messageHash', repeat('d', 64),
        'valueAtomic', '1',
        'programIds', jsonb_build_array('canary-program'),
        'recipients', jsonb_build_array(jsonb_build_object(
          'address', 'canary-recipient',
          'assetId', 'canary-mint',
          'amountAtomic', '1'
        )),
        'maxSlippageBps', 300,
        'maxFeeAtomic', '10000',
        'lastValidBlockHeight', 999999999
      )),
      'createdAt', now(),
      'expiresAt', now() + interval '5 minutes',
      'envelopeDigest', envelope_digest
    )
  ));
  IF (result->>'state_version')::integer <> 2
     OR result->>'semantic_envelope_digest' <> envelope_digest
     OR result->>'semantics_verified_at' IS NULL THEN
    RAISE EXCEPTION 'semantic envelope binding assertion failed: %', result;
  END IF;

  BEGIN
    PERFORM public.agent_transition_execution_v1(jsonb_build_object(
      'executionId', execution, 'actorId', actor, 'expectedStatus', 'reserved',
      'expectedStateVersion', 2, 'status', 'submission_pending'
    ));
    RAISE EXCEPTION 'submission_pending without tx hash unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  result := public.agent_transition_execution_v1(jsonb_build_object(
    'executionId', execution, 'actorId', actor, 'expectedStatus', 'reserved',
    'expectedStateVersion', 2, 'status', 'submission_pending', 'txHash', signature
  ));
  IF result->>'status' <> 'submission_pending'
     OR (result->>'state_version')::integer <> 3
     OR result->>'tx_hash' <> signature
     OR result->>'submitted_at' IS NOT NULL THEN
    RAISE EXCEPTION 'submission_pending transition assertion failed: %', result;
  END IF;

  result := public.agent_transition_execution_v1(jsonb_build_object(
    'executionId', execution, 'actorId', actor,
    'expectedStatus', 'submission_pending',
    'expectedStateVersion', 3, 'status', 'submitted'
  ));
  IF result->>'status' <> 'submitted'
     OR (result->>'state_version')::integer <> 4
     OR result->>'tx_hash' <> signature
     OR result->>'submitted_at' IS NULL THEN
    RAISE EXCEPTION 'submitted transition assertion failed: %', result;
  END IF;

  BEGIN
    PERFORM public.agent_transition_execution_v1(jsonb_build_object(
      'executionId', execution, 'actorId', actor, 'expectedStatus', 'submitted',
      'expectedStateVersion', 4, 'status', 'reconciliation_required',
      'txHash', 'mutated-signature'
    ));
    RAISE EXCEPTION 'tx hash mutation unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  result := public.agent_transition_execution_v1(jsonb_build_object(
    'executionId', execution, 'actorId', actor, 'expectedStatus', 'submitted',
    'expectedStateVersion', 4, 'status', 'reconciliation_required'
  ));
  IF result->>'status' <> 'reconciliation_required'
     OR (result->>'state_version')::integer <> 5
     OR result->>'tx_hash' <> signature THEN
    RAISE EXCEPTION 'reconciliation transition assertion failed: %', result;
  END IF;
  SELECT status, state_version INTO observed_status, observed_version
  FROM public.agent_tasks WHERE task_id = task;
  IF observed_status <> 'reconciliation_required' OR observed_version <> 2 THEN
    RAISE EXCEPTION 'task reconciliation assertion failed: % v%', observed_status, observed_version;
  END IF;

  result := public.agent_transition_execution_v1(jsonb_build_object(
    'executionId', execution, 'actorId', actor,
    'expectedStatus', 'reconciliation_required',
    'expectedStateVersion', 5, 'status', 'confirmed'
  ));
  IF result->>'status' <> 'confirmed'
     OR (result->>'state_version')::integer <> 6
     OR result->>'completed_at' IS NULL THEN
    RAISE EXCEPTION 'confirmed transition assertion failed: %', result;
  END IF;

  SELECT status INTO observed_status
  FROM public.agent_tool_calls WHERE tool_call_id = tool_call;
  IF observed_status <> 'succeeded' THEN
    RAISE EXCEPTION 'tool terminal assertion failed: %', observed_status;
  END IF;

  BEGIN
    PERFORM public.agent_transition_execution_v1(jsonb_build_object(
      'executionId', execution, 'actorId', actor, 'expectedStatus', 'confirmed',
      'expectedStateVersion', 6, 'status', 'failed',
      'failure', jsonb_build_object('code', 'CHAIN_REJECTED')
    ));
    RAISE EXCEPTION 'terminal execution rewrite unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  result := public.agent_transition_execution_v1(jsonb_build_object(
    'executionId', execution, 'actorId', actor, 'expectedStatus', 'confirmed',
    'expectedStateVersion', 3, 'status', 'failed',
    'failure', jsonb_build_object('code', 'CHAIN_REJECTED')
  ));
  IF result IS NOT NULL THEN
    RAISE EXCEPTION 'stale transition unexpectedly succeeded: %', result;
  END IF;

  SELECT count(*) INTO observed_count
  FROM public.agent_execution_audit WHERE execution_id = execution;
  IF observed_count <> 5 THEN
    RAISE EXCEPTION 'execution audit assertion failed: %', observed_count;
  END IF;
  SELECT count(*) INTO observed_count
  FROM public.agent_event_outbox WHERE task_id = task;
  IF observed_count <> 5 THEN
    RAISE EXCEPTION 'task event assertion failed: %', observed_count;
  END IF;

  RAISE NOTICE
    'execution transition canary passed: submission_pending, submitted, reconciliation, confirmed, terminal and stale guards';
END;
$$;

ROLLBACK;
