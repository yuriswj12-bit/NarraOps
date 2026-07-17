# Frontend handoff

## 2026-07-11 product workspace redesign

- Implementation commit: `94bc53b` (`feat: redesign NarraOps product workspace`).
- Replaced the sidebar dashboard with a top-navigation opportunity terminal inspired by the approved MSX layout reference.
- Added interactive `Go`, `Launch`, `Pulse`, `Invite`, and `Settings` views without changing the marketing landing page.
- `Go` accepts natural language and slash commands. Fund, wallet, launch, buy, sell, transfer, and withdrawal requests return simulation plans only.
- `Launch` creates local simulated drafts only; no signer, wallet, RPC, or execution API is called.
- Added Chinese/English switching, theme switching, notifications, mock authentication modal, responsive layouts, and canvas signal charts.
- Verification: `npm run check`, HTTP 200, Chrome desktop capture at 1416 x 869, mobile layout metrics at 375 x 844, interaction checks, and credential-shape scan passed.
- Local URL: `http://127.0.0.1:5188/app.html#pulse`.
- Remaining blocker: live `/api/v1` and SSE consumption remains pending; authentication and real execution are not implemented.

- Call `POST /api/v1/executions` with both the `Idempotency-Key` header and matching body `idempotencyKey`.
- Treat `planned`, `signing`, `submitted`, and `confirmed` as distinct states. Never display `submitted` as success.
- Render `partially_failed`, `failed`, and `timed_out` with retry/recovery actions supplied by the backend.
- Amounts and priority fees are decimal strings. Do not convert them to JavaScript floating-point numbers before submission.
- Never request, store, or transmit a private key or mnemonic.
- Contract source: `shared/openapi.yaml`; schemas: `shared/schemas/`.

## 2026-07-12 Go agent workspace refresh

- Rebuilt the Go view as a full-height Agent conversation workspace and aligned its accents with the current NarraOps green product theme.
- Removed the unused mention button, separate send button, and the obsolete disclaimer row. Enter submits; Shift+Enter inserts a line break.
- Replaced the five quick actions with On-chain Market, Launch Meme, Narrative Trends, Analyze Meme, and Recent Summary.
- Added frontend-only response cards for dev-wallet performance, launch planning, cross-chain narrative scoring, operator-cluster analysis, and recent account activity.
- All wallet, funding, launch, buy, sell, transfer, and withdrawal behavior remains mock/simulation-only.
- Verification: `npm run check`, `git diff --check`, desktop Chrome QA at 1280 x 720, command submission, response-card rendering, and horizontal-overflow checks passed.

### Suggested Agent API contract

- `POST /api/v1/agent/conversations` creates a conversation.
- `POST /api/v1/agent/conversations/{id}/messages` accepts `{ message, command?, context: { language, currentView, projectId? } }` and returns `{ taskId, conversationId, status: "queued" }`.
- `/api/v1/events?taskId=...` streams `agent.started`, `agent.delta`, `agent.card`, `agent.completed`, and `agent.failed` events.
- Allowlisted card types: `dev_market`, `launch_draft`, `narrative_trends`, `meme_analysis`, `recent_summary`, `narrative_snapshot`, `meme_package`, `execution_plan`, and `community_plan`.
- The model should not receive private keys, mnemonics, unrestricted database access, or direct signing capability. Backend policy and tool orchestration must mediate every sensitive action.
- For a low-cost Agent, start with an open model served through Ollama, vLLM, or llama.cpp, then add retrieval over approved NarraOps data and backend tools. This avoids retraining whenever product data changes; self-hosting still has infrastructure cost.

## 2026-07-12 Launch parameter workspace

- Launch exposes Pump.fun (Solana), Four.Meme (BSC), and Pons (Robinhood Chain). Pons supports EIP-1193 wallet connection, Robinhood Chain switching, live ETH balance reads, local ABI encoding, gas estimation, explicit confirmation, and direct wallet submission to the Pons factory without leaving NarraOps.
- Platform cards were shortened and remain mutually exclusive through frontend state.
- Selecting a platform reveals one consolidated parameter panel for token name, symbol, X, website, Cookie wallet buy amount, wallet group, and wallet-group buy amount.
- Removed the obsolete current-draft summary and simulated-draft action.
- Wallet-group options are placeholders until the backend returns the authenticated user's groups.
- The final launch control remains disabled; no wallet connection, signing, launchpad request, or chain execution is performed.
- Browser QA: all three cards render at 201 px, the selected form contains seven controls, no horizontal overflow was detected, and obsolete draft text is absent.

