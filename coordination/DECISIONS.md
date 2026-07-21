# Decisions

1. `shared/openapi.yaml` and `shared/schemas/` are the contract source of truth.
2. Frontend uses relative `/api/v1` paths; local ports are infrastructure details.
3. `submitted` means a chain/provider accepted a transaction and a tx hash is recorded. It never means confirmed.
4. Real execution is disabled until durable idempotency, policy, signer isolation, and confirmation reconciliation exist.
5. Private keys never enter browser code, logs, Git, general database fields, or ordinary API payloads.
6. Wallet groups and platform treasury use separate identities, policies, and accounting.
7. Decimal monetary values cross API boundaries as strings, avoiding floating-point loss.

