BEGIN;

DO $$
DECLARE
  actor constant uuid := '219bd461-b0c5-45a6-8e93-83a094397eda';
  shadow constant uuid := 'f83302c9-8565-4451-91ac-8a9508d73a3d';
  execution constant uuid := '446f5b64-7c7a-4f5f-a1e6-08dca3a12aa4';
  intent_digest constant text := repeat('a', 64);
  envelope_digest constant text := repeat('b', 64);
  message_hash constant text := repeat('c', 64);
  record jsonb;
  persisted jsonb;
  replayed jsonb;
  observed_count integer;
BEGIN
  record := jsonb_build_object(
    'schemaVersion', 'agent.semantic_shadow.v1',
    'shadowId', shadow,
    'actorId', actor,
    'action', 'launch.broadcast',
    'resourceType', 'go_launch_draft',
    'resourceId', 'canary-pump-draft',
    'envelope', jsonb_build_object(
      'schemaVersion', 'agent.execution_envelope.v1',
      'executionId', execution,
      'actorId', actor,
      'intentDigest', intent_digest,
      'action', 'launch.broadcast',
      'chain', jsonb_build_object('kind', 'solana', 'network', 'mainnet-beta'),
      'transactions', jsonb_build_array(jsonb_build_object(
        'transactionId', 'pump-launch-1',
        'signer', 'canary-payer',
        'messageHash', message_hash,
        'valueAtomic', '0',
        'programIds', jsonb_build_array('canary-pump-program'),
        'recipients', '[]'::jsonb,
        'operation', jsonb_build_object(
          'kind', 'pump.launch',
          'mintAddress', 'canary-mint',
          'name', 'Canary',
          'symbol', 'CNY',
          'metadataUri', 'https://example.com/canary.json',
          'creator', 'canary-payer',
          'developerBuyLamports', '0'
        ),
        'maxSlippageBps', 0,
        'maxFeeAtomic', '10000',
        'lastValidBlockHeight', 999999999
      )),
      'createdAt', now(),
      'expiresAt', now() + interval '5 minutes',
      'envelopeDigest', envelope_digest
    ),
    'inspections', jsonb_build_array(jsonb_build_object(
      'schemaVersion', 'agent.transaction_inspection.v1',
      'executionId', execution,
      'transactionId', 'pump-launch-1',
      'chain', jsonb_build_object('kind', 'solana', 'network', 'mainnet-beta'),
      'signer', 'canary-payer',
      'messageHash', message_hash,
      'valueAtomic', '0',
      'programIds', jsonb_build_array('canary-pump-program'),
      'recipients', '[]'::jsonb,
      'operation', jsonb_build_object(
        'kind', 'pump.launch',
        'mintAddress', 'canary-mint',
        'name', 'Canary',
        'symbol', 'CNY',
        'metadataUri', 'https://example.com/canary.json',
        'creator', 'canary-payer',
        'developerBuyLamports', '0'
      ),
      'slippageBps', 0,
      'estimatedFeeAtomic', '5000',
      'currentBlockHeight', 1,
      'observedAt', now()
    )),
    'shadowMode', true,
    'recordedAt', now()
  );

  persisted := public.agent_record_semantic_shadow_v1(record);
  replayed := public.agent_record_semantic_shadow_v1(
    jsonb_set(record, '{shadowId}', to_jsonb(gen_random_uuid()))
  );
  IF persisted->>'shadow_id' <> shadow::text
     OR replayed->>'shadow_id' <> shadow::text
     OR (persisted->>'shadow_mode')::boolean <> true
     OR persisted->>'envelope_digest' <> envelope_digest
     OR persisted->>'message_hash' <> message_hash THEN
    RAISE EXCEPTION 'semantic shadow persistence assertion failed: % / %',
      persisted, replayed;
  END IF;

  SELECT count(*) INTO observed_count
  FROM public.agent_semantic_shadow_audit
  WHERE shadow_id = shadow;
  IF observed_count <> 1 THEN
    RAISE EXCEPTION 'semantic shadow audit assertion failed: %', observed_count;
  END IF;

  BEGIN
    PERFORM public.agent_record_semantic_shadow_v1(
      jsonb_set(record, '{shadowMode}', 'false'::jsonb)
    );
    RAISE EXCEPTION 'non-shadow semantic record unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  RAISE NOTICE 'semantic shadow canary passed: immutable shadow, replay, audit';
END;
$$;

ROLLBACK;
