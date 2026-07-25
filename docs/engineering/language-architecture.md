# NarraOps Language Architecture

Updated: 2026-07-22

## Principle

NarraOps should not evolve as a simple JavaScript-only codebase. The product spans UI, API, data intelligence, database state, execution boundaries, and AI workflows, so each layer should use the language that best fits its job.

## Layer Split

| Layer | Language / contract | Responsibility |
|---|---|---|
| Product UI | TypeScript | Go, Pulse, Assets, auth, settings, usage, state, SSE, and typed API clients |
| Backend API | TypeScript | `/api/v1`, auth middleware, repositories, Agent workflow, usage limits, billing, wallet-group services, launch adapter contracts |
| Pulse data intelligence | Python | source adapters, webpage/RSS parsing, evidence extraction, narrative clustering, blind evaluation, scoring experiments |
| Database state | SQL / Supabase Postgres | users, profiles, stats, Pulse cards, conversations, plans, wallet groups, quotas, audit events |
| Cross-language contract | OpenAPI / JSON Schema | shared request/response schemas for TS, Python, database persistence, and Codex task boundaries |
| Collaboration context | Markdown | product facts, architecture decisions, handoffs, task boards, and safety rules |

## Current Product Rule

TypeScript is the default product-engineering language. Python remains the dedicated Pulse data-intelligence language, and SQL remains the durable-state language. JavaScript is limited to generated browser output and the small local static-file server.

Language migration must preserve product contracts, safety switches, and tests. Changing an extension without a build, type-check, and regression path does not count as industrialization.

## Migration status

- The browser application source now lives at `frontend/src/app.ts` and is built with esbuild.
- Root `app.js` is generated output and is no longer committed as source.
- `frontend/src/lib/api-client.ts` owns the typed relative `/api/v1` request boundary.
- The legacy UI monolith is temporarily marked `@ts-nocheck`; new extracted modules must compile under strict TypeScript.
- Backend API, Agent, Auth, Repository, integration, execution-adapter, and backend test sources now use TypeScript.
- API and execution migrations retain temporary `@ts-nocheck` markers where the former JavaScript implementation still needs explicit domain types. These markers are migration debt, not the final type-safety target.
- Production API deployment runs an esbuild-generated Node.js bundle; production does not execute TypeScript source directly.
- Current regression gates cover 48 API tests and 43 execution tests, in addition to frontend/API builds and TypeScript checks.

## TypeScript First Areas

Prioritize TypeScript for:

- shared API request and response types;
- Pulse opportunity card contracts;
- Go launch-ready plan card contracts;
- Supabase auth/profile/usage types;
- execution status vocabulary;
- wallet group and asset models;
- Launch Adapter interfaces.

These areas are high-risk because field drift breaks the product quickly.

## Python Areas

Keep Python for:

- Pulse source adapters;
- evidence processing;
- narrative clustering;
- prelaunch feature extraction;
- historical cohort evaluation;
- blind review tooling;
- parser experiments.

Python workers should emit schema-validated data. They should not directly own user-facing route behavior.

## SQL Areas

All durable state changes must go through migrations.

Use Supabase/Postgres for:

- `profiles`;
- `user_stats`;
- `analytics_events`;
- `pulse_cards`;
- `pulse_evidence`;
- `go_conversations`;
- `go_messages`;
- `launch_ready_plans`;
- `wallet_groups`;
- `usage_limits`;
- `audit_events`.

Do not hand-edit production tables without a migration.

## Contract Rule

`shared/openapi.yaml` and `shared/schemas/` are the source of truth for cross-language boundaries.

Avoid these failures:

- Python emits `narrative_score` while TypeScript expects `score`;
- frontend renders `grade` while the database stores `rating`;
- Agent cards invent new fields not represented in schema;
- launch status values drift between API, UI, and execution code.

## Remaining Migration Path

1. Extract typed UI state and SSE modules from the transitional frontend monolith.
2. Replace `@ts-nocheck` in API request parsing, auth, repositories, and Agent contracts with explicit types.
3. Replace `@ts-nocheck` in execution adapters and state machines only alongside focused safety tests.
4. Keep Python workers independent and schema-validated.
5. Enforce build, type-check, API tests, execution tests, and schema validation in CI.

The source-language conversion is complete for the core product path. The remaining work is increasing strict type coverage without destabilizing the public-beta deployment.
