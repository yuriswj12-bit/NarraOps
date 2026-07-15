# Backend handoff

- Mount the contract at `/api/v1`; do not rename execution fields without updating OpenAPI and JSON Schemas first.
- Enforce equality between the `Idempotency-Key` header and body `idempotencyKey`.
- Replace the in-memory idempotency store with a durable unique constraint and transaction/lock before enabling submission.
- Persist state transitions and immutable audit events. A submitted transaction requires txHash, chain, fromAddress, and submittedAt.
- Confirmation must come from chain reconciliation with finality rules; API submission response is not confirmation.
- Keep secret material in an isolated signer. Backend passes intent and policy context, never raw keys.

## Go product contract proposal (backend implementation ready, shared update required)

Integration role should update `shared/openapi.yaml` and matching JSON Schemas for:

- `GET /api/v1/agent/commands`: categories `narrative`, `meme`, `wallet`, `launch`, `trade`, `funds` and slash-command metadata.
- `POST /api/v1/agent/tasks`: accept natural-language `input`, slash `command`, optional `parameters`, or legacy explicit `type`. Go response fields are `task_id`, `type`, `status`, `progress`, `requires_confirmation`, `execution_mode`, `created_at`, and `updated_at`.
- `GET /api/v1/agent/tasks/{taskId}`: same Go task envelope plus `result` or `failure`.
- `GET /api/v1/pulse`: mock opportunities with `heat`, `sources`, `recommended_chain`, and `risk_level`.
- `GET /api/v1/launch/platforms`: mock platform inventory with execution disabled.
- `GET /api/v1/invite/summary`: mock invite and revenue-share metrics; decimal revenue values are strings.
- `GET /api/v1/settings`: mock preferences plus explicit custody/signing/broadcast safety state.
- `GET /api/v1/execution/capabilities`: six simulation types and unified execution status vocabulary.

Simulation types: `wallet_group_create_simulation`, `transfer_simulation`, `withdraw_simulation`, `launch_simulation`, `batch_buy_simulation`, `batch_sell_simulation`.

Execution statuses: `planned`, `validating`, `simulated`, `requires_user_confirmation`, `signing_disabled`, `broadcasting_disabled`, `failed_simulation`, `cancelled`.

SSE additions: `agent_task_created`, `command_parsed`, `narrative_detected`, `meme_draft_ready`, `wallet_group_plan_ready`, `launch_plan_ready`, `transfer_simulated`, `trade_simulated`, `execution_disabled`, `revenue_share_updated`.

Safety invariant: Agent task `succeeded` only means a mock/simulation plan was generated. All launch, trade, transfer, and withdrawal results remain `execution_mode: disabled`, `signing_status: signing_disabled`, `broadcasting_status: broadcasting_disabled`, `executable: false`, and `submitted: false`.

## 2026-07-12 Go final-contract sync (uncommitted)

Frontend reference: `feat/frontend` commit `906fdb0` (`feat: refresh Go agent workspace`), clean at inspection time.

Implemented for integration into shared OpenAPI/schemas:

- `POST /api/v1/agent/conversations`
- `GET /api/v1/agent/conversations/{conversationId}`
- `POST /api/v1/agent/conversations/{conversationId}/messages`
- `GET /api/v1/events?taskId={taskId}` with task filtering, bounded per-task replay, and event-ID deduplication so late EventSource connections still receive completed cards
- Go SSE: `agent.started`, `agent.delta` (reserved), `agent.card`, `agent.completed`, `agent.failed`
- Go cards: `dev_market`, `launch_draft`, `narrative_trends`, `meme_analysis`, `recent_summary`, plus existing `narrative_snapshot` and `meme_package`
- Quick actions: `/dev-market`, `/launch`, `/narrative-trends`, `/analyze-meme`, `/recent-summary`
- `POST /api/v1/market/dev-wallets/scan` and `GET /api/v1/market/dev-wallets`
- `POST /api/v1/launch/drafts` and `GET /api/v1/launch/drafts/{launchDraftId}`
- `GET /api/v1/wallets/capabilities`

Market contract:

- Source is GMGN only; DexScreener is not used.
- Pump.fun/Solana and FourMeme/BSC scans normalize token creator metadata into Dev-wallet records.
- A bounded GMGN `portfolio stats` enrichment requests 7d and 30d PnL for up to 20 discovered creators and preserves monetary values as decimal strings. Repeated scans retain prior snapshot values and exact decimal-string realized-PnL change.
- Responses expose `data_source_status` and return empty evidence on disabled, timeout, unavailable, or unsupported states; never substitute fabricated live data.
- Robinhood GMGN ingestion is currently `unsupported_chain`.

Launch preparation contract:

- `solana` -> `pump` / Pump.fun
- `bsc` -> `fourmeme` / FourMeme
- `robinhood` -> `pons` / Pons (chain ID 4663)
- A public `narrative_url` is normalized and checked against local/private targets. Draft metadata contains name, symbol, description, image, X, and website fields plus `missing_fields` for later AI enrichment.
- Every draft is review-only: `requires_user_confirmation: true`, `execution_mode: disabled`, `signing_status: signing_disabled`, `broadcasting_status: broadcasting_disabled`.

Wallet boundary:

- Supports external-wallet and Privy-embedded-wallet capability records.
- Persistence stores provider wallet ID and public address only. Raw private keys and seed phrases are rejected by the HTTP guard and are not columns in the database draft.
- `PRIVY_APP_ID` is currently a placeholder; provision/login endpoints are intentionally not exposed until authentication ownership and provider configuration are supplied.

Read-only Meme analysis:

- HertzFlow adapter is opt-in and disabled by default.
- The locally available modified all-meme workflow supports Solana. Generic BSC/Robinhood all-meme analysis returns `unsupported_chain` until a reviewed implementation exists.
- The modified HertzFlow source was found locally but not in a verified source repository; do not deploy from a user profile path. Move it into a reviewed integration package in a later integration task.

External blockers intentionally left open:

- Pons public factory address/ABI and supported metadata transaction flow for a reviewed direct-execution adapter.
- Privy application configuration and authentication policy.
- Production GMGN credentials/connectivity and confirmation that the deployed API plan permits the requested scan cadence.
- A production AI/model provider and content-fetch worker for narrative-link enrichment.
- Persistent PostgreSQL repository, authenticated actor scoping, queue, rate limits, and immutable audit.

Shared contract was not edited because this window has no ownership of `shared/`; integration role must port these fields to `shared/openapi.yaml` and `shared/schemas/`.

Verification: `npm test` passes 27/27 backend API and integration tests, including late SSE subscription replay after task completion.

## 2026-07-13 Account / wallet-group / transfer contract (uncommitted)

Implemented for the frontend Personal/Assets page; shared OpenAPI/schemas still require integration-role updates:

- `GET /api/v1/account/portfolio?period=1d|7d|30d|all`
  - Returns `{ mode, period, currency, totalBalance, turnover, realizedPnl, unrealizedPnl, pnlPercent, history, dataStatus, updatedAt }`.
  - `totalBalance`, `turnover`, both PnL fields, `pnlPercent`, and every history balance are decimal strings.
- `GET /api/v1/wallet-groups` -> `{ mode: "mock", groups }`.
- `POST /api/v1/wallet-groups` with `{ name, walletCount }` -> a new mock group.
- `POST /api/v1/wallet-groups/{groupId}/wallets` with `{ count }` -> `{ mode, group, wallets }`.
- `GET /api/v1/wallet-groups/{groupId}/wallets` -> `{ mode, group, wallets }`.
  - Current wallets are simulation-only public/provider references. Responses contain no raw key or seed material.
- `POST /api/v1/wallet-groups/{groupId}/wallets/batch-delete` is intentionally two-step:
  1. `{ walletIds }` -> `202` preview with `confirmationToken`, `deletableWalletIds`, `protectedWallets`, expiry, and recovery policy.
  2. `{ walletIds, confirm: true, confirmationToken, recoveryStrategy: "archive_zero_balance_wallets" }` -> deletes only still-zero simulated records.
  - Non-zero wallets remain protected. Sweep-before-delete is not implemented and cannot be requested through this endpoint.
- `POST /api/v1/wallet-groups/{groupId}/exports`
  - Requires `{ confirmExport: true }`, `X-Reauthenticated-At` within five minutes, and `X-MFA-Verified: true`.
  - All attempts create in-memory audit metadata. Even after gates pass, the endpoint returns `503 WALLET_EXPORT_DISABLED`; it never returns a key, plaintext download token, or ordinary JSON export.
- `POST /api/v1/transfers/preview`
  - Body: `{ source, destination, amountMode, fractionBps?, amount?, distribution, idempotencyKey }`.
  - Returns a short-lived `previewToken` and `confirmationToken`, disabled allocation plan, and decimal-string amounts.
  - Repeating the same idempotency key and request returns the same preview; changed input returns `409 IDEMPOTENCY_CONFLICT`.
- `POST /api/v1/transfers`
  - Body: `{ previewToken, confirmationToken, idempotencyKey }` plus matching `Idempotency-Key` header.
  - Returns `202` with `status: "planned"`, the allowed future vocabulary (`planned`, `signing`, `submitted`, `confirmed`, `failed`), and explicit disabled signing/broadcasting. It never signs, submits, mutates balances, or returns a tx hash.

Persistence draft:

- `database/migrations/005_account_wallet_groups_transfers.sql` adds portfolio snapshots, wallet groups/public wallet references, hashed confirmation/export-token slots, transfer previews, durable idempotency, transfer state events, and append-only audit metadata.
- No private-key or seed column exists. Export artifacts are designed as encrypted external references with hashed one-time download tokens only.

Production blockers:

- Authenticated actor scoping and authorization policy are not wired; local routes expose mock data only.
- Provider-backed wallet creation and isolated custody/signer service are not configured.
- Recent reauthentication and MFA headers are only contract gates until a real identity provider verifies them server-side.
- PostgreSQL repositories, transactional idempotency, immutable audit storage, encrypted one-time artifact delivery, balance reconciliation, signing, broadcasting, and chain confirmation remain unimplemented.
- Real-fund execution remains disabled.

Verification after this section: `npm test` passes 32/32 tests, including portfolio decimal strings, wallet creation/listing, protected two-step deletion, export gates/audit, transfer idempotency, and disabled planned submission.

