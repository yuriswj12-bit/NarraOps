# Backend handoff

- Mount the contract at `/api/v1`; do not rename execution fields without updating OpenAPI and JSON Schemas first.
- Enforce equality between the `Idempotency-Key` header and body `idempotencyKey`.
- Replace the in-memory idempotency store with a durable unique constraint and transaction/lock before enabling submission.
- Persist state transitions and immutable audit events. A submitted transaction requires txHash, chain, fromAddress, and submittedAt.
- Confirmation must come from chain reconciliation with finality rules; API submission response is not confirmation.
- Keep secret material in an isolated signer. Backend passes intent and policy context, never raw keys.

