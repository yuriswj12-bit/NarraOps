# GMGN Dev Wallet PnL capability probe

Date: 2026-07-29

Scope: read-only Phase 1 validation. No trading, swaps, wallet signing, or
full-sample collection was performed.

## Invocation

The installed `gmgn-cli 1.4.9` was used:

```powershell
gmgn-cli portfolio stats `
  --chain sol `
  --wallet <creator_wallet> `
  --period <1d|7d|30d> `
  --raw
```

Authentication through the configured GMGN API key succeeded. Wallet addresses
are deliberately replaced by aliases in this report.

## Sample

Five deterministic rows from the generated initial sample:

- two `A-Core`
- two `B-Primary`
- one `C-Watch`

Each wallet was queried separately for `1d`, `7d`, and `30d`, producing 15
requests.

## Result

- successful requests: 15/15
- total request time: 32.972 seconds
- average request time: 2.198 seconds
- rate-limit responses: 0
- `1d`: accepted and returned data even though CLI help documents only `7d`
  and `30d`
- returned values use strings for monetary decimals
- the response contained 14 top-level fields

Observed stable fields:

```text
wallet_address
native_balance
realized_profit
realized_profit_pnl
buy
sell
bought_cost
bought_fee
sold_income
sold_fee
total_cost
last_timestamp
pnl_stat
common
```

The actual response did **not** contain `unrealized_profit`. The web product UI
must not be treated as the OpenAPI response contract.

## Anonymized realized-PnL observations

| Alias | Tier | 1D | 7D | 30D |
|---|---|---:|---:|---:|
| W01 | A-Core | $0.00 | $0.00 | $0.00 |
| W02 | A-Core | -$0.21 | -$0.78 | $130.84 |
| W03 | B-Primary | $12,281.90 | $19,738.11 | $194,391.08 |
| W04 | B-Primary | $0.00 | $0.00 | -$670.42 |
| W05 | C-Watch | -$53.80 | -$55.87 | -$170.69 |

Five-wallet aggregate:

| Period | Aggregate realized PnL |
|---|---:|
| 1D | $12,227.88 |
| 7D | $19,681.47 |
| 30D | $193,680.81 |

The small cross-tier aggregate was positive in every tested period, while
individual wallets could be negative. Production aggregation must preserve the
real signed values and must never clamp wallet PnL to zero.

## Batch behavior

The CLI command advertises multiple wallets and sends repeated
`wallet_address` query parameters. Two tested CLI forms both returned only the
first wallet:

```text
--wallet wallet_1 --wallet wallet_2
--wallet wallet_1 wallet_2
```

Therefore NarraOps must currently treat wallet stats as a single-wallet request
unless a later GMGN version or endpoint probe proves true batch responses.

## 3,000-wallet projection

Three periods require 9,000 requests per complete refresh. At the measured
2.198-second average:

- sequential execution: approximately 5.5 hours
- concurrency 3: approximately 1.8 hours before retry overhead

The documented route weight is 3 with a leaky-bucket rate of 20, so concurrency
3 remains below the theoretical sustained API limit. Provider quota and ban
behavior still need a 100-wallet soak test before production scheduling.

A three-hour product cadence is technically plausible with a continuously
staggered queue. It should not launch as a single burst.

## Go / No-Go

**Go**:

- direct 1D/7D/30D realized-PnL reads
- per-wallet normalized storage
- cross-tier aggregation
- 100-wallet soak test

**No-Go until the soak test passes**:

- all 3,000 wallets
- a production three-hour scheduler
- assumptions that GMGN multi-wallet batch works
- fields copied from the GMGN web UI but absent from the API

Recommended V1 metric:

> Sum of GMGN `realized_profit` for the active NarraOps Dev-wallet sample,
> grouped independently for 1D, 7D, and 30D, with source coverage stored on
> every snapshot.
