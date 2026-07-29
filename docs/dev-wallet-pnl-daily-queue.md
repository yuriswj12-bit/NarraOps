# Dev Wallet PnL daily queue

The production queue prioritizes truthful 24H coverage for the 3,000-wallet
active sample.

## Cadence

- source metric: GMGN wallet `1d` realized profit
- scheduled segment: once per hour
- maximum wallets per scheduled segment: 125
- minimum request-start interval: 25 seconds
- maximum request starts per minute: 3
- segment runtime budget: 3,150 seconds
- expected full-panel cycle: approximately 24 hours

Manual workflow runs default to three wallets.

## Shared GMGN safety

Migration `017_gmgn_global_rate_limit.sql` creates a database-backed request
clock shared by every NarraOps worker using the GMGN key.

Before a GMGN request, the collector atomically acquires a slot. A provider 429:

1. stops the entire current segment immediately;
2. stores a global cooldown of at least five minutes;
3. prevents another worker from sending requests before the cooldown expires;
4. never retries inside the blocked segment.

Every collection run stores request attempts and rate-limit event counts.

The legacy Pulse Market Collector no longer runs on an hourly schedule and
shares the same GitHub concurrency group for any manual invocation.

## Data interpretation

The resulting card is a rolling scan, not a simultaneous point-in-time read of
all 3,000 wallets. Each snapshot stores:

- included fresh wallet count;
- eligible wallet count;
- coverage percentage;
- signed total realized PnL;
- tier contributions;
- profitable, losing, and zero-PnL wallet counts.

The frontend must not label the metric complete until coverage is sufficient.
No missing wallet is treated as zero.

The 7D and 30D periods are intentionally excluded from the hourly queue. They
will use separate lower-frequency scheduling after the 24H cycle is stable.

## Validation

After enabling the global request clock:

- first run: 3/3 wallets, 3/3 observations, zero 429s;
- second run: 2/3 observations, with one local Windows decoding failure;
- UTF-8 decoding fix applied;
- third run: 3/3 wallets, 3/3 observations, zero 429s;
- fresh 24H aggregate advanced to 13 distinct wallets.

