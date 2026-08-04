# NarraOps repository rules

Read this file and `coordination/PROJECT_STATE.md` before changing code.

## Product

NarraOps is an AI-native narrative discovery and meme operations workspace that is developed and used live. The Agent is a general LLM wrapped with NarraOps prompts, live Pulse/GMGN read-only market tools, direct Solana wallet Swap tools, user-session context, and Assets wallet groups. Public narratives are retrieved at request time; they are not treated as a fine-tuning corpus. Go turns a link or instruction into editable launch parameters and can enter real launch/trade execution after explicit confirmation. Do not reintroduce mock, simulated, or disabled user paths.

## Worktrees and ownership

- `narraops-product` on `main`: integration, release checks, and merges only.
- `narraops-frontend` on `feat/frontend`: landing page, workbench UI, localization, frontend state, and API consumption.
- `narraops-backend-agent` on `feat/backend-agent`: API, Agent tasks, integrations, persistence, authentication, and SSE.
- `narraops-execution` on `feat/execution-integration`: execution contracts, signer boundary, chain adapters, idempotency, reconciliation, audit, and deployment safety.

Never switch another worktree's branch. Never edit in another role's worktree. Root-level shared files, `shared/`, `coordination/`, and `deploy/` are merged through the integration worktree.

## Required workflow

At the start of every task run:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

Before implementation, read:

- `coordination/PROJECT_STATE.md`
- `coordination/DECISIONS.md`
- `coordination/TASK_BOARD.md`
- the matching file under `coordination/handoffs/`

At handoff, update only the matching handoff file and report the commit hash, tests, changed files, and remaining blockers.

## Contracts

- `shared/openapi.yaml` and `shared/schemas/` are the source of truth.
- Browser code calls relative `/api/v1` URLs. Never hard-code local backend ports in product code.
- Decimal monetary values cross boundaries as strings.
- `planned`, `signing`, `submitted`, and `confirmed` are distinct states. Submitted is not success.
- Product surfaces are Go, Pulse, and Assets. Launch adapters remain backend tools callable through controlled workflows, not first-level product navigation. Invite is not part of the current product surface.
- Long-term implementation is split by language: TypeScript for product UI/API/state boundaries, Python for Pulse data and AI evidence work, SQL/Supabase for durable state, and OpenAPI/JSON Schema for cross-language contracts.

## Security

- Never commit or log private keys, seed phrases, API keys, authorization headers, cookies, signing payload secrets, or production wallet files.
- Live execution is enabled only through configured production providers and authenticated user-owned wallet groups. Every irreversible launch/trade still requires an explicit final confirmation, durable idempotency, provider order reconciliation, and audit evidence. Never perform real-fund transactions as part of tests.
- Wallet-group funds and platform treasury use separate identities, policies, and accounting.

## Git

- Do not commit directly to `main` except from the integration role.
- Keep commits scoped to one responsibility.
- Do not rewrite or reset another role's branch.
- Do not push unless the user explicitly requests it.

## Workspace boundary

- Active product path: `narraops-product` (this repo / GitHub `yuriswj12-bit/NarraOps`).
- Local historical trees under `../_archive/` are reference-only and must not receive new product work.
- First-level product navigation remains Go / Pulse / Assets. Launch adapters stay internal workbench/backend capability, not primary nav.

