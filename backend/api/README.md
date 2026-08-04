# NarraOps API v1

This is the live NarraOps API runtime. It routes narrative discovery, LLM work, GMGN market data, wallet operations, token launches, and trades through real providers. A provider that is not configured is reported as unavailable; it is never replaced with synthetic data.

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

Go task responses use snake-case fields including `task_id`, `requires_confirmation`, and `execution_mode`. A launch or trade remains a live operation at the execution boundary and requires an explicit user confirmation immediately before broadcasting.

Wallet groups and external signer references are persisted without accepting private keys. Launches and trades use the configured GMGN/custody providers; missing credentials or wallet bindings return a provider-configuration error instead of a fake result.

## Go workspace contract

Conversation messages accept `{ message, command?, context: { language, currentView, projectId? } }`. The response is `{ taskId, conversationId, status }`. Subscribe to `/api/v1/events?taskId=...` for `agent.started`, `agent.card`, `agent.completed`, and `agent.failed`; `agent.delta` is reserved for a future streaming model provider. Filtered streams replay a bounded per-task event history so a fast live-provider task still delivers its card and terminal event without duplicates.

Supported response-card types currently include `dev_market`, `launch_draft`, `narrative_trends`, `meme_analysis`, `recent_summary`, `narrative_snapshot`, and `meme_package`.

## Account, wallet-group, and transfer API

- `GET /api/v1/account/portfolio?period=1d|7d|30d|all` reads balances from the configured chain provider. Every monetary value is a decimal string; an unconfigured provider returns an explicit data gap.
- `GET /api/v1/wallet-groups` returns the user's persisted groups and live balance status.
- `POST /api/v1/wallet-groups` creates a group of public wallet references.
- `POST /api/v1/wallet-groups/:groupId/wallets` adds public wallet references.
- `GET /api/v1/wallet-groups/:groupId/wallets` lists public references and balances without any key material.
- `POST /api/v1/wallet-groups/:groupId/wallets/batch-delete` is two-step. The first call with `walletIds` returns a short-lived confirmation token and protects every non-zero balance. The second repeats `walletIds` with `confirm: true`, the token, and `recoveryStrategy: "archive_zero_balance_wallets"`.
- `POST /api/v1/wallet-groups/:groupId/exports` enforces explicit confirmation, recent reauthentication metadata, MFA metadata, and audit recording. Raw private keys are never returned.
- `POST /api/v1/transfers/preview` reads live balances and creates an idempotent confirmation preview.
- `POST /api/v1/transfers` requires matching body/header idempotency keys plus its preview and confirmation tokens, then signs and broadcasts through the configured custody provider.

The standalone API uses file repositories for local development; production uses authenticated actor scoping and durable Supabase repositories. Custody/provider configuration, one-time confirmations, audit, and reconciliation remain mandatory for real fund operations.

## Integration status

- GMGN is the meme-market and execution source. Configure `GMGN_LIVE_ENABLED=true`, `GMGN_EXECUTION_ENABLED=true`, `GMGN_API_KEY`, and the signer/provider credentials in the secret manager. Timeout, unsupported-chain, and unavailable states are surfaced as data/provider gaps rather than fabricated wallets.
- GMGN creator metadata is normalized into Dev-wallet/token records for Solana Pump.fun and BSC FourMeme. A bounded batch enrichment reads 7d/30d wallet stats and stores decimal-string snapshots for date-over-date comparison. Robinhood ingestion remains unsupported by the installed GMGN client.
- Live launch preparation supports Solana/Pump.fun through GMGN and the configured EIP-1193/browser-wallet paths for supported platforms. The final confirmation boundary is explicit and private keys never enter the API.
- Meme analysis uses the configured GMGN read-only token research provider; direct Solana Swaps are prepared for a connected Assets wallet and require a browser signature.
- External and Privy embedded wallets are represented by provider IDs and public addresses only. The API never accepts or persists raw key material.
