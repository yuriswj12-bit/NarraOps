# Dev Wallet PnL data layer

Migration `015_dev_wallet_pnl_data_layer.sql` implements the Phase 2 storage
contract approved after the GMGN capability probe.

## Truthful V1 scope

GMGN currently returns signed wallet-level `realized_profit` for `1d`, `7d`,
and `30d`. The verified API response does not provide token-level realized PnL
or current token balance. Consequently this migration does not claim that a
wallet-period value is profit from a closed creator-launched token.

The storage layers are:

- `pulse_dev_wallet_sample`: the retained and dynamically maintained wallet
  panel, including the original CSV scores and tiers.
- `pulse_dev_wallet_period_pnl`: normalized signed GMGN observations per wallet
  and timeframe.
- `pulse_dev_pnl_collection_runs`: resumable collection audit records.
- `pulse_dev_wallet_pnl_snapshots`: frontend-ready aggregates with coverage and
  tier contribution fields.

No table clamps negative values to zero. No synthetic PnL or history is
generated.

## Apply

Apply migration `015` to the hosted Supabase project, then validate the sample:

```powershell
python scripts/import-dev-wallet-sample.py
```

Expected validation:

```json
{
  "mode": "validate",
  "unique_wallets": 3000,
  "tier_counts": {
    "A-Core": 300,
    "B-Primary": 1200,
    "C-Watch": 1500
  },
  "status": "active"
}
```

After setting server-only `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, import:

```powershell
python scripts/import-dev-wallet-sample.py --apply
```

The import uses `creator_wallet` as the conflict key. Re-running it updates the
original metrics instead of inserting duplicate wallets. RLS is enabled and no
browser role receives direct table access.

