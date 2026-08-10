-- User memories without an agent_id are global to that actor and may be
-- projected into any Agent whose memory policy permits their scope.

create or replace function public.agent_list_active_memories_v1(p_record jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(public.agent_memory_item_json_v1(filtered) order by filtered.updated_at desc),
    '[]'::jsonb
  )
  from (
    select m.*
    from public.agent_memory_items m
    where m.actor_id = (p_record->>'actorId')::uuid
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and (
        nullif(p_record->>'agentId', '') is null
        or m.agent_id is null
        or m.agent_id = (p_record->>'agentId')::uuid
      )
      and (
        jsonb_array_length(coalesce(p_record->'scopes', '[]'::jsonb)) = 0
        or (p_record->'scopes') ? m.scope
      )
      and (
        jsonb_array_length(coalesce(p_record->'kinds', '[]'::jsonb)) = 0
        or (p_record->'kinds') ? m.kind
      )
    order by m.updated_at desc
    limit least(50, greatest(1, coalesce((p_record->>'limit')::integer, 10)))
  ) filtered;
$$;

revoke all on function public.agent_list_active_memories_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_list_active_memories_v1(jsonb) to service_role;
