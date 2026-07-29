# Initial Dev wallet sample methodology

The V1 sample is a deterministic selection from the supplied rolling 30-day
creator dataset. It does not claim to measure lifetime Dev quality.

## Eligibility

- unique Solana `creator_wallet`
- at least 30 launches in the source 30-day window
- valid `0 <= rugged_tokens <= total_tokens`

## Scores

`wilson_lower_pct` is the 95% Wilson lower confidence bound for the **non-rug
success proportion**:

```text
successes = total_tokens - rugged_tokens
trials = total_tokens
```

This definition prevents small samples with a nominal 0% rug rate from ranking
above repeatedly observed wallets without statistical support.

Activity is the duplicate-aware midrank percentile of `total_tokens` within
the eligible set. The combined score is:

```text
sample_score =
  wilson_lower_pct * 0.70
  + activity_percentile * 0.30
```

No fixed activity maximum is used.

## Selection and tiers

The highest 3,000 deterministic scores are selected:

- ranks 1-300: `A-Core`
- ranks 301-1,500: `B-Primary`
- ranks 1,501-3,000: `C-Watch`

Ties resolve by Wilson quality, launch count, and wallet address. Every initial
row receives `sample_status=active`. Runtime lifecycle status is maintained in
the database and must not rewrite these source scores or initial tiers.

## Reproduction

```powershell
python scripts/build-initial-dev-wallet-sample.py `
  --input C:\path\to\raw.csv `
  --output data/dev-wallets/initial-dev-wallet-sample.csv
```
