create table if not exists public.pulse_gmgn_rate_limit_state (
  scope text primary key,
  blocked_until timestamptz,
  last_request_at timestamptz,
  window_started_at timestamptz,
  request_count integer not null default 0 check (request_count >= 0),
  last_429_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into public.pulse_gmgn_rate_limit_state (scope)
values ('global')
on conflict (scope) do nothing;

alter table public.pulse_dev_pnl_collection_runs
  add column if not exists requests_attempted integer not null default 0
    check (requests_attempted >= 0),
  add column if not exists rate_limit_events integer not null default 0
    check (rate_limit_events >= 0);

create or replace function public.acquire_pulse_gmgn_request_slot(
  p_min_interval_seconds integer default 25,
  p_max_requests_per_minute integer default 2
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  state public.pulse_gmgn_rate_limit_state%rowtype;
  wait_seconds integer;
begin
  if p_min_interval_seconds < 1 or p_max_requests_per_minute < 1 then
    raise exception 'rate-limit inputs must be positive';
  end if;

  insert into public.pulse_gmgn_rate_limit_state (scope)
  values ('global')
  on conflict (scope) do nothing;

  select *
  into state
  from public.pulse_gmgn_rate_limit_state
  where scope = 'global'
  for update;

  if state.blocked_until is not null and state.blocked_until > now() then
    return ceil(extract(epoch from state.blocked_until - now()))::integer;
  end if;

  if state.window_started_at is null
     or state.window_started_at <= now() - interval '1 minute' then
    state.window_started_at := now();
    state.request_count := 0;
  end if;

  if state.request_count >= p_max_requests_per_minute then
    wait_seconds := ceil(
      extract(epoch from state.window_started_at + interval '1 minute' - now())
    )::integer;
    return greatest(wait_seconds, 1);
  end if;

  if state.last_request_at is not null
     and state.last_request_at + make_interval(secs => p_min_interval_seconds) > now() then
    wait_seconds := ceil(
      extract(epoch from state.last_request_at
        + make_interval(secs => p_min_interval_seconds) - now())
    )::integer;
    return greatest(wait_seconds, 1);
  end if;

  update public.pulse_gmgn_rate_limit_state
  set
    blocked_until = null,
    last_request_at = now(),
    window_started_at = state.window_started_at,
    request_count = state.request_count + 1,
    updated_at = now()
  where scope = 'global';

  return 0;
end;
$$;

create or replace function public.block_pulse_gmgn_requests(
  p_retry_after_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  new_blocked_until timestamptz;
begin
  new_blocked_until := now()
    + make_interval(secs => greatest(coalesce(p_retry_after_seconds, 0), 300));

  insert into public.pulse_gmgn_rate_limit_state (
    scope,
    blocked_until,
    last_429_at,
    updated_at
  )
  values ('global', new_blocked_until, now(), now())
  on conflict (scope) do update set
    blocked_until = greatest(
      coalesce(public.pulse_gmgn_rate_limit_state.blocked_until, '-infinity'::timestamptz),
      excluded.blocked_until
    ),
    last_429_at = now(),
    updated_at = now()
  returning blocked_until into new_blocked_until;

  return new_blocked_until;
end;
$$;

alter table public.pulse_gmgn_rate_limit_state enable row level security;
revoke all on public.pulse_gmgn_rate_limit_state from anon, authenticated;
revoke all on function public.acquire_pulse_gmgn_request_slot(integer, integer)
  from public, anon, authenticated;
revoke all on function public.block_pulse_gmgn_requests(integer)
  from public, anon, authenticated;
grant execute on function public.acquire_pulse_gmgn_request_slot(integer, integer)
  to service_role;
grant execute on function public.block_pulse_gmgn_requests(integer)
  to service_role;

comment on table public.pulse_gmgn_rate_limit_state is
  'One shared GMGN request clock and provider cooldown for all NarraOps workers using the same API key.';

