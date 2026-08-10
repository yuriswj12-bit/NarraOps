-- Self-cleaning contract canary using the Runtime's exact Skill enum values.

do $$
declare
  skill_record jsonb;
begin
  skill_record := public.agent_publish_skill_v1(jsonb_build_object(
    'schemaVersion', 'agent.skill.v1',
    'skillId', '50000000-0000-4000-8000-000000000001',
    'skillVersionId', '50000000-0000-4000-8000-000000000002',
    'slug', 'canary-runtime-contract',
    'version', 1,
    'name', 'Canary Runtime Contract',
    'status', 'published',
    'instructions', 'Read-only Runtime contract canary.',
    'inputSchema', jsonb_build_object('type', 'object'),
    'outputSchema', jsonb_build_object('type', 'object'),
    'risk', 'read',
    'sideEffect', 'none',
    'approvalPolicy', 'none',
    'requiredPermissions', jsonb_build_array('research:read'),
    'requiredTools', jsonb_build_array(jsonb_build_object(
      'name', 'research.public.read',
      'version', '1.0.0'
    )),
    'resourceRefs', '[]'::jsonb,
    'checksum', repeat('d', 64),
    'createdAt', now(),
    'publishedAt', now()
  ));

  if skill_record->>'risk' <> 'read'
    or skill_record->>'sideEffect' <> 'none'
    or skill_record->>'approvalPolicy' <> 'none'
  then
    raise exception 'CANARY_RUNTIME_SKILL_CONTRACT_INVALID';
  end if;

  delete from public.agent_skills
  where skill_id = '50000000-0000-4000-8000-000000000001';
end;
$$;
