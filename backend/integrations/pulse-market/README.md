# Pulse market worker

This package owns the first Pulse KPI: `Meme Market Activity Index`.

The index is published only when all five components are present and each has
at least 30 daily baseline observations:

- long-term Dev activity: 25%
- recent Dev activity: 20%
- daily Meme launches: 10%
- Meme graduations: 30%
- Solana DEX volume: 15%

GMGN Trenches is capped at 80 rows per request. The worker queries every
supported Solana Meme launchpad separately for `new_creation` and `completed`
events, persists a deduplicated event stream, and records failed or saturated
queries. A daily launch/graduation total is published only after 24 hours of
continuous collection with no failed or saturated calls.

Solana-wide DEX volume comes from DefiLlama's chain-level DEX overview rather
than summing bounded token pages. This is total Solana spot DEX volume, not a
Meme-only volume estimate.

Dev thresholds are configuration, not product constants:

- recent: first launch within 10 days; inactive after 10 days without a launch
- long-term: first launch at least 60 days ago and an average of at least 20
  launches/day during the configured 15-day activity window

Cold-start rules:

- launch and graduation totals warm up for 24 hours
- recent Dev classification warms up for 10 days
- long-term Dev classification needs 60 days of observed history unless a
  separate historical backfill provider is added

The worker is one-shot and must run from a cloud scheduler. Recommended
interval: every minute. A slower interval can exceed GMGN's 80-row cap on
high-volume launchpads and will be marked incomplete instead of published as a
full-market total.

## Deployable worker

The included container runs the collector continuously and keeps each cycle on
a one-minute cadence:

```bash
docker build -t narraops-pulse-market backend/integrations/pulse-market
docker run --env-file .env narraops-pulse-market
```

## GitHub Actions free-tier collector

The repository workflow `.github/workflows/pulse-market-collector.yml` starts
once per hour and keeps the collector running on a one-minute cadence for 55
minutes. This avoids widening the GMGN query window beyond the 80-row cap while
still using an hourly scheduled job.

Configure these GitHub Actions repository secrets before enabling the schedule:

- `GMGN_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

The workflow can also be started manually with `workflow_dispatch`. Its
concurrency lock prevents two collection jobs from writing at the same time.
The daily observation remains an upsert keyed by `observed_on`, so hourly runs
refresh the current day's snapshot instead of producing duplicate daily rows.

Required server-only variables:

- `GMGN_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Apply database migrations `011` and `012` before starting the worker. Never
place the Supabase secret key in browser code or a public deployment variable.

Run the deterministic tests:

```powershell
python -m unittest test_market_index.py -v
```
