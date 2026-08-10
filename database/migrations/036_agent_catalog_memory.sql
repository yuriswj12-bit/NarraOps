-- NarraOps Agent control plane: versioned Agent/Skill catalog and durable memory.
-- Service-role only. Stored skills are declarative data, never executable code.

create table if not exists public.agent_definitions (
  agent_id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{2,63}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text null,
  status text not null check (status in ('draft', 'published', 'retired')),
  current_version_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_definition_versions (
  agent_version_id uuid primary key,
  agent_id uuid not null references public.agent_definitions(agent_id) on delete cascade,
  version integer not null check (version > 0),
  system_instructions text not null check (
    char_length(system_instructions) between 1 and 50000
  ),
  capability_manifest jsonb not null default '[]'::jsonb check (
    jsonb_typeof(capability_manifest) = 'array'
  ),
  model_policy jsonb not null check (jsonb_typeof(model_policy) = 'object'),
  memory_policy jsonb not null check (jsonb_typeof(memory_policy) = 'object'),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('draft', 'published', 'retired')),
  created_at timestamptz not null default now(),
  published_at timestamptz null,
  unique (agent_id, version),
  unique (agent_version_id, agent_id)
);

alter table public.agent_definitions
  add constraint agent_definitions_current_version_fk
  foreign key (current_version_id, agent_id)
  references public.agent_definition_versions(agent_version_id, agent_id)
  deferrable initially deferred;

create table if not exists public.agent_skills (
  skill_id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z][a-z0-9-]{2,63}$'),
  name text not null check (char_length(name) between 1 and 120),
  description text null,
  status text not null check (status in ('draft', 'published', 'retired')),
  current_version_id uuid null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_skill_versions (
  skill_version_id uuid primary key,
  skill_id uuid not null references public.agent_skills(skill_id) on delete cascade,
  version integer not null check (version > 0),
  instructions text not null check (char_length(instructions) between 1 and 50000),
  input_schema jsonb not null check (jsonb_typeof(input_schema) = 'object'),
  output_schema jsonb not null check (jsonb_typeof(output_schema) = 'object'),
  risk text not null check (
    risk in ('read_only', 'reversible', 'sensitive', 'financial_irreversible')
  ),
  side_effect text not null check (
    side_effect in ('none', 'data', 'external', 'funds')
  ),
  approval_policy text not null check (
    approval_policy in ('none', 'explicit', 'recent_auth', 'wallet_signature')
  ),
  required_permissions jsonb not null default '[]'::jsonb check (
    jsonb_typeof(required_permissions) = 'array'
  ),
  required_tools jsonb not null default '[]'::jsonb check (
    jsonb_typeof(required_tools) = 'array'
  ),
  resource_refs jsonb not null default '[]'::jsonb check (
    jsonb_typeof(resource_refs) = 'array'
  ),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('draft', 'published', 'retired')),
  created_at timestamptz not null default now(),
  published_at timestamptz null,
  unique (skill_id, version),
  unique (skill_version_id, skill_id),
  check (
    risk <> 'financial_irreversible'
    or (side_effect = 'funds' and approval_policy <> 'none')
  )
);

alter table public.agent_skills
  add constraint agent_skills_current_version_fk
  foreign key (current_version_id, skill_id)
  references public.agent_skill_versions(skill_version_id, skill_id)
  deferrable initially deferred;

create table if not exists public.agent_skill_bindings (
  agent_version_id uuid not null
    references public.agent_definition_versions(agent_version_id) on delete cascade,
  skill_version_id uuid not null
    references public.agent_skill_versions(skill_version_id) on delete restrict,
  enabled boolean not null default true,
  priority integer not null default 100 check (priority between -10000 and 10000),
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  primary key (agent_version_id, skill_version_id)
);

create table if not exists public.agent_memory_items (
  memory_id uuid primary key,
  actor_id uuid not null,
  agent_id uuid null references public.agent_definitions(agent_id) on delete set null,
  conversation_id uuid null
    references public.agent_conversations(conversation_id) on delete cascade,
  task_id uuid null references public.agent_tasks(task_id) on delete cascade,
  scope text not null check (scope in ('user', 'conversation', 'task')),
  kind text not null check (
    kind in (
      'user_preference',
      'user_fact',
      'conversation_summary',
      'task_outcome',
      'operational_fact',
      'failure_learning'
    )
  ),
  content text not null check (
    octet_length(convert_to(content, 'UTF8')) between 1 and 8192
  ),
  structured_value jsonb null check (
    structured_value is null or jsonb_typeof(structured_value) = 'object'
  ),
  sensitivity text not null check (sensitivity in ('private', 'sensitive')),
  source_type text not null check (
    source_type in ('user_message', 'conversation', 'task', 'artifact', 'runtime')
  ),
  source_id text not null check (char_length(source_id) between 1 and 255),
  source_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array'),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  status text not null check (
    status in ('proposed', 'active', 'rejected', 'superseded', 'expired', 'deleted')
  ),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  state_version integer not null default 1 check (state_version > 0),
  idempotency_key text not null check (
    idempotency_key ~ '^[A-Za-z0-9._:-]{8,255}$'
  ),
  activated_at timestamptz null,
  expires_at timestamptz null,
  superseded_by uuid null references public.agent_memory_items(memory_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (actor_id, idempotency_key),
  check (
    (scope = 'user' and conversation_id is null and task_id is null)
    or (scope = 'conversation' and conversation_id is not null and task_id is null)
    or (scope = 'task' and task_id is not null)
  )
);

create index if not exists agent_memory_active_lookup_idx
  on public.agent_memory_items (actor_id, agent_id, kind, updated_at desc)
  where status = 'active';

create index if not exists agent_memory_conversation_idx
  on public.agent_memory_items (conversation_id, updated_at desc)
  where conversation_id is not null;

create index if not exists agent_memory_task_idx
  on public.agent_memory_items (task_id, updated_at desc)
  where task_id is not null;

create table if not exists public.agent_memory_audit (
  audit_id bigint generated always as identity primary key,
  memory_id uuid not null references public.agent_memory_items(memory_id) on delete cascade,
  actor_id uuid not null,
  event_type text not null check (
    event_type in ('proposed', 'activated', 'rejected', 'deleted', 'superseded', 'expired')
  ),
  from_status text null,
  to_status text not null,
  state_version integer not null check (state_version > 0),
  confirmation text null check (
    confirmation is null or confirmation in ('user_explicit', 'runtime_policy')
  ),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_memory_audit_memory_idx
  on public.agent_memory_audit (memory_id, audit_id);

alter table public.agent_definitions enable row level security;
alter table public.agent_definition_versions enable row level security;
alter table public.agent_skills enable row level security;
alter table public.agent_skill_versions enable row level security;
alter table public.agent_skill_bindings enable row level security;
alter table public.agent_memory_items enable row level security;
alter table public.agent_memory_audit enable row level security;

revoke all on public.agent_definitions from anon, authenticated;
revoke all on public.agent_definition_versions from anon, authenticated;
revoke all on public.agent_skills from anon, authenticated;
revoke all on public.agent_skill_versions from anon, authenticated;
revoke all on public.agent_skill_bindings from anon, authenticated;
revoke all on public.agent_memory_items from anon, authenticated;
revoke all on public.agent_memory_audit from anon, authenticated;

create or replace function public.agent_memory_item_json_v1(
  p_row public.agent_memory_items
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 'agent.memory_item.v1',
    'memoryId', p_row.memory_id,
    'actorId', p_row.actor_id,
    'agentId', p_row.agent_id,
    'conversationId', p_row.conversation_id,
    'taskId', p_row.task_id,
    'scope', p_row.scope,
    'kind', p_row.kind,
    'content', p_row.content,
    'structuredValue', p_row.structured_value,
    'sensitivity', p_row.sensitivity,
    'source', jsonb_build_object(
      'type', p_row.source_type,
      'id', p_row.source_id,
      'refs', p_row.source_refs
    ),
    'confidence', p_row.confidence,
    'status', p_row.status,
    'checksum', p_row.checksum,
    'stateVersion', p_row.state_version,
    'idempotencyKey', p_row.idempotency_key,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'activatedAt', p_row.activated_at,
    'expiresAt', p_row.expires_at,
    'supersededBy', p_row.superseded_by
  ));
$$;

create or replace function public.agent_publish_definition_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  definition_row public.agent_definitions%rowtype;
  version_row public.agent_definition_versions%rowtype;
begin
  if coalesce(p_record->>'status', '') <> 'published' then
    raise exception 'AGENT_DEFINITION_STATUS_INVALID';
  end if;

  select d.* into definition_row
  from public.agent_definitions d
  where d.slug = p_record->>'slug'
  for update;

  if definition_row.agent_id is null then
    insert into public.agent_definitions (
      agent_id, slug, name, description, status, created_at, updated_at
    ) values (
      (p_record->>'agentId')::uuid,
      p_record->>'slug',
      p_record->>'name',
      nullif(p_record->>'description', ''),
      'published',
      (p_record->>'createdAt')::timestamptz,
      (p_record->>'createdAt')::timestamptz
    ) returning * into definition_row;
  end if;

  select v.* into version_row
  from public.agent_definition_versions v
  where v.agent_id = definition_row.agent_id
    and v.version = (p_record->>'version')::integer;

  if version_row.agent_version_id is not null then
    if version_row.checksum <> p_record->>'checksum' then
      raise exception 'AGENT_DEFINITION_VERSION_CONFLICT';
    end if;
  else
    insert into public.agent_definition_versions (
      agent_version_id, agent_id, version, system_instructions,
      capability_manifest, model_policy, memory_policy, checksum,
      status, created_at, published_at
    ) values (
      (p_record->>'agentVersionId')::uuid,
      definition_row.agent_id,
      (p_record->>'version')::integer,
      p_record->>'systemInstructions',
      p_record->'capabilityManifest',
      p_record->'modelPolicy',
      p_record->'memoryPolicy',
      p_record->>'checksum',
      'published',
      (p_record->>'createdAt')::timestamptz,
      (p_record->>'publishedAt')::timestamptz
    ) returning * into version_row;
  end if;

  update public.agent_definitions d
  set name = p_record->>'name',
      description = nullif(p_record->>'description', ''),
      status = 'published',
      current_version_id = version_row.agent_version_id,
      updated_at = now()
  where d.agent_id = definition_row.agent_id
    and (
      d.current_version_id is null
      or version_row.version >= (
        select current_v.version
        from public.agent_definition_versions current_v
        where current_v.agent_version_id = d.current_version_id
      )
    );

  return jsonb_build_object(
    'schemaVersion', 'agent.definition.v1',
    'agentId', definition_row.agent_id,
    'agentVersionId', version_row.agent_version_id,
    'slug', p_record->>'slug',
    'version', version_row.version,
    'name', p_record->>'name',
    'description', nullif(p_record->>'description', ''),
    'status', version_row.status,
    'systemInstructions', version_row.system_instructions,
    'capabilityManifest', version_row.capability_manifest,
    'modelPolicy', version_row.model_policy,
    'memoryPolicy', version_row.memory_policy,
    'checksum', version_row.checksum,
    'createdAt', version_row.created_at,
    'publishedAt', version_row.published_at
  );
end;
$$;

create or replace function public.agent_publish_skill_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  skill_row public.agent_skills%rowtype;
  version_row public.agent_skill_versions%rowtype;
begin
  if coalesce(p_record->>'status', '') <> 'published' then
    raise exception 'AGENT_SKILL_STATUS_INVALID';
  end if;
  if p_record->>'risk' = 'financial_irreversible'
    and (
      p_record->>'sideEffect' <> 'funds'
      or p_record->>'approvalPolicy' = 'none'
    )
  then
    raise exception 'AGENT_SKILL_FINANCIAL_POLICY_INVALID';
  end if;

  select s.* into skill_row
  from public.agent_skills s
  where s.slug = p_record->>'slug'
  for update;

  if skill_row.skill_id is null then
    insert into public.agent_skills (
      skill_id, slug, name, description, status, created_at, updated_at
    ) values (
      (p_record->>'skillId')::uuid,
      p_record->>'slug',
      p_record->>'name',
      nullif(p_record->>'description', ''),
      'published',
      (p_record->>'createdAt')::timestamptz,
      (p_record->>'createdAt')::timestamptz
    ) returning * into skill_row;
  end if;

  select v.* into version_row
  from public.agent_skill_versions v
  where v.skill_id = skill_row.skill_id
    and v.version = (p_record->>'version')::integer;

  if version_row.skill_version_id is not null then
    if version_row.checksum <> p_record->>'checksum' then
      raise exception 'AGENT_SKILL_VERSION_CONFLICT';
    end if;
  else
    insert into public.agent_skill_versions (
      skill_version_id, skill_id, version, instructions, input_schema,
      output_schema, risk, side_effect, approval_policy, required_permissions,
      required_tools, resource_refs, checksum, status, created_at, published_at
    ) values (
      (p_record->>'skillVersionId')::uuid,
      skill_row.skill_id,
      (p_record->>'version')::integer,
      p_record->>'instructions',
      p_record->'inputSchema',
      p_record->'outputSchema',
      p_record->>'risk',
      p_record->>'sideEffect',
      p_record->>'approvalPolicy',
      p_record->'requiredPermissions',
      p_record->'requiredTools',
      coalesce(p_record->'resourceRefs', '[]'::jsonb),
      p_record->>'checksum',
      'published',
      (p_record->>'createdAt')::timestamptz,
      (p_record->>'publishedAt')::timestamptz
    ) returning * into version_row;
  end if;

  update public.agent_skills s
  set name = p_record->>'name',
      description = nullif(p_record->>'description', ''),
      status = 'published',
      current_version_id = version_row.skill_version_id,
      updated_at = now()
  where s.skill_id = skill_row.skill_id
    and (
      s.current_version_id is null
      or version_row.version >= (
        select current_v.version
        from public.agent_skill_versions current_v
        where current_v.skill_version_id = s.current_version_id
      )
    );

  return jsonb_build_object(
    'schemaVersion', 'agent.skill.v1',
    'skillId', skill_row.skill_id,
    'skillVersionId', version_row.skill_version_id,
    'slug', p_record->>'slug',
    'version', version_row.version,
    'name', p_record->>'name',
    'description', nullif(p_record->>'description', ''),
    'status', version_row.status,
    'instructions', version_row.instructions,
    'inputSchema', version_row.input_schema,
    'outputSchema', version_row.output_schema,
    'risk', version_row.risk,
    'sideEffect', version_row.side_effect,
    'approvalPolicy', version_row.approval_policy,
    'requiredPermissions', version_row.required_permissions,
    'requiredTools', version_row.required_tools,
    'resourceRefs', version_row.resource_refs,
    'checksum', version_row.checksum,
    'createdAt', version_row.created_at,
    'publishedAt', version_row.published_at
  );
end;
$$;

create or replace function public.agent_bind_skill_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  binding_row public.agent_skill_bindings%rowtype;
begin
  insert into public.agent_skill_bindings (
    agent_version_id, skill_version_id, enabled, priority, config, created_at
  ) values (
    (p_record->>'agentVersionId')::uuid,
    (p_record->>'skillVersionId')::uuid,
    coalesce((p_record->>'enabled')::boolean, true),
    coalesce((p_record->>'priority')::integer, 100),
    coalesce(p_record->'config', '{}'::jsonb),
    coalesce((p_record->>'createdAt')::timestamptz, now())
  )
  on conflict (agent_version_id, skill_version_id) do update
  set enabled = excluded.enabled,
      priority = excluded.priority,
      config = excluded.config
  returning * into binding_row;

  return jsonb_build_object(
    'agentVersionId', binding_row.agent_version_id,
    'skillVersionId', binding_row.skill_version_id,
    'enabled', binding_row.enabled,
    'priority', binding_row.priority,
    'config', binding_row.config,
    'createdAt', binding_row.created_at
  );
end;
$$;

create or replace function public.agent_get_manifest_v1(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'agent',
    jsonb_build_object(
      'schemaVersion', 'agent.definition.v1',
      'agentId', d.agent_id,
      'agentVersionId', v.agent_version_id,
      'slug', d.slug,
      'version', v.version,
      'name', d.name,
      'description', d.description,
      'status', v.status,
      'systemInstructions', v.system_instructions,
      'capabilityManifest', v.capability_manifest,
      'modelPolicy', v.model_policy,
      'memoryPolicy', v.memory_policy,
      'checksum', v.checksum,
      'createdAt', v.created_at,
      'publishedAt', v.published_at
    ),
    'skills',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'binding', jsonb_build_object(
            'agentVersionId', b.agent_version_id,
            'skillVersionId', b.skill_version_id,
            'enabled', b.enabled,
            'priority', b.priority,
            'config', b.config,
            'createdAt', b.created_at
          ),
          'skill', jsonb_build_object(
            'schemaVersion', 'agent.skill.v1',
            'skillId', s.skill_id,
            'skillVersionId', sv.skill_version_id,
            'slug', s.slug,
            'version', sv.version,
            'name', s.name,
            'description', s.description,
            'status', sv.status,
            'instructions', sv.instructions,
            'inputSchema', sv.input_schema,
            'outputSchema', sv.output_schema,
            'risk', sv.risk,
            'sideEffect', sv.side_effect,
            'approvalPolicy', sv.approval_policy,
            'requiredPermissions', sv.required_permissions,
            'requiredTools', sv.required_tools,
            'resourceRefs', sv.resource_refs,
            'checksum', sv.checksum,
            'createdAt', sv.created_at,
            'publishedAt', sv.published_at
          )
        )
        order by b.priority, s.slug
      )
      from public.agent_skill_bindings b
      join public.agent_skill_versions sv
        on sv.skill_version_id = b.skill_version_id
      join public.agent_skills s on s.skill_id = sv.skill_id
      where b.agent_version_id = v.agent_version_id
        and b.enabled
        and sv.status = 'published'
    ), '[]'::jsonb)
  )
  from public.agent_definitions d
  join public.agent_definition_versions v
    on v.agent_version_id = d.current_version_id
  where d.slug = p_slug
    and d.status = 'published'
    and v.status = 'published';
$$;

create or replace function public.agent_propose_memory_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  memory_row public.agent_memory_items%rowtype;
  was_replay boolean := false;
begin
  if coalesce(p_record->>'status', '') <> 'proposed' then
    raise exception 'AGENT_MEMORY_STATUS_INVALID';
  end if;
  if (p_record->>'content') ~* '-----BEGIN [A-Z ]*PRIVATE KEY-----' then
    raise exception 'AGENT_MEMORY_SECRET_REJECTED';
  end if;
  if p_record->>'scope' = 'conversation' and not exists (
    select 1 from public.agent_conversations c
    where c.conversation_id = (p_record->>'conversationId')::uuid
      and c.user_id = (p_record->>'actorId')::uuid
  ) then
    raise exception 'AGENT_MEMORY_ACTOR_SCOPE_MISMATCH';
  end if;
  if p_record->>'scope' = 'task' and not exists (
    select 1 from public.agent_tasks t
    where t.task_id = (p_record->>'taskId')::uuid
      and t.actor_id = (p_record->>'actorId')::uuid
  ) then
    raise exception 'AGENT_MEMORY_ACTOR_SCOPE_MISMATCH';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      (p_record->>'actorId') || ':' || (p_record->>'idempotencyKey'),
      0
    )
  );

  select m.* into memory_row
  from public.agent_memory_items m
  where m.actor_id = (p_record->>'actorId')::uuid
    and m.idempotency_key = p_record->>'idempotencyKey';

  if memory_row.memory_id is not null then
    was_replay := true;
    if memory_row.checksum <> p_record->>'checksum' then
      raise exception 'AGENT_MEMORY_IDEMPOTENCY_CONFLICT';
    end if;
  else
    insert into public.agent_memory_items (
      memory_id, actor_id, agent_id, conversation_id, task_id, scope, kind,
      content, structured_value, sensitivity, source_type, source_id,
      source_refs, confidence, status, checksum, state_version,
      idempotency_key, expires_at, created_at, updated_at
    ) values (
      (p_record->>'memoryId')::uuid,
      (p_record->>'actorId')::uuid,
      nullif(p_record->>'agentId', '')::uuid,
      nullif(p_record->>'conversationId', '')::uuid,
      nullif(p_record->>'taskId', '')::uuid,
      p_record->>'scope',
      p_record->>'kind',
      p_record->>'content',
      p_record->'structuredValue',
      p_record->>'sensitivity',
      p_record#>>'{source,type}',
      p_record#>>'{source,id}',
      coalesce(p_record#>'{source,refs}', '[]'::jsonb),
      (p_record->>'confidence')::numeric,
      'proposed',
      p_record->>'checksum',
      1,
      p_record->>'idempotencyKey',
      nullif(p_record->>'expiresAt', '')::timestamptz,
      (p_record->>'createdAt')::timestamptz,
      (p_record->>'updatedAt')::timestamptz
    ) returning * into memory_row;

    insert into public.agent_memory_audit (
      memory_id, actor_id, event_type, from_status, to_status, state_version, payload
    ) values (
      memory_row.memory_id, memory_row.actor_id, 'proposed', null, 'proposed',
      memory_row.state_version,
      jsonb_build_object(
        'sourceType', memory_row.source_type,
        'sourceId', memory_row.source_id,
        'checksum', memory_row.checksum
      )
    );
  end if;

  return jsonb_build_object(
    'item', public.agent_memory_item_json_v1(memory_row),
    'idempotentReplay', was_replay
  );
end;
$$;

create or replace function public.agent_get_memory_v1(
  p_memory_id uuid,
  p_actor_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.agent_memory_item_json_v1(m)
  from public.agent_memory_items m
  where m.memory_id = p_memory_id
    and m.actor_id = p_actor_id;
$$;

create or replace function public.agent_decide_memory_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  memory_row public.agent_memory_items%rowtype;
  next_status text := p_record->>'decision';
  confirmation_value text := p_record->>'confirmation';
begin
  if next_status not in ('active', 'rejected') then
    raise exception 'AGENT_MEMORY_DECISION_INVALID';
  end if;

  select m.* into memory_row
  from public.agent_memory_items m
  where m.memory_id = (p_record->>'memoryId')::uuid
    and m.actor_id = (p_record->>'actorId')::uuid
  for update;

  if memory_row.memory_id is null
    or memory_row.status <> 'proposed'
    or memory_row.state_version <> (p_record->>'expectedStateVersion')::integer
  then
    return null;
  end if;

  if next_status = 'active'
    and memory_row.kind in ('user_preference', 'user_fact')
    and confirmation_value <> 'user_explicit'
  then
    raise exception 'AGENT_MEMORY_USER_CONFIRMATION_REQUIRED';
  end if;

  update public.agent_memory_items
  set status = next_status,
      state_version = state_version + 1,
      activated_at = case when next_status = 'active' then now() else activated_at end,
      updated_at = now()
  where memory_id = memory_row.memory_id
  returning * into memory_row;

  insert into public.agent_memory_audit (
    memory_id, actor_id, event_type, from_status, to_status,
    state_version, confirmation
  ) values (
    memory_row.memory_id,
    memory_row.actor_id,
    case when next_status = 'active' then 'activated' else 'rejected' end,
    'proposed',
    next_status,
    memory_row.state_version,
    confirmation_value
  );

  return public.agent_memory_item_json_v1(memory_row);
end;
$$;

create or replace function public.agent_forget_memory_v1(p_record jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  memory_row public.agent_memory_items%rowtype;
  old_status text;
begin
  select m.* into memory_row
  from public.agent_memory_items m
  where m.memory_id = (p_record->>'memoryId')::uuid
    and m.actor_id = (p_record->>'actorId')::uuid
  for update;

  if memory_row.memory_id is null
    or memory_row.status not in ('proposed', 'active', 'rejected')
    or memory_row.state_version <> (p_record->>'expectedStateVersion')::integer
  then
    return null;
  end if;
  old_status := memory_row.status;

  update public.agent_memory_items
  set status = 'deleted',
      state_version = state_version + 1,
      content = '[deleted]',
      structured_value = null,
      updated_at = now()
  where memory_id = memory_row.memory_id
  returning * into memory_row;

  insert into public.agent_memory_audit (
    memory_id, actor_id, event_type, from_status, to_status, state_version
  ) values (
    memory_row.memory_id, memory_row.actor_id, 'deleted', old_status,
    'deleted', memory_row.state_version
  );

  return public.agent_memory_item_json_v1(memory_row);
end;
$$;

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

revoke all on function public.agent_publish_definition_v1(jsonb) from public, anon, authenticated;
revoke all on function public.agent_publish_skill_v1(jsonb) from public, anon, authenticated;
revoke all on function public.agent_bind_skill_v1(jsonb) from public, anon, authenticated;
revoke all on function public.agent_get_manifest_v1(text) from public, anon, authenticated;
revoke all on function public.agent_memory_item_json_v1(public.agent_memory_items) from public, anon, authenticated;
revoke all on function public.agent_propose_memory_v1(jsonb) from public, anon, authenticated;
revoke all on function public.agent_get_memory_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.agent_decide_memory_v1(jsonb) from public, anon, authenticated;
revoke all on function public.agent_forget_memory_v1(jsonb) from public, anon, authenticated;
revoke all on function public.agent_list_active_memories_v1(jsonb) from public, anon, authenticated;

grant execute on function public.agent_publish_definition_v1(jsonb) to service_role;
grant execute on function public.agent_publish_skill_v1(jsonb) to service_role;
grant execute on function public.agent_bind_skill_v1(jsonb) to service_role;
grant execute on function public.agent_get_manifest_v1(text) to service_role;
grant execute on function public.agent_memory_item_json_v1(public.agent_memory_items) to service_role;
grant execute on function public.agent_propose_memory_v1(jsonb) to service_role;
grant execute on function public.agent_get_memory_v1(uuid, uuid) to service_role;
grant execute on function public.agent_decide_memory_v1(jsonb) to service_role;
grant execute on function public.agent_forget_memory_v1(jsonb) to service_role;
grant execute on function public.agent_list_active_memories_v1(jsonb) to service_role;

comment on table public.agent_definitions is
  'Stable NarraOps Agent identities; behavior lives in immutable version rows.';
comment on table public.agent_skill_versions is
  'Declarative Skill versions. Executable code remains in the runtime Tool Registry.';
comment on table public.agent_memory_items is
  'Actor-bound durable Agent memory with provenance, confirmation, and lifecycle state.';
comment on table public.agent_memory_audit is
  'Append-only lifecycle audit for durable Agent memory.';
