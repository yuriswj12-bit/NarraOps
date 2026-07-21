# NarraOps

AI-native narrative discovery workspace for Meme Devs.

NarraOps helps Meme Devs discover, filter and evaluate internet narratives with lower cost, then turn selected stories into launch-ready plans.

## Current status

NarraOps is an early prototype. The repository is being built in public while the product direction is moving toward Pulse and Go:

- **Pulse** discovers and reviews internet narratives with public evidence.
- **Go** turns selected links, text, or images into structured launch-ready plans.
- **Assets** keeps wallet-group and execution-preparation context.
- **Invite** supports early access, contribution records, and community growth.

Launch-related code remains as an adapter/tool boundary for Go workflows. It is not the primary product surface.

## Product principle

The core product value is reducing the time and coverage cost required for Meme Devs to find, screen, and judge narratives before they become launch opportunities.

NarraOps should not be positioned as a trading bot, a launchpad clone, or a product that promises profit.

## Safety status

This repository is not production-ready for real-fund execution.

- Real-fund execution remains disabled by default.
- Private keys, seed phrases, API keys, cookies, and authorization headers must never be committed or logged.
- The Agent may create reviewable plans, but it must not bypass policy services or user confirmation.
- Signing and broadcasting are separate execution states.
- A submitted transaction is not a confirmed transaction.
- Pulse must not expose profitability scores or success-probability claims.
- User wallet groups and platform treasury must use separate identities, policies, and accounting.

See [`SECURITY.md`](SECURITY.md) for reporting and testing boundaries.

## Main modules

### Pulse

Narrative discovery and evidence review.

Pulse is designed to collect bounded public sources, cluster related events conservatively, preserve evidence, and produce auditable opportunity cards. The current MVP includes RSS/Atom discovery and public-evidence processing. Dynamic social sources such as X, TikTok, and Instagram require official APIs or reviewed adapters before they can be treated as fetched evidence.

### Go

Agent command workspace.

Go accepts user input such as a link, text, or image and returns structured cards. The main output for launch workflows is a launch-ready plan with fixed fields, editable by the user before any execution step.

### Assets

Wallet-group and execution-preparation context.

Assets should help users organize public wallet references, wallet groups, and execution constraints. Raw private keys and seed phrases must stay outside the ordinary browser/API/database path.

### Invite

Early-access and community-growth support.

Invite is secondary to Pulse and Go during the current product phase.

## Architecture sketch

```text
Public internet sources
        |
        v
Pulse evidence worker -> Pulse opportunity cards -> Pulse UI
                                                  |
                                                  v
                                            Send to Go
                                                  |
                                                  v
User input -> Go Agent -> launch-ready plan -> adapter boundary -> disabled/reviewed execution
```

## Repository layout

```text
backend/api/                         Node API prototype and Supabase MVP notes
backend/integrations/pulse-evidence/ Pulse public-evidence and discovery MVP
backend/execution/                   Execution adapters and simulation-only boundaries
coordination/                        Project state, decisions, handoffs, roadmap
coordination/handoffs/product-pivot.md Current Pulse/Go product pivot handoff
shared/                              OpenAPI and JSON Schema contracts
database/migrations/                 Database and Supabase MVP migrations
```

## Local development

The repository is in transition from the original static prototype to the backend/API prototype. Prefer the module-specific README and handoff files before changing code.

### Backend API

```bash
cd backend/api
npm install
npm test
```

### Pulse evidence worker

```bash
cd backend/integrations/pulse-evidence
python -m pip install -r requirements.txt
python -m unittest test_evidence_processor.py test_pulse_discovery.py -v
```

### Supabase MVP

Read [`backend/api/SUPABASE_MVP_SETUP.md`](backend/api/SUPABASE_MVP_SETUP.md) before configuring authentication or user data.

The MVP uses a phone-number-and-password UI backed by Supabase Email/Password aliases. Native Supabase Phone Auth remains disabled until an SMS provider and verified recovery policy are configured.

## Important docs

- [`PRODUCT_CONTEXT.md`](PRODUCT_CONTEXT.md) — current product context and safety boundaries.
- [`coordination/handoffs/product-pivot.md`](coordination/handoffs/product-pivot.md) — product pivot to Pulse and Go.
- [`coordination/handoffs/backend.md`](coordination/handoffs/backend.md) — backend/API handoff and blockers.
- [`backend/api/SUPABASE_MVP_SETUP.md`](backend/api/SUPABASE_MVP_SETUP.md) — Supabase MVP setup.
- [`backend/integrations/pulse-evidence/PULSE_DISCOVERY_README.md`](backend/integrations/pulse-evidence/PULSE_DISCOVERY_README.md) — Pulse discovery worker.
- [`backend/integrations/pulse-evidence/PULSE_V0_RULES.md`](backend/integrations/pulse-evidence/PULSE_V0_RULES.md) — Pulse V0 operational rules.

## Roadmap direction

Short-term priorities:

1. Expose Pulse active cards through the shared `/api/v1` contract.
2. Build the Pulse UI around market activity, opportunity cards, evidence, and `Send to Go`.
3. Update Go around structured launch-ready plan cards.
4. Keep Launch as an adapter boundary, not a primary navigation item.
5. Finish Supabase MVP authentication and user-scoped analytics.
6. Add CI for Node tests, Pulse Python tests, schema validation, and secret scanning.

## Commercial direction

V1 should explore SaaS subscription around narrative discovery, evidence review, opportunity filtering, and workflow limits.

Launch fees, profit sharing, or performance-based revenue require separate legal, attribution, accounting, and audit review before they can be considered.

## Build notes for AI coding agents

Before changing code, read:

1. [`AGENTS.md`](AGENTS.md)
2. [`PRODUCT_CONTEXT.md`](PRODUCT_CONTEXT.md)
3. [`coordination/PROJECT_STATE.md`](coordination/PROJECT_STATE.md)
4. [`coordination/DECISIONS.md`](coordination/DECISIONS.md)
5. [`coordination/handoffs/product-pivot.md`](coordination/handoffs/product-pivot.md)
6. The role-specific handoff under `coordination/handoffs/`

Keep product behavior aligned with the current Pulse/Go direction. Do not reintroduce Launch as the primary front-end product surface unless a later product decision explicitly changes this boundary.
