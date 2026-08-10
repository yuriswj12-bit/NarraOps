# Durable architecture decisions

Only decisions that future Agents must preserve belong here.

1. **Product surfaces are Go / Pulse / Assets.** Launchpads and trading are
   controlled workflow capabilities, not first-level navigation. Invite and
   referral are deferred. This keeps NarraOps focused on narrative-to-operation
   rather than becoming a generic launchpad or trading terminal.

2. **The public app is single-domain.** Keep `/`, `/app`, `/api/v1/*`, and
   `/api/v1/events`; frontend code calls relative paths. The Vercel catch-all is
   intentional because it centralizes serverless routing, shared auth, and the
   generated Agent Runtime/launch-planner bundles.

3. **Contracts are explicit and cross-language.** `shared/openapi.yaml` and
   `shared/schemas/` define API/runtime boundaries. Monetary decimals cross
   boundaries as strings. Product state names must not be collapsed for UI
   convenience.

4. **Production truth is never simulated.** A missing LLM, market feed, RPC,
   database, or provider is an unavailable/data-gap result. Mock fixtures may be
   used only in tests and must never masquerade as live product data or an
   executed transaction.

5. **GMGN is read-only intelligence.** It supplies market/trending/K-line/token
   research. It is not the authority for fund execution. Do not restore old
   GMGN launch/swap wording or execution coupling.

6. **HertzFlow is not a NarraOps runtime dependency.** Historical handoffs and
   visual inspiration may mention it, but the reviewed product runtime no longer
   integrates it. Do not reintroduce profile-local or unverified HertzFlow code.

7. **Wallet signing follows custody ownership.** Connected user wallets sign in
   the browser. Assets-managed wallets use server-side encrypted custody and
   narrowly scoped operations. Private keys never enter ordinary browser/API
   payloads, logs, Git, model context, or general database fields.

8. **Pump and Jupiter are direct execution adapters.** Pump launch is prepared
   and inspected server-side, signed by the user wallet, then validated before
   direct submission. Solana Swap uses a Jupiter-built transaction plus Assets
   wallet/browser signature. Read-only provider results never grant execution.

9. **Agent intent is not fund authority.** Model output may propose a tool call
   or launch plan, but irreversible execution requires an authenticated actor,
   exact intent digest, explicit approval/signature, durable idempotency,
   transaction inspection, audit evidence, and reconciliation.

10. **Execution states preserve crash and provider uncertainty.**
    `submission_pending` claims one signed transaction before the external
    call; `submitted` is written only after provider acceptance of the same
    signature; unknown outcomes become `reconciliation_required` and are never
    blindly rebroadcast.

11. **Agent Runtime migration is incremental.** Keep the current Go/launch/swap
    behavior behind a compatibility facade while v2 context, tasks, approvals,
    envelopes, and execution are shadowed and verified. Feature flags are
    independent. Never enable Pump enforcement before the no-broadcast signed
    harness and rollback gate pass.

12. **Supabase authorization is server-enforced.** Actor ownership, RLS,
    service-role-only financial RPCs, optimistic state versions, and immutable
    audit are boundaries, not optional implementation details. Client timestamps
    or model assertions cannot establish recent authentication or ownership.

13. **Context recovery is deliberately small.** Default Agent context is
    `AGENTS + PROJECT_STATE + DECISIONS + CURRENT_TASK + git status/diff +
    task-related code`. Load TASK_BOARD, handoffs, Git history, GitHub, or
    unrelated code only when needed to choose work or trace a cause.

14. **Agent configuration and memory are a server-only control plane.** Agent
    and Skill definitions are immutable, checksummed versions; Skills contain
    declarative instructions/schema/dependencies but never executable code.
    Durable Memory is actor-bound, source-attributed, lifecycle-versioned, and
    user facts/preferences require explicit confirmation. Models receive only a
    bounded safe projection after Runtime resolution and never receive database
    handles. Global actor Memory has `agent_id = null`; Agent-specific Memory is
    filtered by `agent_id`.

15. **Model policy belongs to the Agent version, not Go or a business
    handler.** Conversation replies and structured launch content use the same
    provider-neutral Model Gateway. Provider adapters may be replaced without
    changing task, tool, approval, execution, or card contracts; an allowed
    provider must also be registered before use.

16. **Published Tool and Skill schemas are immutable.** A business handler
    needing wider inputs publishes a new semantic Tool version and a new Skill
    version, then advances the Agent definition version. Existing versions
    remain registered for replay and compatibility. `market.gmgn.trending@1`
    was therefore preserved while filtered market reads moved to `2.0.0` under
    `market-research@2` and `narraops-agent@2`.
