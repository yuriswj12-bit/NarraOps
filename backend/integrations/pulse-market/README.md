# Pulse market worker

This package owns the first Pulse KPI: `Meme Market Activity Index`.

The index is published only when all five components are present and each has
at least 30 daily baseline observations:

- long-term Dev activity: 25%
- recent Dev activity: 20%
- daily Meme launches: 10%
- Meme graduations: 30%
- Solana DEX volume: 15%

GMGN Trenches is a bounded discovery feed (maximum 80 rows per request). It is
valid for discovering token/creator events and graduation evidence, but a
single response is not a complete daily market count. The worker must not
present a bounded page as the total number of launches, graduations, or total
Solana DEX volume.

Dev thresholds are configuration, not product constants:

- recent: first launch within 10 days; inactive after 10 days without a launch
- long-term: first launch at least 60 days ago and an average of at least 20
  launches/day during the configured 15-day activity window

Run the deterministic tests:

```powershell
python -m unittest test_market_index.py -v
```

