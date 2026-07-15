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

Not production-ready:

- In-memory stores are process-local and are unsafe for multi-instance or crash recovery.
- No KMS/HSM signer, approval policy, adapter, nonce manager, transaction broadcaster, confirmation reconciler, retry worker, or treasury ledger exists.
- Real execution deliberately throws and cannot submit funds.
- Simulation inputs are internal execution-layer contracts only; API/OpenAPI exposure remains for the backend and integration owners because this role cannot modify `shared/` or `backend/api/`.

