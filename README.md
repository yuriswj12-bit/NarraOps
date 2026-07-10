# NarraOps

NarraOps is an Agentic Meme Launch & Operations OS. It turns social signals into launch-ready meme assets, then coordinates launch planning, wallet operations, contribution settlement, and community operations.

## Current Prototype

This is a local MVP prototype with a small Node API. It does not call wallets, private keys, chains, GMGN, X, TikTok, Instagram, Telegram, or launch platforms yet.

Included modules:

- Dashboard
- Narrative Intelligence
- Signal-to-Launch
- Meme Builder
- Launch Console
- Wallet Ops
- Community Ops
- Records
- Contribution settlement drawer

Current local interactions:

- Add and persist monitored sources.
- Score and select narrative signals.
- Generate a meme launch pack.
- Arm a Signal-to-Launch watcher.
- Create and persist wallet groups.
- Adjust the contribution settlement rate.
- Generate community operations content.
- Review local activity records.
- Switch between English and Chinese from the top-right language button.

## Open Locally

Open `index.html` in this folder for a static preview.

For local API mode, run:

```powershell
cd .\narraops-product
npm start
```

Then open:

```text
http://127.0.0.1:5188
```

Local API mode currently provides:

- `GET /api/workspace`
- `POST /api/workspace`
- `POST /api/source/scan`
- `POST /api/narrative/generate`
- `POST /api/launch/package`
- `GET /api/health`

Local API mode persists workspace state to:

```text
data/workspace.json
```

This file is local-only and ignored by Git. Do not put private keys, seed phrases, wallet secrets, or production API keys in workspace data.

## Language Support

The prototype supports English and Chinese in the same interface. The language preference is stored locally and is also included in local API calls so generated scan results, narrative drafts, launch packages, community ops copy, and records can follow the selected language.

## Next Implementation Steps

1. Connect Narrative Intelligence to real social/media sources.
2. Add Agent backend for meme brief generation.
3. Add launch platform adapters for Solana and BSC.
4. Add wallet-group execution adapters.
5. Add contribution settlement signing and accounting.
6. Add hosted deployment with domain, HTTPS, backend API, and database.
