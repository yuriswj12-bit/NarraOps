create table if not exists public.pulse_narrative_user_states (
  user_id uuid not null references public.web3_users(user_id) on delete cascade,
  narrative_id text not null,
  category text not null check (category in (
    'politics_satire', 'events', 'animals_characters',
    'internet_culture', 'ai_tech', 'crypto_native'
  )),
  state text not null check (state in ('seen', 'dismissed', 'used')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, narrative_id)
);

create index if not exists pulse_narrative_user_states_user_idx
  on public.pulse_narrative_user_states (user_id, state, updated_at desc);

create table if not exists public.pulse_narrative_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.web3_users(user_id) on delete cascade,
  narrative_id text not null,
  category text not null,
  platform text not null,
  source_type text not null,
  author_name text not null,
  original_text text not null,
  source_url text not null,
  media_type text,
  media_urls jsonb not null default '[]'::jsonb,
  video_thumbnail_url text,
  source_published_at timestamptz not null,
  source_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, narrative_id)
);

create index if not exists pulse_narrative_snapshots_user_created_idx
  on public.pulse_narrative_snapshots (user_id, created_at desc);

alter table public.pulse_narrative_user_states enable row level security;
alter table public.pulse_narrative_snapshots enable row level security;
revoke all on public.pulse_narrative_user_states from anon, authenticated;
revoke all on public.pulse_narrative_snapshots from anon, authenticated;

create or replace function public.pulse_use_narrative(
  p_user_id uuid,
  p_narrative_id text
)
returns public.pulse_narrative_snapshots
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.pulse_narrative_candidates%rowtype;
  snapshot public.pulse_narrative_snapshots%rowtype;
begin
  select *
    into candidate
    from public.pulse_narrative_candidates
   where narrative_id = p_narrative_id
     and expires_at > now();

  if not found then
    raise exception 'Narrative is unavailable or expired'
      using errcode = 'P0002';
  end if;

  insert into public.pulse_narrative_snapshots (
    user_id, narrative_id, category, platform, source_type, author_name,
    original_text, source_url, media_type, media_urls, video_thumbnail_url,
    source_published_at, source_expires_at
  )
  values (
    p_user_id, candidate.narrative_id, candidate.category, candidate.platform,
    candidate.source_type, candidate.author_name, candidate.original_text,
    candidate.source_url, candidate.media_type, candidate.media_urls,
    candidate.video_thumbnail_url, candidate.published_at, candidate.expires_at
  )
  on conflict (user_id, narrative_id) do update
    set original_text = excluded.original_text,
        source_url = excluded.source_url,
        media_type = excluded.media_type,
        media_urls = excluded.media_urls,
        video_thumbnail_url = excluded.video_thumbnail_url
  returning * into snapshot;

  insert into public.pulse_narrative_user_states (
    user_id, narrative_id, category, state
  )
  values (p_user_id, candidate.narrative_id, candidate.category, 'used')
  on conflict (user_id, narrative_id) do update
    set state = 'used',
        category = excluded.category,
        updated_at = now();

  return snapshot;
end;
$$;

revoke all on function public.pulse_use_narrative(uuid, text) from public, anon, authenticated;
grant execute on function public.pulse_use_narrative(uuid, text) to service_role;

comment on table public.pulse_narrative_snapshots is
  'Private immutable-source snapshots created when an authenticated user chooses a Pulse narrative.';
