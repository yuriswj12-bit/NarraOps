-- Go Agent durable core: conversations, messages, tasks, launch drafts.
-- Service role only. Browser clients never write these tables directly.

create table if not exists public.agent_conversations (
  conversation_id uuid primary key,
  channel text not null check (channel in ('web', 'telegram', 'api')),
  user_id uuid null,
  channel_user_id text null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_conversations_user_updated_idx
  on public.agent_conversations (user_id, updated_at desc);

create index if not exists agent_conversations_channel_user_idx
  on public.agent_conversations (channel, channel_user_id, updated_at desc);

create table if not exists public.agent_messages (
  message_id uuid primary key,
  conversation_id uuid not null references public.agent_conversations(conversation_id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text null,
  command text null,
  channel text null,
  task_id uuid null,
  status text null,
  blocks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists agent_messages_conversation_created_idx
  on public.agent_messages (conversation_id, created_at asc);

create table if not exists public.agent_tasks (
  task_id uuid primary key,
  conversation_id uuid null references public.agent_conversations(conversation_id) on delete set null,
  channel text null,
  type text not null,
  status text not null,
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  requires_confirmation boolean not null default false,
  execution_mode text not null default 'mock',
  input jsonb not null default '{}'::jsonb,
  result jsonb null,
  failure jsonb null,
  request_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists agent_tasks_conversation_updated_idx
  on public.agent_tasks (conversation_id, updated_at desc);

create table if not exists public.go_launch_drafts (
  launch_draft_id uuid primary key,
  conversation_id uuid null references public.agent_conversations(conversation_id) on delete set null,
  user_id uuid null,
  status text not null default 'draft',
  confirmation_status text not null default 'not_confirmed',
  execution_mode text not null default 'disabled',
  signing_status text not null default 'signing_disabled',
  broadcasting_status text not null default 'broadcasting_disabled',
  preparation_status text not null default 'requires_enrichment',
  chain text null,
  platform jsonb not null default '{}'::jsonb,
  token jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  source_prompt text null,
  missing_fields jsonb not null default '[]'::jsonb,
  requires_user_confirmation boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists go_launch_drafts_conversation_updated_idx
  on public.go_launch_drafts (conversation_id, updated_at desc);

create index if not exists go_launch_drafts_user_updated_idx
  on public.go_launch_drafts (user_id, updated_at desc);

alter table public.agent_conversations enable row level security;
alter table public.agent_messages enable row level security;
alter table public.agent_tasks enable row level security;
alter table public.go_launch_drafts enable row level security;

revoke all on public.agent_conversations from anon, authenticated;
revoke all on public.agent_messages from anon, authenticated;
revoke all on public.agent_tasks from anon, authenticated;
revoke all on public.go_launch_drafts from anon, authenticated;

comment on table public.agent_conversations is
  'Durable Go Agent conversations shared by web and future Telegram channel.';
comment on table public.agent_messages is
  'Durable Go Agent messages and structured card blocks.';
comment on table public.agent_tasks is
  'Durable Go Agent task lifecycle records.';
comment on table public.go_launch_drafts is
  'Review-only launch drafts created by Go Agent tools.';
