# Current task

## Goal

Continue the uncommitted NarraOps Agent Runtime v2/control-plane and Pump
safety integration from the current dirty `main` working tree. Do not restart
the design or replace the already-working Pump Launch product path.

## Completed

- OpenCode closed out the dirty tree: secret scan clean, 74 changes grouped
  into 5 scoped commits (Runtime v2 core, control plane, migrations 023-035,
  product-route wiring, docs) and pushed to `yuriswj12-bit/NarraOps` main.
  Working tree clean, typecheck green, no untracked leftovers.
- Added `docs/engineering/financial-gateway-rollout.md`: per-operation
  Shadow -> Canary -> Full -> Rollback rollout plan for
  `assets.transfer.broadcast`, `swap.solana.broadcast`,
  `launch.pump.broadcast` with independent flags, observation metrics,
  rollback triggers, and red lines. No production authority is switched.
- Pump broadcast wired through `launch.pump.broadcast@1.0.0` Tool gateway:
  `submitPumpBroadcastViaGateway` gated by
  `AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED` (default off) in
  `api/v1/agent/runtime.ts` and called from the Pump submit branch in
  `api/v1/[...path].ts`. Consumed-approval/exact-intent checks enforced by
  the Tool Registry; legacy response fields preserved. API/Runtime now
  134/134 with a dedicated gateway test.
- Deployed to production (`narra-4jse3cydv-hek.vercel.app`, aliased to
  `www.narraops.xyz`). Health and capabilities verified. Production env now
  has `AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED=false`; enforcement stays off, so
  the direct path remains authority and the gateway branch is unreachable.
- Built the Swap Runtime execution chain mirroring Pump:
  `recordSolanaSwapSemanticShadow`, `prepareSolanaSwapRuntimeExecution`, and
  `submitSolanaSwapViaGateway` in `api/v1/agent/runtime.ts`, wired into
  `submitDirectSwap` behind `AGENT_SWAP_SEMANTIC_SHADOW_ENABLED`,
  `AGENT_SWAP_ENFORCEMENT_ENABLED`, and `AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED`.
  Swap now records a real semantic shadow, envelope, approval dual-run,
  reserve, and `submission_pending` before the Tool gateway. API/Runtime now
  135/135. Deployed to `narra-7bxi9075b-hek.vercel.app`; production has
  `AGENT_SWAP_SEMANTIC_SHADOW_ENABLED=true` (shadow observing) and the
  enforcement/gateway flags off.
- Added live Solana transfer endpoints to the Vercel API:
  `POST /api/v1/transfers/preview` and `POST /api/v1/transfers`, with
  actor-owned wallet-group source, external/group destination, encrypted-vault
  Solana signing (`unsealAssetWalletSecret` + `broadcastSolanaTransfer`), and
  migration 045 (`asset_transfer_previews`/`asset_transfers`, service-role
  only). Migrations through `20260810075000` are applied remotely. API now
  136/136. Deployed to `narra-2jimje6hu-hek.vercel.app`; the transfer endpoints
  return 401 when unauthenticated (previously 404).




- OpenCode verified the Codex Agent control-plane handoff against the dirty
  tree: catalog/memory contracts, services, migrations 035-044 and Supabase
  mirrors, Memory API routes, and bootstrap script all present. Independent
  verification: typecheck green, Runtime/API 133/133, execution 35/35, 28 Agent
  schemas parsed, Vercel build passes, `git diff --check` clean,
  `AGENT_PUMP_ENFORCEMENT_ENABLED` off locally (no `.env`).

- Fixed repository typecheck with zero behavior change: restored
  `// @ts-nocheck` to line 1 of `backend/api/src/app.ts` and narrowed the
  `PromiseSettledResult` access in `agent-runtime-v2.test.ts`.
- Added the injected/no-broadcast signed Pump harness as a new test in
  `backend/api/tests/agent-runtime-v2.test.ts`. It builds a real Pump
  transaction, walks signature validation -> wallet-signature approval
  consume/reservation -> semantic-envelope binding -> `submission_pending` ->
  counting fake observation provider (confirmed path and chain-timeout path),
  and asserts zero real RPC broadcasts. API/Runtime now 115/115.

- Added provider-neutral Runtime contracts for context, tools, model gateway,
  durable tasks/events, approvals, execution reservations, semantic envelopes,
  audit, Pump transaction inspection, wallet-signature evidence, and read-only
  reconciliation.
- Added database/Supabase migrations 023-034 and rollback/privilege canaries.
  Production Supabase has migrations through 034.
- Resolved the local duplicate migration number by moving the Assets encrypted
  vault migration from local 021 to local 035; its already-applied production
  migration timestamp remains unchanged.
- Added the Agent control plane: versioned Agent definitions, declarative Skill
  definitions/bindings, actor-bound durable Memory, provenance, optimistic
  lifecycle transitions, user confirmation, audit, service-role-only RPCs,
  Supabase repositories, and an optional Runtime knowledge resolver.
- Applied production Supabase migrations
  `20260810043000` through `20260810054500`. Self-cleaning canaries exercised
  Agent/Skill publish and manifest read, Memory propose/confirm/retrieve/forget,
  public-role privilege denial, exact Runtime Skill enums, and global actor
  memory retrieval.
- Published reviewed `narraops-agent@1` plus four read-only Skills
  (`pulse-research`, `assets-wallet-context`, `market-research`, and
  `public-link-research`) through migration 042 / `20260810060000`. No
  financial or execution Skill was published.
- Added feature-flagged authenticated Memory APIs for proposal, explicit
  confirm/reject, active-list, and forget. Mutations require trusted same-origin
  requests; only global user preferences/facts are accepted in this MVP.
- Production Pump semantic shadow and approval dual-run are enabled and
  observed. The latest unsigned canary returned `requires_user_signature`,
  recorded shadow + requested approval, signed nothing, broadcast nothing, and
  cleaned all temporary records.
- Added `submission_pending`: it claims one exact signed transaction before an
  external call. `submitted` is written only after provider acceptance.
- Added provider-neutral model policy routing for both conversational replies
  and structured narrative/meme/launch content. The Agent version policy, not
  Go or a provider adapter, selects the registered provider.
- Enabled authenticated Memory APIs and read-only Runtime knowledge in
  production. A self-cleaning production canary passed proposal, replay, actor
  isolation, confirmation, retrieval, origin, forget/redaction, and Runtime
  knowledge checks.
- Added Go Memory management for proposing user preferences/facts, reviewing
  pending proposals, explicit confirm/reject, listing active Memory, and
  forget/redaction. Migration 043 / `20260810061500` adds an actor-scoped,
  service-role-only review RPC.
- Browser QA found and fixed an older comment-boundary bug that had excluded
  the real Go conversation restore/submit helpers from the production bundle.
  Go now renders, the Memory button is visible, and unauthenticated access opens
  wallet login before any Memory read.
- Routed the first real business read through the fixed Tool Registry:
  `narrative.recommend` executes `pulse.narratives.list@1.0.0` with an
  actor-bound Runtime context and `pulse:read`; the model receives only the
  validated result.
- Added and ran a self-cleaning Supabase concurrency canary for wallet-signed
  execution reservation. Two independent clients produced one reservation,
  one idempotent replay, one approval audit, rejected evidence drift, performed
  zero broadcasts, and left no canary rows.
- Fixed the Pump response compatibility boundary. Runtime execution metadata is
  additive to the legacy `go.launch_execution.v1` response, and Go no longer
  reports `reconciliation_required` as a successful launch or encourages a
  duplicate submission.
- Published immutable `narraops-agent@2` and `market-research@2`, which bind
  filtered GMGN trending reads to `market.gmgn.trending@2.0.0`. Tool v1 remains
  registered and unchanged for replay/compatibility. Migration 044 /
  `20260810070000` is applied in production.
- Routed narrative scanning and launch-source retrieval through the already
  published `research.public_link.read@1.0.0` Tool. The SSRF-protected adapter
  remains the implementation, but actor, permission, trace, timeout, and input
  schema enforcement now belong to the Runtime.
- Routed actor-owned wallet-group selection for buy/sell planning through
  `assets.wallet_groups.list@1.0.0`. This remains read-only context: public
  addresses are resolved only after ownership, and signing/execution authority
  is unchanged. The work also fixed explicit `wallet group <name>` parsing
  taking precedence over a nearby currency symbol.
- Defined the first financial Tool boundary,
  `launch.pump.broadcast@1.0.0`, with shared input/output schemas. It accepts
  only server-side execution/reservation identity, envelope digest, state
  version, and tx hash; never private keys or signed bytes. It requires
  `launch:execute`, consumed approval, recent auth, and has retry policy
  `none`. The local signed no-broadcast harness now invokes it through an
  injected zero-network execution gateway and proves one exact call after
  `submission_pending`; it remains unregistered in the production Agent and
  outside production authority.
- Added public `GET /api/v1/agent/capabilities`, backed by the current immutable
  Supabase Agent manifest. Its fixed schema exposes only the published Agent,
  safe capability names, Model Provider names, Memory availability, and
  published Skill/Tool dependencies. It never exposes system instructions,
  checksums, database IDs, binding configuration, Memory content, or execution
  credentials. Production currently reports Agent v2, four read-only Skills,
  and zero published financial Tools.
- Hardened Tool schema validation for UUID/date-time/URI formats and fixed
  latest Tool selection to compare semantic versions numerically.
- Added local-only `swap.solana.broadcast@1.0.0` and
  `assets.transfer.broadcast@1.0.0` financial Tool contracts with fixed shared
  schemas. Like Pump, they accept only reserved execution/approval identity,
  state version, semantic-envelope digest, and immutable transaction hash.
  They require consumed recent-auth approval, preserve provider-acceptance
  semantics, have no automatic retry, and never carry private keys or signed
  transaction bytes. Injected zero-network tests prove their gateways are not
  reached before approval. Neither Tool is published or connected to
  production authority.
- Latest production deployment is
  `https://narra-dmvju6d5j-hek.vercel.app`, aliased to
  `https://www.narraops.xyz`.
- Latest verification: Runtime/API 133/133, execution 35/35, typecheck green,
  28 Agent schemas, Vercel build, Supabase migration parity through
  `20260810070000`, 13-check production capabilities/Memory/knowledge/Pulse/
  GMGN/Assets Tool canary, Supabase reservation concurrency canary, browser QA,
  and `git diff --check` pass.

## In progress

All business changes remain unstaged, uncommitted, and unpushed on `main`.
`AGENT_PUMP_SEMANTIC_SHADOW_ENABLED=true` and
`AGENT_PUMP_APPROVAL_DUAL_RUN_ENABLED=true` are in production.
`AGENT_PUMP_ENFORCEMENT_ENABLED` is absent/off, so the existing direct Pump
prepare/sign/submit path remains production authority.
`AGENT_KNOWLEDGE_ENABLED=true` and `AGENT_MEMORY_API_ENABLED=true`; the Runtime
resolves the immutable Agent version plus confirmed bounded Memory before model
selection. No database handle, signer, or execution authority reaches a model.

## Modified files

Use `git status --short` as the exact source. Main groups are
`api/v1/[...path].ts`, `api/v1/agent/runtime.ts`, `backend/agents/`,
`backend/agent-runtime/`, `backend/api/`, `shared/openapi.yaml`,
`shared/schemas/agent/`, migrations 023-044 and Supabase mirrors,
`scripts/canary/`, the Agent architecture audit, Go/Assets frontend files, and
the shared coordination/OpenCode command files. Preserve unrelated UI changes.

## Remaining

1. Keep enforcement off until the authorized rollout. Harness,
   concurrency/idempotency, reconciliation, rollback, and legacy-response
   compatibility now have no-broadcast evidence. The rollout design lives in
   `docs/engineering/financial-gateway-rollout.md`.
2. Execute the financial-gateway rollouts (transfer -> swap -> pump) as
   explicit, independently reversible steps with rollback observation.
3. Review the dirty-tree diff, exclude secrets/generated noise, then prepare a
   scoped commit/PR only when publication is explicitly authorized.

## Known blockers

Pump enforcement evidence gates now pass without broadcasting. Production
enforcement still requires an explicit authorized rollout and must remain off
until then. Pulse coverage remains sampled/partial.

## Do not break

Do not reset, clean, stash, or overwrite the dirty tree. Do not perform a
real-fund/token-launch test. Never blind-rebroadcast an unknown submission,
collapse `submitted` into `confirmed`, bypass explicit user signing, expose
wallet secrets, reintroduce HertzFlow runtime coupling, or split the Vercel
catch-all/generated bundles without full route parity.
