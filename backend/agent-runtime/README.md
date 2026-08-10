# NarraOps Agent Runtime v2

This directory is the provider-neutral, client-neutral Runtime boundary proposed
in `docs/engineering/narraops-agent-architecture-audit.md`.

Phase 1 intentionally does not replace the live Go runtime or public routes.
It provides:

- stable Runtime, context, task, model, and tool contracts;
- a versioned Tool Registry with input/output schema validation;
- permission and exact-intent approval enforcement before tool execution;
- a provider-neutral Model Gateway;
- adapters for the current model helper and existing read-only integrations;
- a fail-closed compatibility facade for the current runtime.

Current compatibility rules:

- Go, Pulse, Assets, and existing cards/routes remain unchanged.
- New financial tools cannot register without an approval policy.
- Financial tool execution requires an actor-bound, unexpired, atomically
  consumed approval whose digest matches the exact execution intent.
- The legacy facade does not pretend to provide durable cancellation or event
  replay. Those remain Phase 3 work.
- Legacy model/provider code is accessible only through
  `LegacyNarraOpsModelProvider`.

Phase 2 adds an opt-in context boundary to the current message route:

- clients pass opaque, fixed-kind `contextRefs`; they do not send database rows;
- `ContextResolver` resolves every reference under the authenticated actor;
- Pulse snapshot and Assets wallet-group providers return whitelisted,
  model-safe projections only;
- stable context digests make the resolved input auditable and detect stale or
  substituted references;
- secret-shaped fields, duplicate references, cross-user resources, oversized
  context, and provider/ref mismatches fail closed;
- the existing Runtime receives only the resolved safe projection, while
  requests without `contextRefs` keep their current behavior;
- hosted conversation reads and message submissions verify the authenticated
  actor owns the conversation before accessing it.

Phase 3 adds the durable task/event foundation while keeping the legacy
orchestrator:

- a fixed task state machine rejects invalid or terminal-state rewrites;
- optimistic `stateVersion` transitions combine state updates with an ordered
  event-outbox append when migration 023 is present;
- task events can be replayed after a process restart with a per-task cursor;
- worker leases and bounded attempts recover queued/read-only work;
- interrupted protected work enters `reconciliation_required` and is never
  blindly executed again;
- actor-scoped task reads, event polling, and cancellation are available
  through the hosted API;
- `agent_tool_calls` and `agent_artifacts` durable tables establish the storage
  boundary for later Tool Registry and card migration.

Migration 023 must be applied before setting `AGENT_RECOVERY_ENABLED=true`.
Before the migration is present, the Supabase adapter detects the missing RPC
once and retains the legacy task-write path.

Phase 4 adds shadow-only approval observability:

- exact actor/action/resource/parameter tuples become durable
  `ExecutionIntent` records with a canonical SHA-256 digest;
- legacy Launch prepare, Launch broadcast, and Swap broadcast confirmations
  are mirrored into service-role-only approval/audit tables;
- secret-shaped fields and oversized parameter payloads fail closed before
  persistence;
- `AGENT_APPROVAL_SHADOW_ENABLED` gates the recorder, and recording failure is
  deliberately non-blocking while the legacy execution path remains the
  production authority;
- every persisted record is constrained to `shadow_mode=true`; no shadow
  record grants, signs, submits, or broadcasts an operation.

Migration 024 must be applied before enabling the shadow flag. Phase 4 does not
yet move financial execution into the Tool Registry and must not be interpreted
as approval enforcement.

The next approval-lifecycle foundation is deliberately disconnected from
execution:

- `ApprovalLifecycle` owns request, actor-bound approve/reject, expiry,
  recent-auth policy, exact-digest consume, optimistic state versions, and
  actor-scoped idempotency;
- migration 025 stores these records in authorization tables that are separate
  from shadow observations;
- service-role RPCs atomically decide and consume one approval and append an
  audit record;
- concurrent/replayed consumption returns no second authorization;
- no public route, Tool Registry adapter, signer, or broadcast path consumes
  these records yet.

This separation is intentional. A successful lifecycle record is not execution
authority until the remaining task/tool/execution and reconciliation gates are
implemented and the integration feature is explicitly enabled.

The actor-scoped decision API is also execution-disconnected:

- `GET /api/v1/agent/approvals/{approvalId}` returns only an approval owned by
  the authenticated actor;
- approve/reject require an exact expected state version and a trusted
  same-origin POST;
- recent authentication is derived from the server-stored Web3 session
  creation time, never from a client timestamp;
- the API exposes no approval-request endpoint to the model and no consume
  endpoint to clients;
- `AGENT_APPROVAL_API_ENABLED` gates the routes independently from approval
  shadowing and every execution feature.

The execution-reservation foundation closes the crash window between approval
consumption and durable execution identity:

- every durable approval is now bound to one `taskId` and `toolCallId`;
- the old unbound approval-request RPC and standalone consume RPC are revoked
  from the service role;
- `agent_reserve_execution_v1` atomically validates task, tool call, actor,
  exact intent, expiry, and optimistic versions; consumes the approval; creates
  one execution reservation; links the tool call; and moves the task to
  `executing` with an outbox event;
- actor-scoped idempotency returns the same reservation for an exact replay and
  rejects parameter drift or a second key for the consumed approval;
- reservation does not plan, sign, submit, or broadcast a transaction.

No public execution-reservation endpoint or production financial-tool adapter
uses this foundation yet.

The durable transition foundation records the post-reservation lifecycle
without connecting a provider:

- fixed transitions are `reserved -> submitted|failed|cancelled`,
  `submitted -> reconciliation_required|confirmed|failed`, and
  `reconciliation_required -> confirmed|failed`;
- `confirmed`, `failed`, and `cancelled` are immutable terminal states;
- `submitted` requires a transaction hash/signature derived before any
  broadcast attempt, and that identity cannot later be replaced;
- uncertain provider/network outcomes enter `reconciliation_required` rather
  than ordinary failure or automatic retry;
- `agent_transition_execution_v1` enforces actor binding and optimistic
  versions, writes execution audit plus durable task events, and is callable
  only by the service role;
- a failed transition requires a stable failure code.

The caller must commit `submitted` before invoking a future broadcaster. The
current repository still has no caller that signs or broadcasts.

Approved transaction meaning is represented separately from model/tool input:

- `agent.execution_envelope.v1` binds execution, actor, intent, action, chain,
  and an exact transaction set;
- `agent.transaction_inspection.v1` is the safe output expected from a future
  trusted chain-specific decoder, never from a model;
- the fail-closed verifier compares signer, message hash, chain ID,
  destination, calldata hash, nonce, native value, program IDs, recipients,
  assets, atomic amounts, slippage, network fee, and block/time lifetime;
- `agent_bind_execution_envelope_v1` persists one verified envelope while the
  execution is reserved, increments its optimistic version, and audits the
  binding;
- database constraints reject submitted/reconciliation/confirmed rows without
  the persisted envelope digest.

No production adapter emits a trusted inspection yet. The verifier and durable
binding therefore remain execution-disconnected until each chain/platform
decoder is separately implemented and tested.
