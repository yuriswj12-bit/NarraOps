-- Self-cleaning canary: global actor memory is visible through an Agent filter.

do $$
declare
  memory_record jsonb;
  memories jsonb;
begin
  memory_record := public.agent_propose_memory_v1(jsonb_build_object(
    'schemaVersion', 'agent.memory_item.v1',
    'memoryId', '60000000-0000-4000-8000-000000000001',
    'actorId', '60000000-0000-4000-8000-000000000002',
    'scope', 'user',
    'kind', 'user_preference',
    'content', 'Global memory canary.',
    'sensitivity', 'private',
    'source', jsonb_build_object('type', 'runtime', 'id', 'global-canary', 'refs', '[]'::jsonb),
    'confidence', 1,
    'status', 'proposed',
    'checksum', repeat('e', 64),
    'stateVersion', 1,
    'idempotencyKey', 'canary:global-memory:1',
    'createdAt', now(),
    'updatedAt', now()
  ))->'item';

  memory_record := public.agent_decide_memory_v1(jsonb_build_object(
    'memoryId', memory_record->>'memoryId',
    'actorId', memory_record->>'actorId',
    'decision', 'active',
    'expectedStateVersion', 1,
    'confirmation', 'user_explicit'
  ));

  memories := public.agent_list_active_memories_v1(jsonb_build_object(
    'actorId', memory_record->>'actorId',
    'agentId', '60000000-0000-4000-8000-000000000003',
    'scopes', jsonb_build_array('user'),
    'kinds', jsonb_build_array('user_preference'),
    'limit', 5
  ));
  if jsonb_array_length(memories) <> 1 then
    raise exception 'CANARY_GLOBAL_MEMORY_RETRIEVAL_INVALID';
  end if;

  delete from public.agent_memory_items
  where memory_id = '60000000-0000-4000-8000-000000000001';
end;
$$;
