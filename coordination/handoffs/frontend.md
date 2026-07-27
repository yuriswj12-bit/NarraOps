# Frontend handoff

> Current rule (2026-07-22): the first-level product surfaces are Go, Pulse, and Assets. The Launch and Invite sections below are historical implementation records, not current navigation requirements.

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

## 2026-07-26 Pulse Market Activity card

- Rebuilt the first Pulse KPI as a full-width `Market Activity` chart card.
- The surface now contains only the title, methodology help, 0-100 score,
  `24H / 7D / 30D / 1Y` controls, and the selected real observation curve.
- Removed the decorative chart icon, duplicate market label, change/status copy,
  trend-count copy, last-updated copy, and textual loading placeholder.
- Fewer than two valid observations leave the chart region empty. No synthetic
  points or fallback curve are rendered.
- The chart uses fixed 0-100 Y-axis ticks and range-aware X-axis time labels.
- Narrow-screen QA found and fixed a horizontal overflow caused by the
  three-column signal grid; Pulse KPI cards now stack below 820 px.
- Verification: repository typecheck, frontend build, desktop and 390 px browser
  QA, range-tab interaction, one-point empty state, and console error check pass.

## 2026-07-27 Pulse Dev Wallet PnL UI

- Converted the Pulse overview into two equal cards and added the
  presentation-only `Dev Wallet PnL` surface beside `Market Activity`.
- PnL currently has no backend contract and deliberately renders `$—` with an
  empty plot. No historical PnL, percentage return, negative value, or synthetic
  series is calculated.
- Product intent recorded in the tooltip: the future metric covers total profit
  for tracked Dev-wallet addresses associated with eligible same-day Meme
  launches. Backend eligibility and accounting rules remain pending.
- Prepared compact non-negative USD display formatting and green positive-value
  styling without connecting a data source.
- Removed Source Health and Candidate Pool from the first Pulse layer; refreshed
  hero copy and data-freshness treatment to match the approved reference.
- Verification: repository typecheck, frontend build, desktop and 390 px browser
  QA, independent PnL range-tab interaction, empty-data rendering, and overflow
  checks pass.

## 2026-07-27 Pulse chart interaction

- Market Activity now resolves the nearest real observation from any pointer
  position inside the plot and presents an OKX-style cursor, highlighted point,
  and floating tooltip.
- Tooltip timestamps use the browser's local timezone and show the observation
  score; no UTC label is exposed.
- X-axis generation is deterministic: local 3-hour boundaries for 24H, local
  days for 7D, 5-day intervals for 30D, and 12 calendar-month labels for 1Y.
- Removed the Pulse hero subtitle, freshness timestamp, and refresh action.
- Updated the English title from `Find the next breakout devs` to
  `Find the next breakout meme`; Chinese uses `寻找下一个爆发型 Meme`.
- Dev Wallet PnL remains a no-data UI shell. Its absolute-USD curve and tooltip
  must not render until the backend provides a real contract.
- Verification: typecheck, frontend build, diff check, real production Pulse
  data through the local proxy, four range controls, two pointer positions,
  desktop capture, and 390 px responsive QA pass.

