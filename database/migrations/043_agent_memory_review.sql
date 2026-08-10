-- Actor-bound Memory review for user-visible settings. This remains
-- service-role-only; browser clients call the authenticated NarraOps API.

create or replace function public.agent_list_memories_for_review_v1(p_record jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requested_statuses jsonb := coalesce(p_record->'statuses', '["proposed","active"]'::jsonb);
begin
  if nullif(p_record->>'actorId', '') is null then
    raise exception 'AGENT_MEMORY_ACTOR_REQUIRED';
  end if;
  if exists (
    select 1
    from jsonb_array_elements_text(requested_statuses) as requested(status)
    where requested.status not in ('proposed', 'active')
  ) then
    raise exception 'AGENT_MEMORY_STATUS_INVALID';
  end if;

  return (
    select coalesce(
      jsonb_agg(public.agent_memory_item_json_v1(filtered) order by filtered.updated_at desc),
      '[]'::jsonb
    )
    from (
      select m.*
      from public.agent_memory_items m
      where m.actor_id = (p_record->>'actorId')::uuid
        and requested_statuses ? m.status
        and (m.expires_at is null or m.expires_at > now())
        and (
          jsonb_array_length(coalesce(p_record->'scopes', '[]'::jsonb)) = 0
          or (p_record->'scopes') ? m.scope
        )
        and (
          jsonb_array_length(coalesce(p_record->'kinds', '[]'::jsonb)) = 0
          or (p_record->'kinds') ? m.kind
        )
      order by m.updated_at desc
      limit least(50, greatest(1, coalesce((p_record->>'limit')::integer, 20)))
    ) filtered
  );
end;
$$;

revoke all on function public.agent_list_memories_for_review_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.agent_list_memories_for_review_v1(jsonb)
  to service_role;
