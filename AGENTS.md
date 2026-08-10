# NarraOps repository rules

Read this file, `coordination/PROJECT_STATE.md`, `coordination/DECISIONS.md`, and
`coordination/CURRENT_TASK.md` before changing code. Shared repository files are
the source of truth across Codex, OpenCode, and other sessions.

## Truth and scope

- Resolve state in this order: current code, current working tree, recent `main`
  commits, current README/rules, then older coordination documents.
- Do not mark an implemented capability pending merely because an old task board
  or handoff says so. Read history and old handoffs only when tracing a cause.
- NarraOps is an Agentic Meme Launch OS. First-level surfaces are `Go / Pulse /
  Assets`; launch and trade adapters are controlled capabilities, not primary
  navigation. Invite is out of the current product boundary.
- Do not reintroduce HertzFlow as a runtime dependency. GMGN supplies read-only
  market intelligence; fund execution uses reviewed direct adapters.

## Architecture

- Public paths stay on one domain: `/`, `/app`, `/api/v1/*`, and
  `/api/v1/events`. Browser code uses relative `/api/v1` URLs.
- Preserve the Vercel `/api/v1/*` catch-all and generated Agent Runtime and
  launch-planner bundles unless a verified replacement covers every route.
- `shared/openapi.yaml` and `shared/schemas/` are contract sources of truth.
  Decimal monetary values cross boundaries as strings.
- TypeScript owns UI/API/runtime boundaries, Python owns Pulse collection and
  evidence processing, SQL/Supabase owns durable state, and OpenAPI/JSON Schema
  owns cross-language contracts.
- Live provider gaps must remain explicit. Never replace unavailable data or
  execution with fabricated, mock, or simulated production results.

## Funds, auth, and safety

- An Agent result, task, plan, or approval suggestion is never authority to move
  funds. Every irreversible launch, swap, transfer, export, or delete keeps the
  explicit user-confirmation and authenticated actor boundary.
- User/browser wallets sign in the browser. Assets-managed wallets stay behind
  server-side encrypted custody controls. Never expose or log secrets.
- Keep `planned`, `waiting_approval`, `reserved`, `submission_pending`,
  `submitted`, `reconciliation_required`, `confirmed`, `failed`, and
  `cancelled` semantically distinct. Submitted is not confirmed.
- Unknown provider outcomes require reconciliation, never blind rebroadcast.
- Tests and canaries must never submit a real-fund transaction.

## Workflow

At task start run `git rev-parse --show-toplevel`, `git branch --show-current`,
and `git status --short`. Preserve unrelated dirty changes and never reset or
rewrite another worktree. Use `git worktree list` before branch/worktree work.

Make the smallest scoped change, update contracts with implementation, and run
the relevant typecheck, tests, build, and `git diff --check`. Do not commit
secrets. Do not push unless the task authorizes publishing.

Before switching provider or Agent, run `/handoff`. At resumption, run `/resume`.
Keep `CURRENT_TASK` small and local-state focused; move only durable facts to
`PROJECT_STATE`, durable architecture reasons to `DECISIONS`, and meaningful
remaining work to `TASK_BOARD`.
