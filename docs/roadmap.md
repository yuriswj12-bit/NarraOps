# Product pivot roadmap

This roadmap keeps the next work small, safe, and useful for Codex-driven development.

## Current direction

NarraOps focuses on reducing the cost for Meme Devs to discover, filter, and evaluate internet narratives.

The main product loop is:

```text
Pulse discovers narrative opportunities
-> user reviews evidence
-> Send to Go
-> Go creates a launch-ready plan
-> user edits and confirms
-> backend adapters remain disabled/review-only until production safety gates pass
```

## Phase 0: Documentation alignment

Goal: make the repository readable and consistent before more code changes.

Tasks:

- Refresh README around Pulse and Go.
- Add security policy.
- Add product docs for Pulse and Go.
- Add architecture boundary documentation.
- Keep old Launch implementation notes as backend capability, not primary UX.

Done when:

- A new developer or Codex can identify the current product direction in under five minutes.
- README, PRODUCT_CONTEXT, and product-pivot handoff do not conflict on core positioning.

## Phase 1: Frontend navigation cleanup

Goal: reflect the product pivot in the UI without deleting backend capability.

Tasks:

- Remove Launch from primary navigation.
- Keep Go, Pulse, Assets, Invite.
- Preserve any Launch-related route or component only when needed for internal workflow compatibility.
- Add clear Go entry points for launch-ready plan creation.

Done when:

- The first-level UI no longer presents NarraOps as a launchpad clone.
- Users can still create a plan through Go.

## Phase 2: Pulse UI MVP

Goal: make Pulse the primary product value surface.

Tasks:

- Add market activity overview section.
- Add narrative opportunity card list.
- Add narrative detail state or route.
- Show source evidence, risk flags, missing evidence, and status.
- Add `Send to Go` action.

Done when:

- Users can browse narrative candidates and understand why each candidate appears.
- The UI does not expose profitability scores.

## Phase 3: Pulse API consumption

Goal: connect UI to the existing Pulse discovery output gradually.

Tasks:

- Expose active Pulse cards through `/api/v1` after shared contract update.
- Map backend statuses to UI states.
- Preserve source URLs and missing-evidence fields.
- Handle empty, unavailable, stale, and disabled data states honestly.

Done when:

- Pulse displays traceable cards from bounded public evidence fixtures or live worker output.
- Failure and disabled states are visible instead of silently replaced by fake data.

## Phase 4: Send to Go

Goal: connect the discovery surface to the Agent workspace.

Tasks:

- Pass selected narrative ID, title, summary, source URLs, and evidence snapshot into Go.
- Create or append to a Go conversation.
- Generate a launch-ready plan card with deterministic fields.
- Preserve provenance from Pulse to Go.

Done when:

- A user can move one narrative candidate from Pulse into Go without copying text manually.

## Phase 5: Go plan editing

Goal: make Go useful as a structured workspace, not only a chat page.

Tasks:

- Render launch-ready plan card fields.
- Support field-level edits.
- Keep backend plan state as source of truth.
- Show missing fields and risks.
- Keep execution status disabled or review-only.

Done when:

- Users can edit name, ticker, links, logo reference, chain, platform, and wallet selections without regenerating the whole plan.

## Phase 6: Account and SaaS foundation

Goal: prepare for subscription-style product usage without premature payment logic.

Tasks:

- Run Supabase MVP migration.
- Verify RLS with two test accounts.
- Add frontend Supabase client and phone-alias auth flow.
- Add backend JWT verification and user scoping before exposing account or execution routes.
- Track usage events through the analytics RPC.

Done when:

- Users have isolated accounts.
- Usage can be counted safely.
- No service-role keys are exposed to frontend code.

## Phase 7: Subscription design

Goal: define SaaS tiers after core value is visible.

Possible dimensions:

- number of Pulse cards viewed
- update frequency
- source coverage
- saved narratives
- Go plan generation count
- advanced evidence views
- team workspace support

Avoid:

- profitability-based claims
- profit share as V1 main model
- hidden trading automation

## Phase 8: Controlled execution readiness

Goal: prepare execution only after the product and safety base are ready.

Tasks before any real-fund execution:

- isolated signer
- authenticated actor scoping
- durable idempotency
- immutable audit
- policy engine
- confirmation reconciliation
- rate limits
- monitoring and incident response
- legal and risk review

Until then, execution remains disabled, simulated, or review-only.

## Near-term priority

Recommended next implementation order:

1. Frontend navigation cleanup.
2. Pulse UI shell.
3. Pulse cards from fixture/API.
4. Send-to-Go handoff.
5. Go launch-ready plan card editing.
6. Supabase auth integration.

Keep each PR small enough to review.
