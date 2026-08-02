# Backend handoff

## 2026-08-02 Vercel Agent Runtime bundle fix

- Fixed the Vercel runtime failure caused by `api/v1/agent/runtime.ts`
  importing `backend/**/*.ts` directly. Vercel was emitting the API wrapper
  but not compiling those backend TypeScript files into the function, causing
  `Cannot find module '../../../backend/agents/agent-runtime.ts'`.
- Added `scripts/build-agent-runtime.mjs` to bundle the Agent entrypoint into
  the local `api/v1/agent/runtime.cjs` artifact during `build:vercel` and before
  API tests. The Vercel catch-all now imports that local CJS bundle.
- The generated bundle is ignored; the build command recreates it in every
  checkout and deployment build.

Verification: API/Agent/Vercel handler tests `71/71`, TypeScript typecheck,
frontend/backend checks, full `npm run build`, `node --check` on the generated
bundle, and Vercel CLI local build all pass.

Remaining blocker: deploy the fix through the existing `narra-ops` Vercel
project; no push or production deployment was performed in this worktree.

## 2026-08-02 Go Agent core continuation

- Completed the channel-agnostic Go Agent runtime for web/API and future
  Telegram entry points.
- Added durable Supabase repositories and migration `021_go_agent_core.sql`
  for conversations, messages, tasks, and review-only launch drafts. The
  runtime falls back to in-memory repositories when server Supabase
  credentials are absent.
- Added optional OpenAI-compatible structured launch-content generation with a
  deterministic template fallback. No signing, broadcasting, or real-fund
  execution is enabled.
- Restored Go conversations from local storage, connected Launch Draft cards to
  safe PATCH updates, and wired edit/review actions in the frontend.
- Fixed all async repository awaits in TaskManager and the local API, including
  SSE completion/replay and conversation assistant-message persistence.
- Launch Draft PATCH accepts only editable token fields or `mark_reviewed` and
  rejects secret-shaped fields.

Verification: backend API `71/71`, Agent runtime `5/5`, TypeScript typecheck,
frontend build, backend bundle, Node syntax checks, and `git diff --check` all
pass.

Files intentionally not part of this handoff: untracked `app-20260729-pulse-
market-history.js` and `app-20260729-pulse-market-history-v2.js`.

Remaining blockers: apply migration `021` in hosted Supabase, configure server-
only Supabase credentials if durable persistence is needed, and optionally
configure an OpenAI-compatible provider. Telegram rollout still requires bot
credentials and webhook deployment.

## 2026-07-30 Pulse production narrative schedule

- Replaced the unreliable production dependency on GitHub scheduled workflows
  with a Supabase Edge Function invoked by `pg_cron` every five minutes.
- The collector uses six credential-free Google News RSS searches, fetches them
  concurrently, accepts only sources published within the previous hour, and
  gives every card at most thirty minutes of display life.
- Source-category hints keep the six V1 columns stable while deterministic
  keyword routing can still refine mixed breaking/viral results.
- Migration `020_pulse_narrative_edge_schedule.sql` adds a global five-minute
  idempotency lease and the database schedule. Collector URL and authentication
  secret live only in Supabase Vault / Edge secrets, never in Git.
- The previous GitHub workflow remains available for manual fallback but no
  longer has a production schedule.
- Hosted rollout completed: the Edge function is deployed, migration `020` is
  applied, and Vault secrets are configured. The first manual production run
  inserted 38 real candidates. The first post-fix automatic run started at
  13:30 UTC, completed in about 6.4 seconds, and inserted 13 real candidates.
  Google News and Know Your Meme were unavailable from the scheduled Edge
  egress, while BBC, NPR, The Verge, TechCrunch, Cointelegraph, and Decrypt
  continued independently; the run correctly reported `partial`.

## 2026-07-30 Pulse narrative discovery Phase 3

- Migration `019_pulse_narrative_user_state.sql` adds private per-user
  `seen/dismissed/used` state storage and durable source snapshots.
- Anonymous `GET /api/v1/pulse/narratives` remains publicly cacheable. For a
  valid Web3 session it becomes private/no-store and excludes that user's
  dismissed and used narrative IDs.
- Added authenticated `POST /api/v1/pulse/narratives/state` with
  `{ narrative_id, state: "dismissed" | "used" }`.
- `dismissed` writes only private state. `used` invokes an atomic database
  function that copies the current original-source card into a private snapshot
  before marking it used.
- The snapshot survives expiry and deletion from the 30-minute public pool. It
  contains source material only and no AI-generated explanation or score.
- Frontend integration should replace local-only dismiss/use state with this
  endpoint and pass returned `snapshot.snapshot_id` into the next Go contract.
- Hosted rollout requires migration `019`; unauthenticated state writes fail
  with `AUTHENTICATION_REQUIRED`.

## 2026-07-30 Pulse narrative discovery Phase 2

- Migration `018_pulse_narrative_pool.sql` adds a private, short-lived
  `pulse_narrative_candidates` pool and auditable collection-run records.
- The scheduled credential-free collector runs every five minutes, upserts
  exact real-source cards, deterministically routes the six V1 categories, and
  deletes expired rows. It never inserts placeholders or generated history.
- Added `GET /api/v1/pulse/narratives`. The response groups unexpired cards by
  category and exposes only original source fields needed by the UI.
- Source eligibility remains one hour; each collected card is visible for at
  most thirty minutes. The API advertises UI refresh choices `3/5/15` minutes
  with `5` as the default, without triggering an external provider request per
  browser refresh.
- Hosted rollout still requires applying migration `018` and confirming the
  repository has `SUPABASE_URL` and `SUPABASE_SECRET_KEY` Actions secrets.
- Per-user `seen/dismissed/used` state, `Use` snapshots, semantic same-story
  clustering, and the four-column frontend are intentionally later phases.

## 2026-07-30 Pulse credential-free source adapters

- Removed TikTok from the Pulse narrative-discovery V1 source contract.
- Added a read-only OpenNews adapter for the anonymous `free_hot` endpoint.
  It uses only original text, URL, source, and publication time; provider
  scores and trading signals are deliberately ignored.
- Added RSS/Atom normalization with real publication-time enforcement and
  attached-media extraction.
- Both adapters reject sources outside the previous hour, deduplicate exact
  items, and never create placeholder content when a source is unavailable.
- OpenTwitter and the official X API remain optional enhancements. The V1
  credential-free feed does not consume the 3,000-message OpenTwitter quota.
- Added an auditable one-shot collector that writes normalized source items and
  per-source health status. Supabase persistence, scheduling, and the public
  read API are now implemented in Phase 2; frontend four-column rendering
  remains an integration task.

## 2026-07-30 Pulse narrative discovery Phase 1

- Defined the new second-layer contract as a real-time source-card
  feed. Cards preserve original text, URL, media, platform, author, and
  published time; they do not contain AI explanations, scores, risk, or token
  analysis.
- Added deterministic one-hour source eligibility and thirty-minute maximum
  display lifetime:
  `min(published_at + 60m, first_displayed_at + 30m)`.
- Added exact source deduplication, six category identifiers, four user-state
  identifiers, and validated monitored-source registry loading.
- Added an official-source probe. X Recent Search is technically suitable but
  needs `X_BEARER_TOKEN` and budget. The newer credential-free adapters above
  are the V1 baseline.
- This phase deliberately does not change the public API, Supabase schema, or
  frontend. Integration still needs a shared JSON Schema/OpenAPI update after
  the Phase 1 contract is reviewed.

## 2026-07-29 Pulse direct-chain index foundation

- Replaced the five-factor Dune scoring contract with three direct-chain inputs:
  `launched_tokens_24h` (15%), `graduated_tokens_24h` (55%), and
  `active_wallets_24h` (30%).
- Percentiles use only earlier real hourly observations, mid-rank duplicate
  handling, a rolling 720-hour cap, no neutral 50 default, and no synthetic
  history.
- Warm-up states are `insufficient`, `warming_up`, `partial`, and `ready`.
  Unrounded and displayed index values, per-component baseline counts, and
  history coverage are exposed separately.
- Added deterministic signature sampling and a fixed-size dynamic wallet panel.
  Inactive wallets can be replaced gradually, with a daily replacement cap and
  deterministic non-top-activity candidate selection.
- Migration `014_pulse_sol_chain_index.sql` adds the raw metrics, component
  scores, audit fields, sample metadata, and method version.
- The scheduled Dune workflow is retired. A direct Solana collector still needs
  to be connected to `SOLANA_RPC_URL`; no chain observations are fabricated
  while that endpoint is absent.

Verification: TypeScript passed, backend API 59/59, Pulse Python 10/10.

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

- Pons image/IPFS pinning provider and an official source-verified factory ABI. The current browser adapter is pinned to the factory and calldata shape verified from successful public transactions.
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

## 2026-07-20 Pulse public-evidence processor

- Added `backend/integrations/pulse-evidence/evidence_processor.py` for read-only enrichment of the historical Pulse JSONL dataset.
- Preserves `provided_sources`; writes separate `evidence_details` with fetch status, source adapter, title, relevant excerpt, content hash, evidence signals, and shared-source metadata.
- Static public webpages are fetched with SSRF protection, redirect revalidation, response-size/content-type limits, and explicit failure states.
- X, Instagram, and TikTok are not falsely treated as fetched: they return `dynamic_render_required` pending an official API or authenticated-browser adapter.
- Added pinned dependencies and five unit tests covering unsafe URL rejection, dynamic-source honesty, shared-source detection, JSONL round-trip, and relevant-excerpt selection.
- Live five-token smoke run produced 5/5 successful static webpage fetches and 5/5 honest `dynamic_render_required` X results. The generated result is locally available under the ignored `artifacts/test-five-output.jsonl`.
- The canonical 200-row research input loads successfully as UTF-8 with all 200 rows. Avoid Windows PowerShell's default `Get-Content` decoding for transformations because it can display UTF-8 annotations as mojibake; the Python loader is the canonical path.

Verification: isolated Python 3.14 environment; `python -m unittest test_evidence_processor.py -v` passes 5/5.

Full historical run:

- Added bounded concurrency (`--workers`, capped at 16); the 200-token / 373-source run completed in about 90 seconds with 8 workers.
- Result counts: 101 static successes, 224 dynamic-social deferrals, 8 unsafe/invalid URLs, 4 blocked, 27 upstream errors, 4 timeouts, 2 oversized responses, 1 rate limit, 1 not found, and 1 other unavailable response.
- Output and cohort summary are under the locally ignored `backend/integrations/pulse-evidence/artifacts/` directory.
- Current evidence suggests high-ATH cohorts more often have readable sources naming the token, but this is likely partly post-launch survivorship. Current website availability, later endorsements, and later licensing must not leak into the pre-launch scoring feature set.
- Added `PRELAUNCH_FEATURE_SCHEMA.md` and `build_prelaunch_sample.py`. The sampler deterministically selects 10 records from each L0-L4 cohort while balancing four evidence-coverage tiers.
- Generated a 50-row blind review packet plus a separate outcome-label file. The blind packet contains no `outcome_label`; alignment and uniqueness checks pass, preventing ATH labels from influencing feature extraction before evaluation.
- Completed the 50-row blind baseline, then joined the hidden labels only for evaluation. The baseline's L4-vs-rest pairwise AUC is 0.83; it does not reliably distinguish L0-L3, so Pulse must not expose one aggregate score as a success probability.
- Added `review_prelaunch_sample.py`, `evaluate_prelaunch_sample.py`, and `PULSE_V0_RULES.md`. The operational model is now evidence eligibility -> narrative gate -> amplification gate -> Reject/Watch/Review/High priority.

## 2026-07-20 Pulse discovery MVP

- Added `pulse_discovery.py`, `pulse-sources.example.json`, `PULSE_DISCOVERY_README.md`, and `test_pulse_discovery.py` under `backend/integrations/pulse-evidence/`.
- The worker fetches bounded RSS/Atom sources with URL validation, redirect revalidation, timeouts, and response-size limits; normalizes candidate fields; performs exact dedupe; and clusters events conservatively using title similarity and low-frequency named entities.
- Event clustering keeps a fixed representative instead of unioning cluster vocabularies, preventing unrelated chain-merges. Short hook matching uses word boundaries, so `cat` no longer matches `catalog`.
- Pulse cards preserve evidence URLs/publishers, story/amplification gate results, risk/missing-evidence fields, and one of `reject`, `watch`, `review`, or `high_priority`. No profitability score is exposed.
- A real three-source RSS run collected 90 bounded candidates, produced 73 auditable clusters, rejected 33, and emitted 40 active cards. The Jimothy event consolidated four independent media sources.
- Generated live artifacts are ignored under `artifacts/discovery-live/`; `pulse-active.jsonl` is the current product-consumption fixture. Public API exposure still requires an integration-owned shared contract update.

Verification: 10/10 Python unit tests pass across evidence and discovery modules; real RSS source health was 3/3 successful.

## 2026-07-21 Supabase MVP authentication and analytics

- Added `database/migrations/008_supabase_mvp_auth_analytics.sql` with user profiles, per-user counters, append-only analytics events, RLS policies, an Auth signup trigger, and a transactional analytics RPC.
- Hosted Supabase requires an SMS provider for native Phone Auth. The MVP therefore keeps Phone disabled and uses Email/Password internally behind a phone-number-and-password UI.
- Phone numbers are normalized and converted to deterministic internal login aliases. The normalized phone is stored in Auth metadata and copied into `public.profiles` by the signup trigger.
- Email confirmation is disabled for this alias flow. Phone ownership is not verified, and password recovery remains unavailable until a verified recovery method is added.
- Added `backend/api/SUPABASE_MVP_SETUP.md` and placeholder-only Supabase variables in `.env.example`. The secret/service-role key remains server-only and is not required for basic client Auth or RLS-protected reads.

Remaining integration work:

- Run migration `008` in the hosted Supabase SQL Editor and verify RLS with two test accounts.
- Add the frontend Supabase client, E.164 normalization, deterministic login-alias helper, and phone/password forms in the frontend worktree.
- Add backend JWT verification and authenticated actor scoping before exposing account or execution routes in production.

## 2026-07-24 Assets ownership boundary

- Assets portfolio and wallet-group routes now require a valid Web3 session whenever authentication is configured.
- New wallet groups persist the authenticated `userId` as owner metadata.
- List and detail reads filter by owner; cross-user direct access returns 404.
- Add-wallet, batch-delete, and export operations verify ownership before mutation.
- Verification: TypeScript passed; backend API 51/51, including anonymous rejection and two-user isolation.
- Remaining: apply the same actor scope to transfer previews/submissions and replace file persistence with Supabase repositories before production Assets deployment.

## 2026-07-24 Supabase Assets Vercel API

- Migration `010_assets_user_persistence.sql` adds user-owned wallet groups, planned public wallet records, and transfer-plan persistence. Wallet-group networks match the product contract: `solana` or `evm`.
- Vercel now exposes authenticated, Supabase-backed:
  - `GET/POST /api/v1/wallet-groups`
  - `GET/POST /api/v1/wallet-groups/{groupId}/wallets`
  - `GET /api/v1/account/portfolio`
  - `GET /api/v1/account/login-wallet-assets`
- Every query derives `user_id` from the signed Web3 session. Anonymous access returns `401`; cross-user group access returns `404`.
- Creation persists planned wallet placeholders only. No key generation, signer reference, balance fabrication, signing, or broadcasting occurs.
- Until a signer/provisioning service is reviewed, wallet rows remain `planned`, balances remain explicitly unavailable, and execution remains disabled.
- Production requires applying migration `010` before the new endpoints become ready. Missing tables return `503 ASSETS_PERSISTENCE_NOT_READY`.
- Verification: TypeScript, frontend build, Vercel CLI build, and backend API tests pass (53/53), including Vercel user-isolation tests.

## 2026-07-24 Pulse Vercel API boundary

- `GET /api/v1/pulse` is now a public Vercel function and does not require Supabase credentials.
- The initial production response is intentionally empty with `data_status: "awaiting_evidence_snapshot"`.
- It exposes the v0 gate/state vocabulary and explicit limitations. Historical evaluation rows and old mock opportunities are not presented as live evidence.
- The endpoint uses a short CDN cache while the first reviewed evidence snapshot and refresh worker are still pending.

## 2026-07-26 Pulse market activity foundation

- Added migration `011_pulse_market_activity.sql` for Dev wallets, launch
  events, and daily market observations. Browser access remains closed by RLS;
  the cloud worker writes with the server role and the public API exposes a
  bounded read model.
- Added the dynamic Dev lifecycle:
  - `recent`: first launch within 10 days and not idle for 10 days.
  - `long_term`: first launch at least 60 days ago and the configurable
    15-day launch window averages at least 20 launches/day.
  - `inactive`: no launch for 10 days.
- Added deterministic percentile normalization against 30-90 daily
  observations and the agreed weights: long-term Dev 25%, recent Dev 20%,
  daily launches 10%, graduations 30%, DEX volume 15%.
- Added `GET /api/v1/pulse/market`. It returns decimal values as strings,
  24-hour change, component readiness, and a 30-point sparkline.
- Added a one-shot Python worker suitable for cloud cron. It calls
  `gmgn-cli market trenches`, stores bounded creator/launch/graduation evidence,
  refreshes Dev lifecycle state, and records an honest `partial_data`
  observation.
- GMGN Trenches is capped at 80 results per request. The worker does not treat
  that page as complete daily launch/graduation totals and does not fabricate
  Solana DEX volume. A complete-coverage provider remains required for those
  three components before the public index can become `ready`.
- Verification: Python 6/6, backend API 58/58, repository TypeScript typecheck,
  and `git diff --check` pass.

## 2026-07-24 First reviewed Pulse snapshot

- A live bounded RSS run completed with 3/3 healthy sources, 90 candidates, 70 clusters, and 39 automatically active candidates.
- The automatic queue contained clear false positives and stale/cross-topic clusters, so it was not published wholesale.
- One opportunity, the multi-outlet Jimothy raccoon event, passed manual publication review and is exposed as `review`, never `high_priority`.
- The card preserves two independent publisher evidence records and explicitly lists the missing original social post, remix evidence, and GMGN prior-tokenization check.
- No heat, profitability, or investment score is returned. Snapshots older than 24 hours automatically report `stale_reviewed_snapshot`.

GitHub sync:

- Pulse commit: `398d39c` (`Add Pulse discovery evidence pipeline`).
- Supabase commit: `caca088` (`Add Supabase MVP auth foundation`).
- Validation before publish: Pulse Python tests 10/10; backend API tests 40/40; credential-pattern scan clean.
- Published branch: `feat/backend-agent`; Draft PR targets `main`.

## 2026-07-26 Pump.fun market index revision

- The first Pulse card now uses five Pump.fun aggregates from Dune:
  Daily Tokens Created (`4861426`, 15%), Tokens Launched 24h (`3979030`,
  20%), Graduated Tokens 24h (`3979025`, 30%), Daily Active Wallets
  (`4903519`, 20%), and Daily Revenue (`3759856`, 15%).
- Migration `013` adds `pulse_pumpfun_market_observations`. It stores aggregate
  snapshots and component scores only, not the full token dataset.
- A three-hour GitHub Actions collector reads `DUNE_API_KEY` and writes through
  server-only Supabase credentials.
- The first complete observation uses neutral Beta component scores. Later
  observations use percentile ranks against up to 90 stored snapshots.
- `GET /api/v1/pulse/market` now returns `pulse.market.v2` from the new table.
  Migration `013` must run before the workflow or public API is enabled.

## 2026-07-26 Pulse market history read model

- `GET /api/v1/pulse/market` preserves all fetched aggregate observations in
  chronological `sparkline` order instead of truncating the response to 30.
- The Supabase read limit is 3,000 aggregate snapshots. Raw Token events remain
  excluded; this only supports honest `24H / 7D / 30D / 1Y` client filtering.
- No interpolation or synthetic history is added. A range with fewer than two
  observations remains an empty chart on the client.
- Verification: backend API 59/59.

## 2026-07-29 Direct Solana Pulse index

- The Dune collector is retired. The replacement reads Pump.fun transactions
  through the standard Solana RPC surface configured only by
  `SOLANA_RPC_URL`; credentials are never committed or logged.
- Pump.fun instructions are parsed from the official public IDL
  discriminators. Successful `create` and `migrate` events provide the rolling
  24-hour launch and graduation metrics. Buy/sell activity uses deterministic
  signature sampling and a dynamic wallet panel.
- The wallet panel targets 5,000 addresses, refreshes last-seen timestamps,
  retires wallets inactive for 14 days, admits accumulated candidate wallets,
  and caps daily replacement at 5%. Selection is deterministic pseudo-random,
  not a ranking of the most active wallets.
- The index uses only three raw rolling metrics:
  launches 15%, graduations 55%, and sampled active wallets 30%. Every
  component uses average-rank percentiles against earlier hourly observations;
  no fixed maxima, neutral 50, or synthetic history is used.
- Warm-up remains explicit: under 24 earlier hourly observations returns a null
  index; 24-167 is `warming_up`, 168-719 is `partial`, and 720+ is `ready`.
- Migration `014_pulse_sol_chain_index.sql` adds the direct-chain event store,
  wallet panel, collector cursor, and auditable index fields.
- The scheduled workflow runs every ten minutes and reads a bounded sample of
  the newest real Pump.fun transactions. It estimates 24-hour launch and
  graduation rates from the distinct events observed during that sample's real
  block-time span. This avoids claiming full-market enumeration while keeping
  request volume bounded.
- Every snapshot stores sample size, observed seconds, raw event counts,
  estimator method, cursor reachability, component scores, and history
  coverage. `coverage_status=sampled` makes the limited census explicit.
- Active-wallet input comes from the dynamic wallet panel. The panel admits
  newly observed participants, retires inactive addresses, and therefore does
  not freeze the index to a permanent wallet cohort. Removed rows written on
  the current UTC date are counted before each refresh, so the 5% replacement
  limit is shared across all ten-minute runs and resets only on the next day.
- Raw Pump.fun event rows and removed wallet records are retained for 30 days.
  Transient candidate wallets are not persisted. Hourly aggregate observations
  are retained independently, so raw-data cleanup never removes the history
  used by the `24H / 7D / 30D` Pulse curves.
- Production setup still requires applying migration `014` and configuring
  GitHub Action secrets: `SOLANA_RPC_URL`, `SUPABASE_URL`, and
  `SUPABASE_SECRET_KEY`.
- Verification: Python 13/13, backend API 59/59, TypeScript typecheck,
  frontend/backend builds, and `git diff --check` pass.

Deployment update:

- Hosted Supabase project `ysumvxrtstwhbvjbamas` applied migration `014` on
  2026-07-29 through the authenticated Supabase Management API.
- Verification confirmed all three direct-chain tables, all 12 required index
  fields, and RLS on every new table. PostgREST schema reload was requested.
- Supabase CLI `2.110.0` is pinned as a project dev dependency. The repository
  is initialized for `npx supabase`; local link state remains ignored.
- `SOLANA_RPC_URL` is configured in GitHub Actions and the live workflow has
  confirmed successful Alchemy response parsing. The response normalizer reads
  signatures from `transaction.signatures`, matching Alchemy's full transaction
  response shape.

