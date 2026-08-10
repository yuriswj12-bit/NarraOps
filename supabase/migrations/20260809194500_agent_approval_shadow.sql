-- Deployment mirror of database/migrations/024_agent_approval_shadow.sql.
-- Shadow records do not authorize or execute financial actions.

CREATE TABLE IF NOT EXISTS public.agent_execution_intents (
  intent_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  intent_digest text NOT NULL,
  risk text NOT NULL CHECK (risk = 'financial_irreversible'),
  status text NOT NULL CHECK (status IN ('requested','approved','rejected','consumed','expired')),
  shadow_mode boolean NOT NULL DEFAULT true CHECK (shadow_mode = true),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (actor_id, intent_digest, status)
);
CREATE TABLE IF NOT EXISTS public.agent_approvals (
  approval_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL REFERENCES public.agent_execution_intents(intent_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  intent_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('requested','approved','rejected','consumed','expired')),
  legacy_confirmation_kind text NOT NULL,
  legacy_request_id text NULL,
  shadow_mode boolean NOT NULL DEFAULT true CHECK (shadow_mode = true),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, intent_digest, status)
);
CREATE TABLE IF NOT EXISTS public.agent_approval_audit (
  audit_id bigserial PRIMARY KEY,
  approval_id uuid NOT NULL REFERENCES public.agent_approvals(approval_id) ON DELETE CASCADE,
  intent_id uuid NOT NULL REFERENCES public.agent_execution_intents(intent_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_execution_intents_actor_created_idx ON public.agent_execution_intents (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agent_approvals_intent_recorded_idx ON public.agent_approvals (intent_id, recorded_at DESC);
ALTER TABLE public.agent_execution_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_approval_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_execution_intents FROM anon, authenticated;
REVOKE ALL ON public.agent_approvals FROM anon, authenticated;
REVOKE ALL ON public.agent_approval_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_record_approval_shadow_v1(p_record jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  intent_input jsonb := p_record->'intent';
  persisted_intent public.agent_execution_intents;
  persisted_approval public.agent_approvals;
BEGIN
  IF COALESCE(p_record->>'schemaVersion', '') <> 'agent.approval_shadow.v1'
     OR COALESCE(intent_input->>'schemaVersion', '') <> 'agent.execution_intent.v1'
     OR COALESCE(p_record->>'actorId', '') <> COALESCE(intent_input->>'actorId', '')
     OR length(COALESCE(intent_input->>'intentDigest', '')) <> 64
  THEN RAISE EXCEPTION 'invalid approval shadow record' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.agent_execution_intents (
    intent_id, actor_id, action, resource_type, resource_id, parameters,
    intent_digest, risk, status, shadow_mode, created_at, expires_at
  ) VALUES (
    (intent_input->>'intentId')::uuid, (intent_input->>'actorId')::uuid,
    intent_input->>'action', intent_input->>'resourceType', intent_input->>'resourceId',
    COALESCE(intent_input->'parameters', '{}'::jsonb), intent_input->>'intentDigest',
    intent_input->>'risk', intent_input->>'status', true,
    (intent_input->>'createdAt')::timestamptz, (intent_input->>'expiresAt')::timestamptz
  ) ON CONFLICT (actor_id, intent_digest, status) DO UPDATE
    SET intent_digest = EXCLUDED.intent_digest RETURNING * INTO persisted_intent;
  INSERT INTO public.agent_approvals (
    approval_id, intent_id, actor_id, intent_digest, status,
    legacy_confirmation_kind, legacy_request_id, shadow_mode, recorded_at
  ) VALUES (
    (p_record->>'approvalId')::uuid, persisted_intent.intent_id,
    (p_record->>'actorId')::uuid, intent_input->>'intentDigest', p_record->>'status',
    p_record->>'legacyConfirmationKind', NULLIF(p_record->>'legacyRequestId', ''),
    true, (p_record->>'recordedAt')::timestamptz
  ) ON CONFLICT (actor_id, intent_digest, status) DO UPDATE
    SET intent_id = EXCLUDED.intent_id RETURNING * INTO persisted_approval;
  INSERT INTO public.agent_approval_audit (approval_id, intent_id, actor_id, event_type, payload)
  VALUES (
    persisted_approval.approval_id, persisted_intent.intent_id, persisted_approval.actor_id,
    'approval.shadow_recorded',
    jsonb_build_object('action', persisted_intent.action, 'resource_type', persisted_intent.resource_type,
      'resource_id', persisted_intent.resource_id, 'intent_digest', persisted_intent.intent_digest,
      'status', persisted_approval.status, 'legacy_confirmation_kind', persisted_approval.legacy_confirmation_kind)
  );
  RETURN jsonb_build_object(
    'record', p_record || jsonb_build_object('approvalId', persisted_approval.approval_id)
      || jsonb_build_object('intent', intent_input || jsonb_build_object('intentId', persisted_intent.intent_id)),
    'shadowMode', true);
END;
$$;
REVOKE ALL ON FUNCTION public.agent_record_approval_shadow_v1(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_record_approval_shadow_v1(jsonb) TO service_role;
COMMENT ON TABLE public.agent_execution_intents IS 'Shadow-only exact financial intents. Presence does not grant execution authorization.';
COMMENT ON TABLE public.agent_approvals IS 'Shadow records of legacy confirmations. Runtime enforcement is intentionally disabled in Phase 4 shadow mode.';
