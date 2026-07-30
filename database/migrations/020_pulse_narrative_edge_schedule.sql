create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

create table if not exists public.pulse_narrative_collection_leases (
  bucket_started_at timestamptz primary key,
  created_at timestamptz not null default now()
);

alter table public.pulse_narrative_collection_leases enable row level security;
revoke all on public.pulse_narrative_collection_leases from anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'pulse-narrative-collector-every-5-minutes';

select cron.schedule(
  'pulse-narrative-collector-every-5-minutes',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'pulse_narrative_collector_url'
        limit 1
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-narraops-collector-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'pulse_narrative_collector_secret'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    );
  $$
);

comment on table public.pulse_narrative_collection_leases is
  'Global five-minute idempotency lease for the credential-free Pulse narrative collector.';
