# NarraOps

NarraOps is an AI-native narrative discovery and meme operations workspace.

It helps Meme Devs reduce the cost of finding, filtering, and understanding memeable internet narratives, then turns selected narratives into reviewable launch-ready plans.

## Product Direction

NarraOps is not trying to become another trading terminal, K-line tool, or launchpad interface. The product focuses on the work before execution:

- discover narrative opportunities from public internet signals;
- explain the story, evidence, risks, and crowding behind each opportunity;
- turn selected narratives into structured launch-ready plans;
- keep wallet groups, assets, and execution preparation behind clear safety boundaries.

The primary product surfaces are:

- `Pulse`: evidence-backed narrative discovery and opportunity filtering.
- `Go`: Agent workspace for analysis, plan generation, and structured task cards.
- `Assets`: wallet-group, asset view, and execution-preparation surface.

Launch adapters remain backend tools. They are not a first-level product surface.

## Current Product State

This repository contains the current NarraOps product implementation. Some capabilities are still review-only or disabled because they involve funds, keys, production data sources, or execution boundaries. Do not describe planning-only behavior as live execution.

Current capabilities include:

- Pulse opportunity cards and public-evidence research fixtures.
- Go Agent conversations, structured cards, task state, and SSE replay.
- Launch-ready draft and adapter foundations behind safety boundaries.
- Wallet groups, transfer previews, and asset views.
- Supabase auth and analytics migration foundation.
- GMGN, HertzFlow, and launch-platform integration skeletons.

Live signing, transaction submission, custody, and automated fund execution remain disabled unless explicitly reviewed and enabled.

## Engineering Language Split

NarraOps should not remain a simple JavaScript-only codebase. The long-term codebase should use each language where it is strongest:

- TypeScript: product UI, API routes, Agent workflow, state machines, auth, subscriptions, wallet groups, launch adapter contracts.
- Python: Pulse data collection, evidence processing, source adapters, narrative clustering, blind evaluation, and scoring experiments.
- SQL / Supabase Postgres: users, profiles, stats, Pulse cards, Go conversations, launch-ready plans, wallet groups, usage limits, and audit events.
- OpenAPI / JSON Schema: shared contracts across frontend, backend, Python workers, and database persistence.
- Markdown: product context, architecture decisions, handoffs, and Codex task boundaries.

Existing JavaScript/MJS code may stay in place while behavior is still changing. New core contracts and high-risk state should move toward TypeScript gradually, not through a one-shot rewrite.

## Local Development

Open `index.html` for the static landing preview.

For local API mode:

```powershell
cd .\narraops-product
npm start
```

`npm start` builds the TypeScript frontend entry before starting the local services. Run the engineering checks directly with:

```powershell
npm run typecheck
npm run check
```

Then open:

```text
http://127.0.0.1:5188
```

Browser code should call relative `/api/v1` URLs. Do not hard-code local backend ports in product code.

## Safety Boundaries

- No private keys, seed phrases, wallet secrets, authorization headers, cookies, or production API keys may be committed or logged.
- Agent output is a plan or structured card, not direct permission to execute funds.
- Models must not directly access databases, private keys, signing, or broadcast capabilities.
- `submitted` is not `confirmed`.
- Real execution requires signer isolation, authenticated actor scoping, durable idempotency, policy checks, immutable audit, and confirmation reconciliation.

## Next Implementation Steps

1. Finish Supabase auth, user profile, and usage stats wiring.
2. Persist Pulse cards and evidence details behind a stable schema.
3. Connect Go to fixed-schema launch-ready plan cards.
4. Add frontend consumption of `/api/v1` Agent and Pulse contracts.
5. Add usage limits and basic SaaS-ready analytics.
6. Prepare a staging deployment with health checks, environment management, and rollback notes.
