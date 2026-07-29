# Dev Wallet PnL small-batch validation

Date: 2026-07-29

This is a read-only Phase 3 validation against ten active wallets selected
across the initial sample:

- A-Core: 4
- B-Primary: 3
- C-Watch: 3

The collector queried GMGN independently for `1d`, `7d`, and `30d`. It stored
signed wallet-level realized PnL observations and three aggregate snapshots.

## First run

- wallets attempted: 10
- wallets successful for all three periods: 7
- observations written: 23 of 30
- snapshots written: 3
- run status: `partial`

| Timeframe | Included wallets | Total realized PnL | Full-sample coverage |
|---|---:|---:|---:|
| 24H | 8 | $12,343.52 | 0.2667% |
| 7D | 8 | $20,986.26 | 0.2667% |
| 30D | 7 | $168,529.74 | 0.2333% |

The three tier contributions and profitable, losing, and zero-PnL wallet counts
were persisted with every snapshot. Negative wallet values were retained.

## Rate-limit finding

Seven calls failed with GMGN `HTTP 429 RATE_LIMIT_BANNED`. The response included
a provider reset countdown and warned that requests sent before the reset can
extend the temporary ban.

The collector now:

- recognizes both `429` and `RATE_LIMIT` responses;
- waits for the provider countdown plus a five-second safety buffer;
- uses a conservative 65-second fallback when no countdown is present;
- retries at most twice;
- defaults to two seconds between normal requests.

A second validation run was stopped after exceeding the external five-minute
execution window during rate-limit backoff. Its audit row was explicitly closed
as `failed`; it produced no observations or snapshots.

## Decision

The storage and aggregation model is validated, but the current GMGN account
cannot yet support a fast ten-wallet burst reliably. Do not schedule 3,000
wallets or connect the partial snapshot to the public PnL card.

Next validation should use resumable micro-batches and provider-aware global
rate-limit state. The first partial snapshot remains in Supabase as audit
evidence, not as a production metric.

## Resumable micro-batch follow-up

Migration `016_dev_wallet_pnl_microbatch.sql` adds per-wallet scheduling state:

- `pnl_last_collected_at`
- `pnl_collection_failures`
- `pnl_next_retry_at`

The queue selects the least recently collected active wallet from each tier.
New wallets have no collection timestamp and naturally enter the queue.
Incomplete wallets receive exponential retry delay without being removed.

Observations are now persisted after each wallet rather than at the end of a
batch. Snapshot aggregation runs in PostgreSQL and selects only the latest fresh
real observation per active wallet:

- 24H PnL observation freshness: 6 hours
- 7D PnL observation freshness: 24 hours
- 30D PnL observation freshness: 72 hours

This prevents an old wallet result from silently remaining in a current
aggregate.

The collector also implements a global circuit breaker. A provider cooldown
longer than the configured safe wait stops the whole batch after the current
request. It does not continue sending calls that could extend the ban.

Live circuit-breaker validation returned a provider retry hint of 307 seconds.
The run closed as `failed` in about 30 seconds, wrote no observations or
snapshots, and scheduled only the attempted wallet for retry. No later wallet
was requested.
