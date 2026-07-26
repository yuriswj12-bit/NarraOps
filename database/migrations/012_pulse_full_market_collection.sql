alter table public.pulse_launch_events
  drop constraint if exists pulse_launch_events_source_coverage_check;

alter table public.pulse_launch_events
  add constraint pulse_launch_events_source_coverage_check
  check (source_coverage in ('bounded_sample', 'continuous_poll', 'complete'));

create table if not exists public.pulse_market_collection_runs (
  id bigint generated always as identity primary key,
  observed_at timestamptz not null,
  poll_window_minutes integer not null check (poll_window_minutes > 0),
  platform_count integer not null check (platform_count > 0),
  expected_calls integer not null check (expected_calls > 0),
  succeeded_calls integer not null check (succeeded_calls >= 0),
  failed_call_count integer not null check (failed_call_count >= 0),
  saturated_call_count integer not null check (saturated_call_count >= 0),
  event_count integer not null check (event_count >= 0),
  details jsonb not null default '{}'::jsonb
);

create index if not exists pulse_market_collection_runs_observed_idx
  on public.pulse_market_collection_runs (observed_at desc);

alter table public.pulse_market_collection_runs enable row level security;

create or replace function public.pulse_market_event_totals(
  p_observed_at timestamptz default now()
)
returns table (
  daily_launch_count bigint,
  graduated_count bigint
)
language sql
security definer
set search_path = public
as $$
  select
    count(*) filter (
      where launched_at >= p_observed_at - interval '24 hours'
        and launched_at <= p_observed_at
    )::bigint,
    count(*) filter (
      where graduated_at >= p_observed_at - interval '24 hours'
        and graduated_at <= p_observed_at
    )::bigint
  from public.pulse_launch_events;
$$;

create or replace function public.pulse_market_collection_coverage(
  p_observed_at timestamptz default now(),
  p_required_hours integer default 24
)
returns table (
  is_complete boolean,
  run_count bigint,
  earliest_run_at timestamptz,
  latest_run_at timestamptz,
  failed_call_count bigint,
  saturated_call_count bigint
)
language sql
security definer
set search_path = public
as $$
  with windowed as (
    select *
    from public.pulse_market_collection_runs
    where observed_at >= p_observed_at - make_interval(hours => p_required_hours)
      and observed_at <= p_observed_at
  ),
  summary as (
    select
      count(*)::bigint as run_count,
      min(observed_at) as earliest_run_at,
      max(observed_at) as latest_run_at,
      coalesce(sum(failed_call_count), 0)::bigint as failed_call_count,
      coalesce(sum(saturated_call_count), 0)::bigint as saturated_call_count,
      max(poll_window_minutes) as max_poll_window_minutes
    from windowed
  )
  select
    (
      earliest_run_at <= p_observed_at - make_interval(hours => p_required_hours) + interval '20 minutes'
      and latest_run_at >= p_observed_at - interval '20 minutes'
      and failed_call_count = 0
      and saturated_call_count = 0
      and run_count >= floor(
        (p_required_hours * 60.0 / greatest(max_poll_window_minutes, 1)) * 0.90
      )
    ),
    run_count,
    earliest_run_at,
    latest_run_at,
    failed_call_count,
    saturated_call_count
  from summary;
$$;

revoke all on function public.pulse_market_event_totals(timestamptz)
  from public, anon, authenticated;
revoke all on function public.pulse_market_collection_coverage(timestamptz, integer)
  from public, anon, authenticated;
