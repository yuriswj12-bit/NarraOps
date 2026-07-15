# Execution handoff

Implemented on `feat/execution-integration`:

- Platform-neutral request/result contracts and status vocabulary.
- Validation and planning-only execution service.
- Payload-bound idempotency behavior with conflict detection.
- Redacting in-memory audit prototype.
- Nginx and Docker deployment skeleton.
- Simulation-only Go action state machine for wallet group creation, transfers, withdrawals, launches, batch buys, and batch sells.
- Simulation results always declare `execution_mode`; confirmation and broadcast attempts terminate in explicit disabled states.
- Recursive secret-field rejection and simulation idempotency tests.
- Added a ForgeX-inspired encrypted wallet execution boundary: scrypt-derived AES-256-GCM envelopes, authenticated wallet identity binding, one-time batch approval, Robinhood chain/contract/value policy enforcement, automatic in-process signing for every wallet, and immediate best-effort clearing of decrypted key and password buffers.
- Wired the signer boundary to the existing `PonsFollowBuyService` contract through `signAndBroadcastBatch`; one approval covers the complete wallet group and cannot be replayed.
- Verification: execution tests pass with encrypted test-only keys and mock broadcasting; no real-fund transaction is performed.

Not production-ready:

- In-memory stores are process-local and are unsafe for multi-instance or crash recovery.
- No KMS/HSM signer, approval policy, adapter, nonce manager, transaction broadcaster, confirmation reconciler, retry worker, or treasury ledger exists.
- Real execution deliberately throws and cannot submit funds.
- The encrypted signer boundary still requires a reviewed persistent wallet repository and a concrete EVM transaction adapter before real submission can be enabled.
- Simulation inputs are internal execution-layer contracts only; API/OpenAPI exposure remains for the backend and integration owners because this role cannot modify `shared/` or `backend/api/`.

