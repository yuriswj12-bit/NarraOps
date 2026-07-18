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

## 2026-07-18 integration update

- Web3 signature authentication, live login-wallet SOL/BNB balances, single-chain wallet groups, encrypted wallet provisioning, private-key export safeguards, and unified transfer planning are integrated on `main`.
- Solana login-wallet transfers now obtain a recent blockhash through the configured backend RPC and then hand the complete transaction to the browser wallet for native confirmation. The redundant in-app confirmation was removed.
- Automated verification currently passes: backend API 46/46 and execution 42/42.
- Real-fund custody execution remains protected by `REAL_EXECUTION_ENABLED`; browser-owned login-wallet transactions are always confirmed by the wallet extension.
- Pulse expansion is paused by product decision. See `PRODUCT_WORKFLOW_STATUS_CN.md` for current priorities.

Last integration update: 2026-07-18.
