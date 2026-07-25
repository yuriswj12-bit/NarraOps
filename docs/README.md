# NarraOps docs

This directory is the stable reading path for product, engineering, and AI coding work.

NarraOps is currently focused on reducing the cost for Meme Devs to discover, filter, and evaluate internet narratives, then turn selected narratives into launch-ready plans.

## Read order for Codex and AI coding agents

Before changing code, read these files in order:

1. `README.md` at the repository root.
2. `PRODUCT_CONTEXT.md`.
3. `coordination/PROJECT_STATE.md`.
4. `coordination/DECISIONS.md`.
5. `coordination/TASK_BOARD.md`.
6. `coordination/handoffs/product-pivot.md`.
7. The relevant file in this `docs/` directory.
8. The relevant role handoff under `coordination/handoffs/`.

If these files conflict, prefer the newest product-pivot material and the safety rules in `SECURITY.md`.

## Product docs

- `product/pulse.md` — Pulse product responsibility, card model, evidence rules, and UI expectations.
- `product/go.md` — Go Agent responsibility, launch-plan card boundaries, and adapter usage.

## Engineering docs

- `engineering/architecture.md` — Current system boundaries and implementation constraints.

## Planning docs

- `roadmap.md` — Low-risk implementation sequence after the product pivot.

## Non-goals for V1

- Do not expose profitability scores.
- Do not claim automated trading or real-fund execution is available.
- Do not treat social-media discovery as verified ownership, endorsement, or success probability.
- Do not move private keys, seed phrases, service-role keys, or signing secrets into the frontend, Agent context, logs, or normal database fields.

## Current primary product loop

```text
Pulse discovers and explains narrative opportunities
-> user reviews evidence and risk
-> Send to Go
-> Go creates a structured launch-ready plan
-> user edits and confirms
-> backend adapters remain disabled or review-only until production safety gates are satisfied
```
