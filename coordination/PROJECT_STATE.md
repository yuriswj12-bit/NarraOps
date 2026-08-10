# NarraOps current project state

Verified against `main` code and the local working tree on 2026-08-10.

## Product boundary

NarraOps is an Agentic Meme Launch OS that connects narrative discovery to
reviewable launch and wallet operations. The only first-level product surfaces
are:

- **Go** — Agent conversation, analysis, live market tools, editable launch
  drafts, task cards, and controlled execution entry.
- **Pulse** — evidence-backed narrative discovery plus sampled Pump.fun market
  and Dev-wallet intelligence.
- **Assets** — authenticated wallet groups, balances, custody/export controls,
  transfers, launch-wallet selection, and direct Swap preparation.

Launchpads and Swap are capabilities inside Go/Assets workflows. Invite,
referral, and a standalone launchpad/trading-terminal surface are not current
product scope.

## Runtime and application architecture

- One public Vercel domain serves `/`, `/app`, `/api/v1/*`, and
  `/api/v1/events`. `api/v1/[...path].ts` is the consolidated serverless API
  boundary; browser calls remain relative.
- The Vercel build generates and bundles the frontend, Agent Runtime
  (`api/v1/agent/runtime.cjs`), and launch planner
  (`api/v1/launch-planner.cjs`). Do not split the catch-all without replacing
  its full routing and bundle behavior.
- Go uses an OpenAI-compatible live LLM provider and live/read-only integrations.
  Missing providers return unavailable/data-gap results rather than fake data.
- Agent tasks have actor-scoped durable states, optimistic versions, event
  replay, cancellation, bounded recovery, and read APIs. The browser submits a
  task and polls its status; SSE remains available for compatible clients.
- Pulse narrative recommendation now crosses the Runtime-owned fixed Tool
  Registry as `pulse.narratives.list@1.0.0`; actor, permissions, schema
  validation, request trace, and idempotency context are assigned outside the
  model.
- Filtered GMGN trending reads cross the same boundary as
  `market.gmgn.trending@2.0.0`. Published v1 was not changed: migration 044
  advances the catalog to `narraops-agent@2` and `market-research@2` while
  retaining previous immutable versions.
- Narrative scanning and launch-source retrieval cross
  `research.public_link.read@1.0.0`; public content remains untrusted evidence
  and the existing SSRF-safe adapter is called only behind Runtime validation.
- Buy/sell planning resolves actor-owned wallet-group metadata through
  `assets.wallet_groups.list@1.0.0`. It remains a read-only projection;
  private keys, signers, wallet signatures, and execution adapters do not enter
  the Tool result or model context.
- The first financial Tool contract, `launch.pump.broadcast@1.0.0`, exists
  locally with fixed shared schemas, consumed-approval + recent-auth policy,
  immutable reservation/transaction identity, and no automatic retry. The
  local signed harness reaches it through an injected zero-network gateway,
  while it remains unregistered in the production Agent and outside production
  authority.
- Equivalent local-only fixed contracts now exist for
  `swap.solana.broadcast@1.0.0` and `assets.transfer.broadcast@1.0.0`. Both
  require an atomically consumed recent-auth approval and accept only reserved
  execution identity, semantic-envelope digest, state version, and immutable
  transaction hash. They contain no private key or signed transaction bytes,
  have no automatic retry, and are neither published nor connected to
  production authority.
- `GET /api/v1/agent/capabilities` provides a client-neutral discovery contract
  for Go, Pulse, Assets, and future clients. It projects only the current
  published Agent/Skill capability metadata and explicitly withholds system
  instructions, internal identifiers, checksums, binding config, Memory
  content, and execution credentials. Production reports zero published
  financial Tools.
- The Agent control plane now persists immutable Agent/Skill versions and
  actor-bound durable Memory in Supabase. Executable tools, permissions,
  approvals, and provider selection remain Runtime code.
- Runtime knowledge resolution occurs before Model Provider selection.
  `AGENT_KNOWLEDGE_ENABLED=true` in production, and only confirmed bounded
  Memory plus the immutable Agent manifest enter the Model request.
- `backend/agent-runtime/`, Agent v2 schemas, and migrations 023–043 introduce a
  provider-neutral Runtime, safe context references, tool contracts, durable
  approvals, execution reservations, semantic envelopes, Pump transaction
  inspection, and reconciliation.

## Go, Pulse, and Assets status

- **Go:** live conversation/task flow, provider-backed replies, GMGN read-only
  research, Pulse/Assets context references, editable Pump launch drafts, and
  frontend task polling are implemented. Current local UI changes simplify the
  conversation/launch card and harden timeouts and retries.
- **Pulse:** public narrative, market-index, Dev-wallet PnL, and user-state APIs
  are implemented. Inputs are real evidence, direct Solana sampling, and
  read-only GMGN data. Coverage, history warm-up, and source gaps stay visible.
- **Assets:** Web3 signed sessions, actor ownership, wallet groups, encrypted
  wallet provisioning/export, balances, transfers, and Go wallet selection are
  implemented. Current local UI changes harden session loss, load failures,
  wallet/group creation, and deletion behavior.

## Wallet, launch, and Swap boundaries

- Web3 login proves control of the connected Solana/EVM wallet and scopes
  account data. User-owned browser-wallet transactions are built server-side
  but signed by the wallet extension.
- Pump.fun launch uses a direct prepare → browser sign → validate → submit →
  reconcile path. Semantic shadow and approval dual-run are recorded behind
  independent feature flags and cannot authorize or broadcast.
- Solana Swap uses Jupiter to prepare a transaction for an Assets wallet and
  browser signature; NarraOps validates/submits the signed bytes directly.
- Every irreversible action requires explicit confirmation. A provider-accepted
  signature is `submitted`, not `confirmed`; uncertain results become
  `reconciliation_required`. Go displays that state as unknown/reconciling and
  explicitly warns against signing or launching again.
- `AGENT_PUMP_ENFORCEMENT_ENABLED` remains off. The production launch path is
  still the existing direct path while Runtime enforcement is tested.

## Supabase and deployment

- Supabase supplies Web3 identities/sessions, actor-owned conversations/tasks,
  Pulse state, Assets persistence, durable task events, approvals, execution
  reservations, semantic shadows, and append-only audit records under RLS and
  service-role-only RPC boundaries.
- The latest backend handoff records production migrations through 034 as
  applied and rollback canaries as clean. Their repository migration files are
  still uncommitted in this working tree and must be preserved.
- Production semantic shadow and Pump approval dual-run are recorded as enabled;
  Pump enforcement is recorded as absent/off.
- Production also includes Agent control-plane migrations
  `20260810043000` through `20260810061500`. The reviewed
  `narraops-agent@1` and four read-only Skills are published. Self-cleaning
  catalog and authenticated production Memory/knowledge canaries passed and
  left no test users, conversations, tasks, or Memory rows.
- Production deployment `https://narra-dmvju6d5j-hek.vercel.app` is aliased to
  `https://www.narraops.xyz`; Memory API and Runtime knowledge are enabled,
  while Pump enforcement remains off.

## Explicit unfinished work and blockers

- The signed Pump enforcement harness, Supabase concurrent reservation canary,
  and legacy-response compatibility test now pass without broadcasting.
  Enforcement remains off pending an explicit authorized rollout. Automated or
  production tests must not send a real transaction.
- Current verification passes API/Runtime tests (133/133), execution tests
  (35/35), typecheck, 28 Agent schema parses, the Vercel production build, and
  `git diff --check`. Supabase local/remote migrations match through
  `20260810070000`; lint reports one existing unused local variable warning in
  `agent_transition_execution_v1`.
- Model selection for ordinary replies and structured narrative/meme/launch
  content now goes through the Agent-version Model Policy and registered Model
  Gateway. Business handlers retain a compatibility fallback only when the
  optional control-plane dependencies are absent.
- Production catalog and Runtime canary now verify `narraops-agent@2`,
  `pulse.narratives.list@1.0.0`, `market.gmgn.trending@2.0.0`, and
  `assets.wallet_groups.list@1.0.0`, plus the safe public capabilities
  projection and zero published financial Tools; the 13-check canary retries
  and verifies cleanup, and does not sign or broadcast.
- Go exposes an authenticated Memory manager. Proposed user preferences/facts
  are reviewable but cannot enter Agent context until explicit confirmation.
  Production browser QA confirms Go renders, the Memory entry is visible, and
  unauthenticated access stops at wallet login.
- Launch/Swap/Transfer have not cut over from legacy direct handlers to the
  provider-neutral Tool/Execution Gateway; keep the compatibility path until
  parity, reconciliation, and rollback are verified.
- Pulse still has bounded sampling and evidence/history gaps; do not label
  partial coverage as a complete market census.
- The primary working tree contains substantial uncommitted Runtime, migration,
  API, frontend, and styling work. See `coordination/CURRENT_TASK.md` and
  `git status --short` before any edit.
