# Integration handoff

## 2026-07-11 worktree split

- `main` contains the merged backend, execution, shared contract, deployment, and collaboration foundations.
- `feat/frontend` contains the restored NarraOps landing page, workbench entry, hero asset, and motion overlay.
- Frontend recovery backup: `stash@{0}: frontend-wip-before-worktree-split-2026-07-11`. Keep it until frontend review is complete.
- Backend and execution test suites pass in mock/planning mode.
- Real-fund execution remains disabled.

## Current baseline

- Agent backend commit reviewed and merged locally.
- Execution foundation commit reviewed and merged locally.
- Unified OpenAPI contains Agent planning, SSE, and execution contracts.
- Backend tests: 8 passing.
- Execution tests: 5 passing.
- No credential-shaped values found in the reviewed feature branches.

## Integration rules

- Review feature commits before merging into `main`.
- Run backend and execution tests after every shared-contract merge.
- Keep remote push as an explicit user-approved action.
- Do not enable real execution as part of a merge or deployment convenience change.

## Pending

- Restore and commit frontend work on `feat/frontend`.
- Merge these coordination rules into each active feature branch before the windows resume.
- Add contract validation tooling when the package strategy is selected.

## 2026-07-16 launch integration handoff

### Integrated today

- Pump.fun and Four.Meme launch transaction construction is integrated, including platform metadata/image flows.
- Cooking wallets use encrypted internal wallet material and can sign Solana/EVM launch transactions after one user confirmation.
- Pump.fun and Four.Meme launch confirmation, follow-buy planning, batch execution, partial-failure retention, durable execution state, recovery, and failed-wallet-only retry are integrated.
- Wallet groups now have real Solana/EVM addresses; Cooking groups are restricted to one wallet.
- Production configuration requirements are documented in `coordination/LAUNCH_EXTERNAL_CONFIG_CN.md`.

### Verification snapshot

- Backend tests: 39 passing.
- Execution tests: 35 passing.
- Frontend/root JavaScript syntax checks pass.
- `REAL_EXECUTION_ENABLED` remains false; no real transaction was broadcast and no funds were moved.

### Product decision paused

- Equal, random, and ladder follow-buy allocation currently exist as provisional code and UI.
- The user explicitly rejected treating the current buy/sell rules as final and wants time to redesign them.
- Do not extend, enable, or present these rules as production behavior until the user provides the final semantics.

### Blockers and next order

1. Obtain the user's final buy/sell rule definition, including allocation, timing, balance, slippage, and failure behavior.
2. Revise or feature-gate the provisional allocation UI and execution logic.
3. Add end-to-end dry-run fixtures and per-wallet execution status UI.
4. Resolve or isolate the Pump SDK dependency audit findings (13 total: 6 high, 7 moderate).
5. Collect external secrets/RPC configuration and perform controlled small-wallet on-chain verification.
6. Keep real broadcast disabled until security review and explicit user approval.

### Shutdown state

- No live execution is pending.
- No remote push was performed.
- Daily report: `coordination/DAILY_REPORT_2026-07-16_CN.md`.
