# Architecture boundaries

This document describes the implementation boundaries Codex and other AI coding agents should preserve.

## Current product shape

NarraOps is organized around three first-level product surfaces:

- Pulse: narrative discovery and evidence-backed opportunity cards.
- Go: Agent workspace that turns selected narratives into launch-ready plans.
- Assets: wallet-group, asset visibility, and execution preparation behind safety gates.

Invite is deferred. Launch is no longer a primary navigation surface. Launch-related code can remain as backend adapters, contracts, and review-only plan generation.

## High-level flow

```text
Public sources
  -> Pulse discovery worker
  -> evidence-preserving narrative cards
  -> Pulse UI
  -> Send to Go
  -> Go Agent task
  -> launch-ready plan card
  -> user edits and confirms
  -> backend adapter boundary
  -> disabled/review-only execution result until production gates pass
```

## Source-of-truth layers

### Product truth

- `PRODUCT_CONTEXT.md`
- `coordination/handoffs/product-pivot.md`
- `docs/product/pulse.md`
- `docs/product/go.md`

### Engineering truth

- `shared/openapi.yaml`
- `shared/schemas/`
- backend route implementations
- database migrations
- role-specific handoff files

### Security truth

- `SECURITY.md`
- `AGENTS.md`
- backend/execution safety gates
- execution constants and schemas

When product documents and older code disagree, preserve safety and update implementation toward the product pivot gradually.

## Agent boundary

The Agent may generate and revise structured plans. It must not directly control privileged resources.

Allowed:

```text
Agent -> backend task API -> validated tool -> result card
```

Not allowed:

```text
Agent -> raw database access
Agent -> private key or seed phrase
Agent -> signer service without policy gate
Agent -> chain broadcast without user confirmation and production readiness
Agent -> hidden profitability score
```

## Data boundary

Only send the model the minimum data needed for the current task.

Sensitive fields should be redacted or represented as safe references.

Examples:

- wallet public address: allowed when needed
- provider wallet ID: allowed as backend reference
- private key: forbidden
- seed phrase: forbidden
- service-role key: forbidden
- auth token: forbidden
- user secrets: forbidden

## Execution boundary

Real-fund execution remains disabled until all production gates are satisfied.

Required before enabling real execution:

- authenticated actor scoping
- durable idempotency
- policy enforcement
- isolated signer
- immutable audit trail
- reconciliation and finality rules
- rate limits and abuse controls
- monitoring and incident response

Review-only plans and simulations can exist before real execution.

## Pulse implementation boundary

Pulse should prefer explainable public-evidence processing.

Allowed:

- bounded public source fetching
- RSS/Atom ingestion
- static page fetch with SSRF protection
- dynamic-social deferral when no reviewed adapter exists
- conservative clustering
- evidence-preserving cards

Not allowed:

- fabricating source content
- treating inaccessible social pages as fetched
- training or evaluating on post-launch outcomes without leakage controls
- exposing profitability probability

## Go implementation boundary

Go should prefer deterministic cards over unconstrained chat.

Allowed:

- structured launch-ready plan card
- field-level edits
- `Send to Go` from Pulse
- adapter handoff in disabled/review-only mode

Not allowed:

- user-facing Launch Console as primary product direction
- autonomous execution without confirmation
- direct wallet manipulation from the model
- arbitrary model-generated schema changes

## Frontend guidance

The primary navigation should move toward:

```text
Go / Pulse / Assets
```

Launch may appear as a card, action, or internal workflow inside Go. It should not be restored as a first-class tab unless a later product decision records that change.

## Codex implementation strategy

For future code work, prefer small PRs:

1. Docs and product context.
2. Frontend navigation cleanup.
3. Pulse UI shell.
4. Pulse card API consumption.
5. Send-to-Go flow.
6. Go launch-plan card field editing.
7. Auth and per-user scoping.

Avoid mixing product pivot, auth, execution, UI, and migrations in one PR.
