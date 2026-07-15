# NarraOps API v1

This is a dependency-free Node.js 20 API skeleton. It supports explicit live/data-gap integration states, but cannot issue tokens, sign transactions, transfer funds, or execute trades.

## Run

```powershell
cd backend/api
npm start
```

The API listens on `http://127.0.0.1:5190` by default. Frontend code should always call relative `/api/v1/...` paths; the local reverse proxy or production gateway owns port routing.

## Test

```powershell
cd backend/api
npm test
npm run check
```

The normative contract is `../../shared/openapi.yaml`, supported by JSON Schemas under `../../shared/schemas/`.

## Go product API additions awaiting shared-contract integration

- `GET /api/v1/agent/commands`
- `POST /api/v1/agent/conversations`
- `GET /api/v1/agent/conversations/:conversationId`
- `POST /api/v1/agent/conversations/:conversationId/messages`
- `POST /api/v1/agent/tasks` with `input`, `command`, or the legacy explicit `type`
- `GET /api/v1/agent/tasks/:taskId`
- `GET /api/v1/pulse`
- `GET /api/v1/launch/platforms`
- `POST /api/v1/launch/drafts`
- `GET /api/v1/launch/drafts/:launchDraftId`
- `POST /api/v1/market/dev-wallets/scan`
- `GET /api/v1/market/dev-wallets?chain=solana|bsc|robinhood`
- `GET /api/v1/wallets/capabilities`
- `GET /api/v1/invite/summary`
- `GET /api/v1/settings`
- `GET /api/v1/execution/capabilities`
- `GET /api/v1/events`

Go task responses use snake-case fields including `task_id`, `requires_confirmation`, and `execution_mode`. Agent task lifecycle and execution simulation state are intentionally separate: a task may be `succeeded` because a plan was generated while its execution remains `disabled`.

The six supported simulations are wallet-group creation, transfer, withdrawal, launch, batch buy, and batch sell. None read or generate private keys, sign transactions, or broadcast transactions.

## Go workspace contract

Conversation messages accept `{ message, command?, context: { language, currentView, projectId? } }`. The response is `{ taskId, conversationId, status }`. Subscribe to `/api/v1/events?taskId=...` for `agent.started`, `agent.card`, `agent.completed`, and `agent.failed`; `agent.delta` is reserved for a future streaming model provider. Filtered streams replay a bounded per-task event history, so connecting after a fast mock task finishes still delivers its card and terminal event without duplicates.

Supported response-card types currently include `dev_market`, `launch_draft`, `narrative_trends`, `meme_analysis`, `recent_summary`, `narrative_snapshot`, and `meme_package`.

## Account, wallet-group, and transfer prototype

- `GET /api/v1/account/portfolio?period=1d|7d|30d|all` returns mock portfolio totals and history. Every monetary value is a decimal string.
- `GET /api/v1/wallet-groups` returns mock groups.
- `POST /api/v1/wallet-groups` creates a group of simulation-only public wallet references.
- `POST /api/v1/wallet-groups/:groupId/wallets` adds simulation-only public wallet references.
- `GET /api/v1/wallet-groups/:groupId/wallets` lists public references and balances without any key material.
- `POST /api/v1/wallet-groups/:groupId/wallets/batch-delete` is two-step. The first call with `walletIds` returns a short-lived confirmation token and protects every non-zero balance. The second repeats `walletIds` with `confirm: true`, the token, and `recoveryStrategy: "archive_zero_balance_wallets"`.
- `POST /api/v1/wallet-groups/:groupId/exports` enforces explicit confirmation, recent reauthentication metadata, MFA metadata, and audit recording, then returns `WALLET_EXPORT_DISABLED`. Ordinary JSON key export and plaintext download tokens are never returned.
- `POST /api/v1/transfers/preview` creates an idempotent disabled preview and allocation plan.
- `POST /api/v1/transfers` requires matching body/header idempotency keys plus its preview and confirmation tokens. It returns `planned` with signing and broadcasting disabled.

These routes are mock/in-memory and unauthenticated in the local prototype. Do not deploy them as production account APIs until authenticated actor scoping, durable storage, an isolated custody/signer service, hashed one-time tokens, immutable audit, and reconciliation are integrated.

## Integration status

- GMGN is the only configured meme-market source. Set `GMGN_LIVE_ENABLED=true` only after `gmgn-cli` is configured. Disabled, timeout, unsupported-chain, and unavailable states return empty evidence rather than fabricated wallets.
- GMGN creator metadata is normalized into Dev-wallet/token records for Solana Pump.fun and BSC FourMeme. A bounded batch enrichment reads 7d/30d wallet stats and stores decimal-string snapshots for date-over-date comparison. Robinhood ingestion remains unsupported by the installed GMGN client.
- Launch preparation supports Solana/Pump.fun, BSC/FourMeme, and Robinhood/Pons. Pons uses a non-custodial browser-wallet handoff; direct contract execution remains disabled until an official factory address and ABI can be reviewed.
- HertzFlow read-only analysis is wired behind `HERTZFLOW_LIVE_ENABLED`; the available all-meme pipeline currently supports Solana only.
- External and Privy embedded wallets are represented by provider IDs and public addresses only. The API never accepts or persists raw key material.
