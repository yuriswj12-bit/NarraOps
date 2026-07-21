# Pulse Candidate Collector + Narrative Cluster

This worker is a small-scope discovery MVP. It does not crawl the whole internet and does not claim to predict token returns.

## Run

```powershell
.\.venv\Scripts\python.exe pulse_discovery.py pulse-sources.example.json artifacts\discovery-live --timeout 12 --limit-per-source 30
```

Outputs:

- `candidates.jsonl`: normalized source items after exact deduplication.
- `pulse-cards.jsonl`: all event clusters, including rejected clusters for audit.
- `pulse-active.jsonl`: only Watch, Review, and High Priority cards for product consumption.
- `run-status.json`: per-source health and run counts.

## Pipeline

1. Fetch a bounded set of configured RSS/Atom sources.
2. Normalize titles, text, authors, publishers, timestamps, URLs, and hashes.
3. Remove exact content/URL duplicates.
4. Cluster only on conservative title similarity or rare named entities; the first item remains the fixed representative to prevent chain-merging unrelated events.
5. Reject explicit token promotions.
6. Apply the narrative and amplification gates from `PULSE_V0_RULES.md`.
7. Emit evidence-first cards without profitability scores.

## Deliberate limits

- X/TikTok/Instagram require separate official or authenticated adapters and are not faked.
- RSS engagement counts are not available; the worker reports observed source counts instead.
- The v0 hook extractor is lexical and explainable. A production model may replace it later, but must preserve evidence fields and gate semantics.
- `relationship` remains `not_yet_token_linked` until a separate GMGN duplicate/tokenization check runs.
