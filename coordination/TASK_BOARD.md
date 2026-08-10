# Current task board

This board contains only work that is still useful after checking current code.
`coordination/CURRENT_TASK.md` is the source for the active local work.

| Area | Task | Status |
|---|---|---|
| Product | Keep first-level product surfaces to Go / Pulse / Assets | Done |
| Frontend | Consume relative `/api/v1` Go, Pulse, Assets, auth, launch, and Swap APIs | Done |
| Agent | Use live LLM/read providers and expose provider gaps instead of production mocks | Done |
| Agent | Persist actor-scoped tasks/events and support status polling, cancellation, replay, and recovery | Done |
| Auth/Assets | Web3 sessions, actor-owned wallet groups, encrypted provisioning/export, and transfer flows | Done |
| Launch | Direct Pump prepare, browser sign, validation, submit, confirmation, and reconciliation path | Done |
| Swap | Jupiter transaction preparation plus Assets wallet/browser signature and direct submission | Done |
| Deployment | Preserve Vercel `/api/v1/*` catch-all and generated Runtime/launch-planner bundles | Done |
| Agent v2 | Preserve and finish the uncommitted Runtime/contracts/migrations 023–043 integration | In progress |
| Agent v2 | Observe production Pump semantic shadow and approval dual-run with enforcement off | In progress |
| Frontend | Finish and verify current uncommitted Go/Assets reliability and simplified UI changes | In progress |
| Coordination | Keep OpenCode `/resume`, `/handoff`, and compact current-state documents accurate | Done |
| Agent v2 | Test signed Pump enforcement through an injected no-broadcast provider harness | Done |
| Agent control plane | Persist versioned Agent/Skill catalog and actor-bound Memory behind service-role-only RPCs | Done |
| Agent control plane | Deploy self-cleaning Supabase canaries for catalog, confirmation, forget, enum parity, and global memory | Done |
| Agent control plane | Publish reviewed `narraops-agent@1` catalog and canary-enable optional Runtime knowledge | Done |
| Agent control plane | Add feature-flagged authenticated Memory propose/confirm/list/forget APIs | Done |
| Agent control plane | Route conversation and structured launch content through Agent-version Model Policy | Done |
| Agent control plane | Route Pulse narrative reads through `pulse.narratives.list@1.0.0` Tool Registry contract | Done |
| Agent control plane | Publish Agent/market Skill v2 and route filtered GMGN reads through immutable Tool v2 | Done |
| Agent control plane | Route public narrative/launch-source reads through `research.public_link.read@1.0.0` | Done |
| Agent control plane | Route actor-owned trade-plan wallet selection through `assets.wallet_groups.list@1.0.0` | Done |
| Agent control plane | Add Go settings/UI for reviewing and deleting Memory | Done |
| Frontend | Restore real Go conversation helpers excluded by legacy fixture comment | Done |
| Agent v2 | Prove wallet-signed reservation concurrency/idempotency against Supabase with zero broadcasts | Done |
| Agent v2 | Preserve legacy Pump response fields and display unknown chain outcomes without false success | Done |
| Agent v2 | Define fixed-schema `launch.pump.broadcast@1.0.0` with consumed-approval/recent-auth gate and no signed bytes | Done (local/shadow only) |
| Agent v2 | Define fixed-schema `swap.solana.broadcast@1.0.0` with consumed-approval/recent-auth gate and no signed bytes | Done (local only, unpublished) |
| Agent v2 | Define fixed-schema `assets.transfer.broadcast@1.0.0` with consumed-approval/recent-auth gate and no signed bytes | Done (local only, unpublished) |
| Agent control plane | Expose safe public Agent/Skill capability discovery without instructions, internal IDs, Memory, or execution credentials | Done |
| Agent v2 | Enable Pump enforcement only after harness, canary, rollback, and parity gates pass | Blocked by explicit authorized rollout; enforcement remains off |
| Execution | Move launch/Swap/Transfer authority into the provider-neutral Tool/Execution Gateway | Blocked by explicit authorized rollout; rollout plan drafted in `docs/engineering/financial-gateway-rollout.md`, contracts local and unpublished |
| Pulse | Improve real source coverage and history while preserving sampled/partial labels | Pending |
| QA | Full dirty-tree verification: API 133/133, execution 35/35, typecheck, 28 schemas, Vercel build, migration parity and 13-check production canary | Done |
