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
