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

Do not rewrite the whole product just to change languages.

Keep existing JavaScript/MJS code running while behavior is still moving. New core modules should be designed so they can migrate toward TypeScript without changing product contracts.

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

## Migration Path

1. Keep the current JS/MJS product code stable.
2. Add or update JSON Schema for Pulse and Go card contracts.
3. Add TypeScript for new core API/UI boundaries.
4. Keep Python workers independent and schema-validated.
5. Move high-risk JS modules to TypeScript only after the contract is stable.

One-shot migration is not the industrialization path.
