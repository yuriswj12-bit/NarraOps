# Chain execution role rules

Own execution contracts, policy validation, durable idempotency design, signer isolation, chain adapters, transaction submission, confirmation reconciliation, audit events, and execution timing.

Never add a production private key to the repository, environment examples, logs, fixtures, or general database fields. Real submission must remain off until the production-readiness gates in `coordination/DECISIONS.md` are satisfied.

An execution may report `submitted` only after the chain or provider accepted it and a transaction hash is recorded. Confirmation comes from reconciliation using chain-specific finality rules.

All tests must use mocks, fixtures, or planning mode and must not move real funds.

