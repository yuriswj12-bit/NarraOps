-- Runtime v2 trusted semantic inspection shadow observations.
-- Shadow records are physically incapable of authorizing or executing work.

CREATE TABLE IF NOT EXISTS public.agent_semantic_shadows (
  shadow_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  execution_id uuid NOT NULL,
  intent_digest text NOT NULL CHECK (intent_digest ~ '^[a-f0-9]{64}$'),
  envelope_digest text NOT NULL CHECK (envelope_digest ~ '^[a-f0-9]{64}$'),
  message_hash text NOT NULL CHECK (message_hash ~ '^[a-f0-9]{64}$'),
  semantic_envelope jsonb NOT NULL,
  inspections jsonb NOT NULL,
  shadow_mode boolean NOT NULL DEFAULT true CHECK (shadow_mode = true),
  recorded_at timestamptz NOT NULL,
  UNIQUE (actor_id, action, resource_type, resource_id, envelope_digest)
);

CREATE TABLE IF NOT EXISTS public.agent_semantic_shadow_audit (
  audit_id bigserial PRIMARY KEY,
  shadow_id uuid NOT NULL REFERENCES public.agent_semantic_shadows(shadow_id)
    ON DELETE CASCADE,
  actor_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shadow_id, event_type)
);

CREATE INDEX IF NOT EXISTS agent_semantic_shadows_actor_recorded_idx
  ON public.agent_semantic_shadows (actor_id, recorded_at DESC);
ALTER TABLE public.agent_semantic_shadows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_semantic_shadow_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_semantic_shadows FROM anon, authenticated;
REVOKE ALL ON public.agent_semantic_shadow_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.agent_record_semantic_shadow_v1(
  p_record jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  envelope jsonb := p_record->'envelope';
  inspections jsonb := p_record->'inspections';
  persisted public.agent_semantic_shadows;
BEGIN
  IF COALESCE(p_record->>'schemaVersion', '') <> 'agent.semantic_shadow.v1'
     OR COALESCE((p_record->>'shadowMode')::boolean, false) <> true
     OR COALESCE(envelope->>'schemaVersion', '') <> 'agent.execution_envelope.v1'
     OR COALESCE(envelope->>'actorId', '') <> COALESCE(p_record->>'actorId', '')
     OR COALESCE(envelope->>'action', '') <> COALESCE(p_record->>'action', '')
     OR COALESCE(envelope->>'intentDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(envelope->>'envelopeDigest', '') !~ '^[a-f0-9]{64}$'
     OR COALESCE(jsonb_typeof(inspections), '') <> 'array'
     OR jsonb_array_length(inspections) < 1
     OR jsonb_array_length(inspections) > 100
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(inspections) inspection
       WHERE COALESCE(inspection->>'schemaVersion', '') <> 'agent.transaction_inspection.v1'
          OR COALESCE(inspection->>'executionId', '') <> COALESCE(envelope->>'executionId', '')
          OR COALESCE(inspection->>'messageHash', '') !~ '^[a-f0-9]{64}$'
     ) THEN
    RAISE EXCEPTION 'invalid semantic shadow record' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agent_semantic_shadows (
    shadow_id, actor_id, action, resource_type, resource_id, execution_id,
    intent_digest, envelope_digest, message_hash, semantic_envelope,
    inspections, shadow_mode, recorded_at
  ) VALUES (
    (p_record->>'shadowId')::uuid,
    (p_record->>'actorId')::uuid,
    p_record->>'action',
    p_record->>'resourceType',
    p_record->>'resourceId',
    (envelope->>'executionId')::uuid,
    envelope->>'intentDigest',
    envelope->>'envelopeDigest',
    inspections->0->>'messageHash',
    envelope,
    inspections,
    true,
    (p_record->>'recordedAt')::timestamptz
  )
  ON CONFLICT (actor_id, action, resource_type, resource_id, envelope_digest)
  DO UPDATE SET shadow_id = public.agent_semantic_shadows.shadow_id
  RETURNING * INTO persisted;

  INSERT INTO public.agent_semantic_shadow_audit (
    shadow_id, actor_id, event_type, payload, created_at
  ) VALUES (
    persisted.shadow_id,
    persisted.actor_id,
    'semantic_shadow.recorded',
    jsonb_build_object(
      'action', persisted.action,
      'resource_type', persisted.resource_type,
      'resource_id', persisted.resource_id,
      'execution_id', persisted.execution_id,
      'intent_digest', persisted.intent_digest,
      'envelope_digest', persisted.envelope_digest,
      'message_hash', persisted.message_hash
    ),
    persisted.recorded_at
  )
  ON CONFLICT DO NOTHING;

  RETURN to_jsonb(persisted);
END;
$$;

REVOKE ALL ON FUNCTION public.agent_record_semantic_shadow_v1(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_record_semantic_shadow_v1(jsonb)
  TO service_role;

COMMENT ON TABLE public.agent_semantic_shadows IS
  'Trusted transaction semantic observations in non-authorizing shadow mode.';
