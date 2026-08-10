-- Self-cleaning production canary for the Agent catalog and memory control plane.
-- Any failed assertion aborts this migration; successful rows are deleted before commit.

do $$
declare
  agent_record jsonb;
  skill_record jsonb;
  manifest_record jsonb;
  memory_result jsonb;
  memory_record jsonb;
  active_memories jsonb;
begin
  if has_table_privilege('anon', 'public.agent_memory_items', 'select')
    or has_table_privilege('authenticated', 'public.agent_memory_items', 'select')
  then
    raise exception 'CANARY_PUBLIC_MEMORY_TABLE_ACCESSIBLE';
  end if;
  if has_function_privilege('anon', 'public.agent_propose_memory_v1(jsonb)', 'execute')
    or has_function_privilege(
      'authenticated',
      'public.agent_propose_memory_v1(jsonb)',
      'execute'
    )
  then
    raise exception 'CANARY_PUBLIC_MEMORY_RPC_ACCESSIBLE';
  end if;

  agent_record := public.agent_publish_definition_v1(jsonb_build_object(
    'schemaVersion', 'agent.definition.v1',
    'agentId', '10000000-0000-4000-8000-000000000001',
    'agentVersionId', '10000000-0000-4000-8000-000000000002',
    'slug', 'canary-agent',
    'version', 1,
    'name', 'Canary Agent',
    'status', 'published',
    'systemInstructions', 'Read-only canary instructions.',
    'capabilityManifest', jsonb_build_array('research.read'),
    'modelPolicy', jsonb_build_object(
      'allowedProviders', jsonb_build_array('canary-provider')
    ),
    'memoryPolicy', jsonb_build_object(
      'enabled', true,
      'allowedScopes', jsonb_build_array('user'),
      'retrievalLimit', 5,
      'requireUserConfirmation', true
    ),
    'checksum', repeat('a', 64),
    'createdAt', now(),
    'publishedAt', now()
  ));

  skill_record := public.agent_publish_skill_v1(jsonb_build_object(
    'schemaVersion', 'agent.skill.v1',
    'skillId', '20000000-0000-4000-8000-000000000001',
    'skillVersionId', '20000000-0000-4000-8000-000000000002',
    'slug', 'canary-research',
    'version', 1,
    'name', 'Canary Research',
    'status', 'published',
    'instructions', 'Read-only canary skill.',
    'inputSchema', jsonb_build_object('type', 'object'),
    'outputSchema', jsonb_build_object('type', 'object'),
    'risk', 'read_only',
    'sideEffect', 'none',
    'approvalPolicy', 'none',
    'requiredPermissions', '[]'::jsonb,
    'requiredTools', '[]'::jsonb,
    'resourceRefs', '[]'::jsonb,
    'checksum', repeat('b', 64),
    'createdAt', now(),
    'publishedAt', now()
  ));

  perform public.agent_bind_skill_v1(jsonb_build_object(
    'agentVersionId', agent_record->>'agentVersionId',
    'skillVersionId', skill_record->>'skillVersionId',
    'enabled', true,
    'priority', 10,
    'config', '{}'::jsonb,
    'createdAt', now()
  ));

  manifest_record := public.agent_get_manifest_v1('canary-agent');
  if manifest_record#>>'{agent,slug}' <> 'canary-agent'
    or jsonb_array_length(manifest_record->'skills') <> 1
  then
    raise exception 'CANARY_MANIFEST_INVALID';
  end if;

  memory_result := public.agent_propose_memory_v1(jsonb_build_object(
    'schemaVersion', 'agent.memory_item.v1',
    'memoryId', '30000000-0000-4000-8000-000000000001',
    'actorId', '40000000-0000-4000-8000-000000000001',
    'agentId', agent_record->>'agentId',
    'scope', 'user',
    'kind', 'user_preference',
    'content', 'Canary prefers Chinese responses.',
    'sensitivity', 'private',
    'source', jsonb_build_object(
      'type', 'runtime',
      'id', 'canary-runtime',
      'refs', '[]'::jsonb
    ),
    'confidence', 1,
    'status', 'proposed',
    'checksum', repeat('c', 64),
    'stateVersion', 1,
    'idempotencyKey', 'canary:memory:preference:1',
    'createdAt', now(),
    'updatedAt', now()
  ));
  memory_record := memory_result->'item';

  begin
    perform public.agent_decide_memory_v1(jsonb_build_object(
      'memoryId', memory_record->>'memoryId',
      'actorId', memory_record->>'actorId',
      'decision', 'active',
      'expectedStateVersion', 1,
      'confirmation', 'runtime_policy'
    ));
    raise exception 'CANARY_CONFIRMATION_BYPASS';
  exception
    when others then
      if sqlerrm not like '%AGENT_MEMORY_USER_CONFIRMATION_REQUIRED%' then
        raise;
      end if;
  end;

  memory_record := public.agent_decide_memory_v1(jsonb_build_object(
    'memoryId', memory_record->>'memoryId',
    'actorId', memory_record->>'actorId',
    'decision', 'active',
    'expectedStateVersion', 1,
    'confirmation', 'user_explicit'
  ));
  if memory_record->>'status' <> 'active'
    or (memory_record->>'stateVersion')::integer <> 2
  then
    raise exception 'CANARY_MEMORY_ACTIVATION_INVALID';
  end if;

  active_memories := public.agent_list_active_memories_v1(jsonb_build_object(
    'actorId', memory_record->>'actorId',
    'agentId', agent_record->>'agentId',
    'scopes', jsonb_build_array('user'),
    'kinds', jsonb_build_array('user_preference'),
    'limit', 5
  ));
  if jsonb_array_length(active_memories) <> 1 then
    raise exception 'CANARY_MEMORY_RETRIEVAL_INVALID';
  end if;

  memory_record := public.agent_forget_memory_v1(jsonb_build_object(
    'memoryId', memory_record->>'memoryId',
    'actorId', memory_record->>'actorId',
    'expectedStateVersion', 2
  ));
  if memory_record->>'status' <> 'deleted'
    or memory_record->>'content' <> '[deleted]'
  then
    raise exception 'CANARY_MEMORY_FORGET_INVALID';
  end if;

  delete from public.agent_memory_items
  where memory_id = '30000000-0000-4000-8000-000000000001';
  delete from public.agent_definitions
  where agent_id = '10000000-0000-4000-8000-000000000001';
  delete from public.agent_skills
  where skill_id = '20000000-0000-4000-8000-000000000001';
end;
$$;
