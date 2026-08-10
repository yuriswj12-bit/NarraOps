-- Reinstall the service-role-only wallet-signed reservation function with an
-- explicitly parenthesized JSON idempotency-key extraction.

CREATE OR REPLACE FUNCTION public.agent_reserve_wallet_signed_execution_v1(
  p_record jsonb,
  p_evidence jsonb,
  p_expected_approval_version integer,
  p_expected_task_version integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := (p_record->>'actorId')::uuid;
  approval uuid := (p_record->>'approvalId')::uuid;
  approval_row public.agent_authorizations;
  intent_row public.agent_authorization_intents;
  existing_execution public.agent_executions;
  existing_evidence jsonb;
  reserved jsonb;
  approved_version integer;
BEGIN
  IF COALESCE(p_record->>'schemaVersion', '') <> 'agent.execution.v1'
     OR COALESCE(p_record->>'status', '') <> 'reserved'
     OR COALESCE(p_record->>'action', '') <> 'launch.broadcast'
     OR COALESCE(p_record->>'resourceType', '') <> 'go_launch_draft'
     OR COALESCE(p_record->>'provider', '') <> 'pump.fun'
     OR COALESCE(p_record->>'chain', '') <> 'solana'
     OR COALESCE(p_evidence->>'schemaVersion', '')
        <> 'agent.wallet_signature_confirmation.v1'
     OR COALESCE(p_evidence->>'messageHash', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(p_evidence->>'txSignature', '')
        !~ '^[1-9A-HJ-NP-Za-km-z]{64,100}$'
     OR COALESCE(p_evidence->>'signer', '')
        !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN
    RAISE EXCEPTION 'invalid wallet-signed execution reservation'
      USING ERRCODE = '22023';
  END IF;
  IF (p_evidence->>'verifiedAt')::timestamptz > now() + interval '30 seconds'
     OR (p_evidence->>'verifiedAt')::timestamptz < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'wallet confirmation timestamp is not recent'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      actor::text || ':wallet-signed:' || (p_record->>'idempotencyKey'),
      0
    )
  );

  SELECT * INTO existing_execution
  FROM public.agent_executions
  WHERE actor_id = actor
    AND idempotency_key = p_record->>'idempotencyKey';
  IF FOUND THEN
    SELECT payload INTO existing_evidence
    FROM public.agent_authorization_audit
    WHERE approval_id = existing_execution.approval_id
      AND event_type = 'approval.approved'
    ORDER BY audit_id DESC
    LIMIT 1;
    IF existing_evidence IS NULL
       OR existing_evidence->>'confirmation_kind' <> 'verified_wallet_signature'
       OR existing_evidence->>'message_hash' <> p_evidence->>'messageHash'
       OR existing_evidence->>'tx_signature' <> p_evidence->>'txSignature'
       OR existing_evidence->>'signer' <> p_evidence->>'signer' THEN
      RAISE EXCEPTION 'wallet confirmation idempotency conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.agent_reserve_execution_v1(
      p_record,
      p_expected_approval_version + 1,
      p_expected_task_version
    );
  END IF;

  SELECT * INTO approval_row
  FROM public.agent_authorizations
  WHERE approval_id = approval AND actor_id = actor
  FOR UPDATE;
  IF NOT FOUND
     OR approval_row.status <> 'requested'
     OR approval_row.state_version <> p_expected_approval_version
     OR approval_row.task_id <> (p_record->>'taskId')::uuid
     OR approval_row.tool_call_id <> (p_record->>'toolCallId')::uuid
     OR approval_row.intent_digest <> p_record->>'intentDigest'
     OR approval_row.expires_at <= now() THEN
    RETURN NULL;
  END IF;

  SELECT * INTO intent_row
  FROM public.agent_authorization_intents
  WHERE intent_id = approval_row.intent_id AND actor_id = actor
  FOR UPDATE;
  IF NOT FOUND
     OR intent_row.status <> 'requested'
     OR intent_row.state_version <> p_expected_approval_version
     OR intent_row.intent_digest <> p_record->>'intentDigest'
     OR intent_row.action <> 'launch.broadcast'
     OR intent_row.resource_type <> 'go_launch_draft'
     OR intent_row.resource_id <> p_record->>'resourceId'
     OR intent_row.parameters->>'message_hash' <> p_evidence->>'messageHash'
     OR intent_row.parameters->>'fee_payer' <> p_evidence->>'signer' THEN
    RETURN NULL;
  END IF;

  approved_version := p_expected_approval_version + 1;
  UPDATE public.agent_authorizations
  SET status = 'approved',
      state_version = approved_version,
      decided_at = now()
  WHERE approval_id = approval;
  UPDATE public.agent_authorization_intents
  SET status = 'approved',
      state_version = approved_version,
      decided_at = now()
  WHERE intent_id = intent_row.intent_id;

  INSERT INTO public.agent_authorization_audit (
    approval_id, intent_id, actor_id, event_type, state_version, payload
  ) VALUES (
    approval, intent_row.intent_id, actor, 'approval.approved',
    approved_version,
    jsonb_build_object(
      'confirmation_kind', 'verified_wallet_signature',
      'message_hash', p_evidence->>'messageHash',
      'tx_signature', p_evidence->>'txSignature',
      'signer', p_evidence->>'signer',
      'verified_at', p_evidence->>'verifiedAt',
      'intent_digest', intent_row.intent_digest
    )
  );

  reserved := public.agent_reserve_execution_v1(
    p_record,
    approved_version,
    p_expected_task_version
  );
  IF reserved IS NULL THEN
    RAISE EXCEPTION 'wallet-signed execution reservation changed concurrently'
      USING ERRCODE = '40001';
  END IF;
  RETURN reserved;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_reserve_wallet_signed_execution_v1(
  jsonb, jsonb, integer, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_reserve_wallet_signed_execution_v1(
  jsonb, jsonb, integer, integer
) TO service_role;
