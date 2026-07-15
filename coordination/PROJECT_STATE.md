# Project state

Project: NarraOps (`C:\Users\hek\Documents\SOL单兵\narraops-product`)

- `main` contains the reviewed Agent backend skeleton, planning-only execution core, shared contract, database migration draft, and deployment skeleton.
- The landing page and workbench are committed on `feat/frontend` in the dedicated `narraops-frontend` worktree.
- A named pre-split frontend stash is retained temporarily as a recovery backup and must not be dropped until the frontend branch is reviewed.
- Agent and execution automated tests pass in mock/planning mode.
- Real signing, transaction submission, confirmation tracking, durable execution storage, authentication, and production deployment are not implemented.
- Real-fund execution is deliberately disabled.
- Public route target: `/`, `/app`, `/api/v1/*`, `/api/v1/events`.
- Worktree paths and branch ownership are defined in `coordination/WORKTREES.md`.

Last integration update: 2026-07-11.
