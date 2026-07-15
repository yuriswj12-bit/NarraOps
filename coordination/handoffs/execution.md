# Execution handoff

Implemented on `feat/execution-integration`:

- Platform-neutral request/result contracts and status vocabulary.
- Validation and planning-only execution service.
- Payload-bound idempotency behavior with conflict detection.
- Redacting in-memory audit prototype.
- Nginx and Docker deployment skeleton.

Not production-ready:

- In-memory stores are process-local and are unsafe for multi-instance or crash recovery.
- No KMS/HSM signer, approval policy, adapter, nonce manager, transaction broadcaster, confirmation reconciler, retry worker, or treasury ledger exists.
- Real execution deliberately throws and cannot submit funds.

