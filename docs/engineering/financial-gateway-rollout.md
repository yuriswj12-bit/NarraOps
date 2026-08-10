# Financial Execution Gateway Rollout Plan

Status: proposal for review. No production authority is switched by this
document.

## Goal

Move production fund-execution authority from the existing direct Pump/Swap/
Transfer handlers to the provider-neutral Runtime Tool/Execution Gateway, one
operation at a time, as independently reversible rollouts. Until a rollout
reaches the enabled step, the existing direct path remains production
authority.

## Safety invariants (unchanged)

- `submission_pending` claims one exact signed transaction before an external
  call. `submitted` is written only after provider acceptance of the same
  signature. Unknown outcomes become `reconciliation_required` and are never
  blind-rebroadcast.
- A Tool gateway is never reached before an atomically consumed, recent-auth
  approval whose intent digest matches the exact execution.
- Tool inputs carry only execution/approval identity, state version, semantic
  envelope digest, and an immutable transaction hash. No private keys or signed
  transaction bytes cross a Tool boundary.
- No financial Tool is registered in the published Agent manifest until its
  rollout is authorized.

## Operation inventory

| Tool | Version | Gateway interface | Approval | Permissions |
|---|---|---|---|---|
| `launch.pump.broadcast` | 1.0.0 | `submitReservedLaunch` | explicit_and_recent_auth | `launch:execute` |
| `swap.solana.broadcast` | 1.0.0 | `submitReservedSwap` | explicit_and_recent_auth | `swap:execute` |
| `assets.transfer.broadcast` | 1.0.0 | `submitReservedTransfer` | explicit_and_recent_auth | `assets:transfer` |

All three are local/unpublished, no-network tested, and require consumed
approval + recent auth. Retry policy is `none`; timeouts reconcile by txHash.

## Rollout steps (per operation)

Each operation follows the same four steps. Flags are independent per
operation, and are never the Pump enforcement flag.

### Step 1: Shadow authority (off, observe)

- Register the Tool in a shadow Agent manifest only.
- Keep the direct path as authority. Gateway submissions are never invoked;
  only the guard checks run (approval present, digest match, envelope bound,
  `submission_pending` claim) and are recorded as shadow observations.
- Exit condition: shadow pass rate and latency match the direct path for the
  observation window; no guard false-positives.

### Step 2: Canary authority (flag, small share)

- Enable `AGENT_<OP>_GATEWAY_AUTHORITY_ENABLED` for a bounded share of
  eligible requests (feature flag with percentage or wallet allowlist).
- Every gateway submission writes `submission_pending` before the external call
  and records the provider-accepted signature.
- Exit condition: zero blind-rebroadcasts, no state-version conflicts,
  `submitted`/`confirmed`/`reconciliation_required` counts match the direct
  path on the canary subset, and no funds are stranded.

### Step 3: Full authority

- Flip the operation's authority flag to full. The direct handler for that
  operation is bypassed; the gateway is the only broadcast path.
- Reconciliation and audit remain enabled for replay of unknown outcomes.
- Exit condition: stable success and failure rates for the observation window.

### Step 4: Hard rollback (always available)

- Set the authority flag off. The direct handler resumes immediately.
- Any `submission_pending`/`submitted`/`reconciliation_required` rows are
  reconciled by txHash before the flag returns to off; nothing is rebroadcast.
- Deploy rollback is a single config flip plus a verified redeploy if code
  changed, not a data migration.

## Ordering

1. `assets.transfer.broadcast` first (lowest blast radius, single asset move,
   existing preview/confirm flow).
2. `swap.solana.broadcast` second (Jupiter-built transaction already prepared
   and signed by the Assets wallet).
3. `launch.pump.broadcast` last (highest blast radius; requires the signed
   Pump path that already has the no-broadcast harness).

## Observation metrics

- Per operation: gateway submissions, `submission_pending` claims,
  `submitted`, `confirmed`, `reconciliation_required`, `failed`, latency.
- Guard failures by code (`FINANCIAL_APPROVAL_*`, `FINANCIAL_ADAPTER_*`).
- Legacy-response parity: direct-path and gateway responses for the same
  request are compared; any field regression is a rollback trigger.
- No automatic retry events.

## Rollback triggers

- Any blind rebroadcast observed.
- `submitted` written without provider acceptance of the same signature.
- Unexpected `reconciliation_required` rate above threshold.
- Legacy-response parity regression.
- Signer isolation or audit gaps discovered during observation.

## Red lines

- Never enable Pump enforcement or gateway authority for real funds during
  tests or canaries.
- Never perform a real-fund transaction as part of automation.
- Keep `AGENT_PUMP_ENFORCEMENT_ENABLED` and per-operation authority flags off
  until each rollout is explicitly authorized.
- Do not combine multiple operations into one rollout.
