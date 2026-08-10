-- Durable approval lifecycle for Runtime v2.
-- These tables are intentionally separate from Phase 4 shadow records.
-- No function in this migration signs, submits, broadcasts, or executes tools.

CREATE TABLE IF NOT EXISTS public.agent_authorization_intents (
  intent_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  parameters jsonb NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  risk text NOT NULL CHECK (risk = 'financial_irreversible'),
  status text NOT NULL CHECK (status IN ('requested','approved','rejected','consumed','expired')),
  approval_policy text NOT NULL CHECK (approval_policy IN ('explicit','explicit_and_recent_auth')),
  idempotency_key text NOT NULL,
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz NULL,
  consumed_at timestamptz NULL,
  UNIQUE (actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.agent_authorizations (
  approval_id uuid PRIMARY KEY,
  intent_id uuid NOT NULL UNIQUE REFERENCES public.agent_authorization_intents(intent_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('requested','approved','rejected','consumed','expired')),
  approval_policy text NOT NULL CHECK (approval_policy IN ('explicit','explicit_and_recent_auth')),
  idempotency_key text NOT NULL,
  state_version integer NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz NULL,
  consumed_at timestamptz NULL,
  recent_auth_at timestamptz NULL,
  UNIQUE (actor_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.agent_authorization_audit (
  audit_id bigserial PRIMARY KEY,
  approval_id uuid NOT NULL REFERENCES public.agent_authorizations(approval_id) ON DELETE CASCADE,
  intent_id uuid NOT NULL REFERENCES public.agent_authorization_intents(intent_id) ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  event_type text NOT NULL,
  state_version integer NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_authorizations_actor_status_idx
  ON public.agent_authorizations (actor_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS agent_authorization_audit_approval_idx
  ON public.agent_authorization_audit (approval_id, audit_id);

ALTER TABLE public.agent_authorization_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_authorization_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_authorization_intents FROM anon, authenticated;
REVOKE ALL ON public.agent_authorizations FROM anon, authenticated;
REVOKE ALL ON public.agent_authorization_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_request_approval_v1(p_record jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  intent_input jsonb := p_record->'intent';
  actor uuid;
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
    RAISE EXCEPTION 'invalid approval request' USING ERRCODE = '22023';
  END IF;

  actor := (p_record->>'actorId')::uuid;
  request_key := p_record->>'idempotencyKey';
  expires := (p_record->>'expiresAt')::timestamptz;
  IF request_key !~ '^[A-Za-z0-9._:-]{8,255}$'
     OR expires <= now()
     OR expires > now() + interval '30 minutes' THEN
    RAISE EXCEPTION 'invalid approval request lifetime or idempotency key'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text || ':' || request_key, 0));
  SELECT * INTO existing_approval
  FROM public.agent_authorizations
  WHERE actor_id = actor AND idempotency_key = request_key;
  IF FOUND THEN
    SELECT * INTO existing_intent
    FROM public.agent_authorization_intents
    WHERE intent_id = existing_approval.intent_id;
    IF existing_intent.intent_digest <> intent_input->>'intentDigest' THEN
      RAISE EXCEPTION 'approval idempotency conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object(
      'approval', to_jsonb(existing_approval),
      'intent', to_jsonb(existing_intent),
      'idempotentReplay', true
    );
  END IF;

  INSERT INTO public.agent_authorization_intents (
    intent_id, actor_id, action, resource_type, resource_id, parameters,
    intent_digest, risk, status, approval_policy, idempotency_key,
    state_version, created_at, expires_at
  ) VALUES (
    (intent_input->>'intentId')::uuid,
    actor,
    intent_input->>'action',
    intent_input->>'resourceType',
    intent_input->>'resourceId',
    COALESCE(intent_input->'parameters', '{}'::jsonb),
    intent_input->>'intentDigest',
    intent_input->>'risk',
    'requested',
    p_record->>'policy',
    request_key,
    1,
    (intent_input->>'createdAt')::timestamptz,
    expires
  ) RETURNING * INTO persisted_intent;

  INSERT INTO public.agent_authorizations (
    approval_id, intent_id, actor_id, intent_digest, status, approval_policy,
    idempotency_key, state_version, requested_at, expires_at
  ) VALUES (
    (p_record->>'approvalId')::uuid,
    persisted_intent.intent_id,
    actor,
    persisted_intent.intent_digest,
    'requested',
    p_record->>'policy',
    request_key,
    1,
    (p_record->>'requestedAt')::timestamptz,
    expires
  ) RETURNING * INTO persisted_approval;

  INSERT INTO public.agent_authorization_audit (
    approval_id, intent_id, actor_id, event_type, state_version, payload
  ) VALUES (
    persisted_approval.approval_id,
    persisted_intent.intent_id,
    actor,
    'approval.requested',
    1,
    jsonb_build_object(
      'action', persisted_intent.action,
      'resource_type', persisted_intent.resource_type,
      'resource_id', persisted_intent.resource_id,
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

CREATE OR REPLACE FUNCTION public.agent_decide_approval_v1(
  p_approval_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_expected_version integer,
  p_recent_auth_at timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  approval_row public.agent_authorizations;
  intent_row public.agent_authorization_intents;
  next_version integer;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'invalid approval decision' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO approval_row
  FROM public.agent_authorizations
  WHERE approval_id = p_approval_id AND actor_id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND OR approval_row.status <> 'requested'
     OR approval_row.state_version <> p_expected_version THEN
    RETURN NULL;
  END IF;

  SELECT * INTO intent_row
  FROM public.agent_authorization_intents
  WHERE intent_id = approval_row.intent_id AND actor_id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND OR intent_row.status <> 'requested'
     OR intent_row.state_version <> p_expected_version THEN
    RETURN NULL;
  END IF;

  next_version := p_expected_version + 1;
  IF approval_row.expires_at <= now() THEN
    UPDATE public.agent_authorizations
      SET status = 'expired', state_version = next_version
      WHERE approval_id = p_approval_id
      RETURNING * INTO approval_row;
    UPDATE public.agent_authorization_intents
      SET status = 'expired', state_version = next_version
      WHERE intent_id = intent_row.intent_id
      RETURNING * INTO intent_row;
    INSERT INTO public.agent_authorization_audit (
      approval_id, intent_id, actor_id, event_type, state_version
    ) VALUES (
      approval_row.approval_id, intent_row.intent_id, p_actor_id,
      'approval.expired', next_version
    );
    RETURN jsonb_build_object('approval', to_jsonb(approval_row), 'intent', to_jsonb(intent_row));
  END IF;

  IF p_decision = 'approved'
     AND approval_row.approval_policy = 'explicit_and_recent_auth'
     AND (
       p_recent_auth_at IS NULL
       OR p_recent_auth_at > now() + interval '30 seconds'
       OR p_recent_auth_at < now() - interval '5 minutes'
     ) THEN
    RAISE EXCEPTION 'recent authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.agent_authorizations SET
    status = p_decision,
    state_version = next_version,
    decided_at = now(),
    recent_auth_at = CASE WHEN p_decision = 'approved' THEN p_recent_auth_at ELSE NULL END
  WHERE approval_id = p_approval_id
  RETURNING * INTO approval_row;

  UPDATE public.agent_authorization_intents SET
    status = p_decision,
    state_version = next_version,
    decided_at = now()
  WHERE intent_id = intent_row.intent_id
  RETURNING * INTO intent_row;

  INSERT INTO public.agent_authorization_audit (
    approval_id, intent_id, actor_id, event_type, state_version, payload
  ) VALUES (
    approval_row.approval_id,
    intent_row.intent_id,
    p_actor_id,
    'approval.' || p_decision,
    next_version,
    jsonb_build_object('intent_digest', intent_row.intent_digest)
  );
  RETURN jsonb_build_object('approval', to_jsonb(approval_row), 'intent', to_jsonb(intent_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_consume_approval_v1(
  p_approval_id uuid,
  p_actor_id uuid,
  p_intent_digest text,
  p_expected_version integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  approval_row public.agent_authorizations;
  intent_row public.agent_authorization_intents;
  next_version integer;
BEGIN
  SELECT * INTO approval_row
  FROM public.agent_authorizations
  WHERE approval_id = p_approval_id AND actor_id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND OR approval_row.status <> 'approved'
     OR approval_row.state_version <> p_expected_version
     OR approval_row.intent_digest <> p_intent_digest THEN
    RETURN NULL;
  END IF;

  SELECT * INTO intent_row
  FROM public.agent_authorization_intents
  WHERE intent_id = approval_row.intent_id AND actor_id = p_actor_id
  FOR UPDATE;
  IF NOT FOUND OR intent_row.status <> 'approved'
     OR intent_row.state_version <> p_expected_version
     OR intent_row.intent_digest <> p_intent_digest THEN
    RETURN NULL;
  END IF;

  next_version := p_expected_version + 1;
  IF approval_row.expires_at <= now() THEN
    UPDATE public.agent_authorizations
      SET status = 'expired', state_version = next_version
      WHERE approval_id = p_approval_id
      RETURNING * INTO approval_row;
    UPDATE public.agent_authorization_intents
      SET status = 'expired', state_version = next_version
      WHERE intent_id = intent_row.intent_id
      RETURNING * INTO intent_row;
    INSERT INTO public.agent_authorization_audit (
      approval_id, intent_id, actor_id, event_type, state_version
    ) VALUES (
      approval_row.approval_id, intent_row.intent_id, p_actor_id,
      'approval.expired', next_version
    );
    RETURN jsonb_build_object('approval', to_jsonb(approval_row), 'intent', to_jsonb(intent_row));
  END IF;

  UPDATE public.agent_authorizations SET
    status = 'consumed',
    state_version = next_version,
    consumed_at = now()
  WHERE approval_id = p_approval_id
  RETURNING * INTO approval_row;
  UPDATE public.agent_authorization_intents SET
    status = 'consumed',
    state_version = next_version,
    consumed_at = now()
  WHERE intent_id = intent_row.intent_id
  RETURNING * INTO intent_row;

  INSERT INTO public.agent_authorization_audit (
    approval_id, intent_id, actor_id, event_type, state_version, payload
  ) VALUES (
    approval_row.approval_id,
    intent_row.intent_id,
    p_actor_id,
    'approval.consumed',
    next_version,
    jsonb_build_object('intent_digest', intent_row.intent_digest)
  );
  RETURN jsonb_build_object('approval', to_jsonb(approval_row), 'intent', to_jsonb(intent_row));
END;
$$;

REVOKE ALL ON FUNCTION public.agent_request_approval_v1(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_decide_approval_v1(uuid, uuid, text, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_consume_approval_v1(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agent_request_approval_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_decide_approval_v1(uuid, uuid, text, integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_consume_approval_v1(uuid, uuid, text, integer) TO service_role;

COMMENT ON TABLE public.agent_authorizations IS
  'Durable Runtime approval lifecycle. Records alone do not execute tools or transactions.';
