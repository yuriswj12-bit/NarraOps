# Financial Gateway Real-Transfer Test Plan

Status: execution plan for small-value live testing. Authorized by the user.
Real funds move only in the explicit test steps below.

## Goal

Prove the Provider-neutral Execution Gateway for `assets.transfer`,
`swap.solana`, and `launch.pump` against real Solana with small amounts, then
switch production authority behind the gateway step by step. Each operation is
independently reversible via its flag.

## Wallet and funding requirements

- A production Assets wallet group with Solana custody wallets (encrypted
  vault). Create it in the UI, then provision wallets.
- Fund the group with a small SOL amount (start 0.05 SOL, keep under 1 SOL for
  the whole test session).
- For Swap: also need the Assets wallet to hold the token being sold (e.g. a
  small amount of a common mint) and the login/browser wallet connected.
- For Pump: need a cooking wallet group with SOL.

## Flag matrix (production)

| Operation | Shadow | Enforcement | Gateway authority |
|---|---|---|---|
| Transfer | `AGENT_TRANSFER_SEMANTIC_SHADOW_ENABLED` | `AGENT_TRANSFER_ENFORCEMENT_ENABLED` | `AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED` |
| Swap | `AGENT_SWAP_SEMANTIC_SHADOW_ENABLED` | `AGENT_SWAP_ENFORCEMENT_ENABLED` | `AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED` |
| Pump | `AGENT_PUMP_SEMANTIC_SHADOW_ENABLED` | `AGENT_PUMP_ENFORCEMENT_ENABLED` | `AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED` |

Current production state: all shadow flags `true`, all enforcement and gateway
flags `false`. Direct path is authority everywhere.

## Step 1: Transfer real-value test (start here)

1. Create/provision a production Assets wallet group; fund with ~0.05 SOL.
2. Create a destination: either a second wallet group or an external address
   owned by the tester.
3. `POST /api/v1/transfers/preview` (authenticated) -> capture previewToken +
   confirmationToken + allocations.
4. Enable enforcement: `AGENT_TRANSFER_ENFORCEMENT_ENABLED=true`,
   `AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED=true`, redeploy.
5. `POST /api/v1/transfers` with previewToken, confirmationToken,
   idempotencyKey, amount ~0.001 SOL.
6. Assert response status is `submitted` or `confirmed`, txHash present, and
   Supabase `asset_transfers` row exists. Verify on-chain via Solscan.
7. If status is `reconciliation_required`, reconcile by txHash; do not
   rebroadcast.
8. Rollback: set enforcement + gateway back to `false`, redeploy. Confirm a
   second transfer goes through the direct path (status confirmed).

Pass criteria:
- One `submission_pending` claim before broadcast; `submitted` only after
  provider acceptance; no blind rebroadcast; no double spend.

## Step 2: Swap real-value test

1. Prepare a Jupiter quote via the existing direct Swap prepare path.
2. Enable `AGENT_SWAP_ENFORCEMENT_ENABLED=true` and
   `AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED=true`, redeploy.
3. Sign with the Assets wallet in the browser and submit.
4. Assert `go.swap_execution.v1` response, txHash, and Runtime execution row.
5. Rollback by clearing the flags.

## Step 3: Pump real-value test (highest blast radius, last)

1. Prepare a Pump launch draft; enable `AGENT_PUMP_ENFORCEMENT_ENABLED=true`
   and `AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED=true`, redeploy.
2. Sign with the cooking wallet and submit.
3. Assert launch receipt with mint/txHash and Runtime execution row.
4. Rollback by clearing the flags.

## Rollback (always available, single flag flip)

- Set the operation's enforcement and gateway flags to `false`, redeploy. The
  direct handler resumes immediately.
- Any `submission_pending`/`submitted`/`reconciliation_required` rows are
  reconciled by txHash before switching back; nothing is rebroadcast.

## Red lines

- Never rebroadcast an unknown submission.
- `submitted` is not `confirmed`; only on-chain finality is confirmed.
- Keep test amounts small and bounded for the whole session.
- Do not enable more than one operation's enforcement at a time.
