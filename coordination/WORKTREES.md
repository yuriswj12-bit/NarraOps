# Worktree map

| Role | Absolute path | Branch | Daily responsibility |
|---|---|---|---|
| Integration | `C:\Users\hek\Documents\SOL单兵\narraops-product` | `main` | Reviews, merges, release checks; no daily feature work |
| Frontend | `C:\Users\hek\Documents\SOL单兵\narraops-frontend` | `feat/frontend` | Website, workbench, localization, UI state, animation, API and SSE clients |
| Backend and Agent | `C:\Users\hek\Documents\SOL单兵\narraops-backend-agent` | `feat/backend-agent` | API, Agent tasks, integrations, auth, persistence, SSE |
| Execution | `C:\Users\hek\Documents\SOL单兵\narraops-execution` | `feat/execution-integration` | Wallet/signing boundary, execution, chain adapters, audit, reconciliation |

## Start-of-task check

Every window must run this before editing:

```powershell
git rev-parse --show-toplevel
git branch --show-current
git status --short
```

If the path or branch differs from the table, stop and report it. Do not switch branches to repair another window.

## Communication

1. Read `AGENTS.md`, `coordination/PROJECT_STATE.md`, `coordination/DECISIONS.md`, and the matching handoff file.
2. Claim or update one row in `coordination/TASK_BOARD.md` through the integration role before implementation.
3. Work only in the assigned worktree and ownership area.
4. Commit a coherent change locally.
5. Update the matching handoff with commit, tests, changed contracts, and blockers.
6. Ask the integration role to review and merge. Do not merge into `main` from a feature window.

## Shared-file rule

If a feature requires changes to `shared/`, `coordination/`, `deploy/`, or root configuration, describe the required change in the role handoff. The integration role applies or merges it after checking other branches.

