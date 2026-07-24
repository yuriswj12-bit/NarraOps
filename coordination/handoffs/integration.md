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

## 2026-07-24 local/remote reconciliation

- Preserved the former local `main` tip at `backup/main-pre-sync-20260724` (`f5bdad2`).
- Reconciled the 31 local Web3, Assets, wallet-group, and execution commits with the 25 remote Go/Pulse, TypeScript, Vercel, and Supabase commits.
- Merge commit: `ad1a3d8`.
- The TypeScript mainline already contains the migrated Web3 and Assets behavior, so obsolete generated JavaScript and duplicate legacy modules were not restored.
- Fixed the backend API check script to use `tsconfig.json`.
- Verification: TypeScript passed; backend API 48/48; execution 43/43; frontend and backend builds passed.
- No remote push was performed.
- Remaining product blockers: deploy `/api/v1` online, verify the production Web3 session loop, isolate Assets by authenticated identity, and connect Pulse to live evidence data.

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

## 2026-07-17 launch-bound-buy integration

- Replaced the provisional Launch follow-buy contract with `boundBuy`.
- Launch supports disabled mode or T1-T5 block-offset execution; T0 is rejected with `T0_BUNDLE_UNAVAILABLE` until a reviewed bundle relay is configured.
- Launch allocation is now per-wallet equal or per-wallet custom. Random and ladder allocation were removed from the Launch execution path.
- The coordinator records the confirmed launch block, waits for the selected target block, applies a deadline window, and stores per-wallet bound-buy results.
- Safe retry operates only on failed bound-buy wallet entries.
- Launch UI now labels the feature 发射绑定买入, selects T1-T5, accepts a per-wallet amount, and previews the wallet-group total budget.
- Shared contract commit: `70ac3a7`.
- Execution integration commit: `fe6c3ce` (source role commit `7c26871`).
- Backend integration commit: `7152223` (source role commit `9893bb0`).
- Frontend integration commit: `0c2b44b` (source role commit `873e1ee`).
- Verification: frontend/root syntax check passed; backend 40/40; execution 37/37.
- Real execution remains disabled. No transaction or fund movement occurred.
- Remaining blocker: true T0 requires platform-specific deterministic addressing, pre-signing, and a reviewed Solana/BSC bundle relay implementation.

### T1-T5 semantics correction

- T0 is the launch block and includes the Cooking/dev buy; wallet-group buying is the subsequent T1-T5 window.
- Removed the misleading frontend selector for an exact T1, T2, T3, T4, or T5 block.
- The UI now labels the selector `T1-T5 买入钱包组` and explains that actual inclusion depends on chain conditions.
- Backend execution enters at the earliest observed block from N+1 and expires unsubmitted work after N+5; it records the actual offset for audit.
- Verification after correction: backend 40/40, execution 37/37, frontend syntax check passed.

### Equal and random T1-T5 allocation

- Launch now offers `PER_WALLET_EQUAL` and `TOTAL_RANDOM` allocation modes.
- Equal mode accepts one amount per wallet and derives the total budget.
- Random mode accepts one fixed wallet-group total and deterministically splits it into positive, unequal atomic amounts whose sum exactly matches the requested total.
- The execution ID seeds the allocation; the prepared per-wallet amounts are persisted and returned before confirmation.
- Confirmation and failed-wallet retry reuse the frozen allocation and never randomize a second time.
- ForgeX reference note: ForgeX launch accepts explicit per-wallet sniper amounts (or defaults each to 0.01); its unrelated robot random mode does not preserve a fixed group total, so NarraOps uses its own auditable fixed-total behavior.
- Verification: backend 40/40, execution 38/38, frontend syntax check passed.

## 2026-07-22 public Beta and language foundation

- Preserved the existing dirty integration worktree; no prior wallet, transfer, execution, product-pivot, or research changes were discarded.
- Added buildable frontend/backend Docker definitions, container health checks, persistent data volume wiring, an ingress health endpoint, and public-Beta deployment/rollback guidance.
- Deployment configuration forces `REAL_EXECUTION_ENABLED=false` for the public Beta.
- Added the first cross-language contracts for narrative evidence, Pulse opportunity cards, and Go launch-ready plans.
- Added strict shared TypeScript types plus a minimal `tsconfig` and `npm run typecheck`; existing JS/MJS behavior remains unchanged.
- Added `coordination/PUBLIC_BETA_CHECKLIST.md` for product, safety, operations, and Build in Public acceptance.
- Verification: root syntax check passed; shared TypeScript check passed; backend API 48/48; execution 43/43; JSON schemas parse successfully.
- Docker runtime verification is still pending because Docker is not installed in the current Windows environment.
- External deployment remains pending a selected host, public domain/origin, TLS, secret configuration, monitoring destination, and rollback target.
