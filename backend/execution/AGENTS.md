# Chain execution role rules

Own execution contracts, policy validation, durable idempotency design, signer isolation, chain adapters, transaction submission, confirmation reconciliation, audit events, and execution timing.

Never add a production private key to the repository, environment examples, logs, fixtures, or general database fields. Production uses the configured custody and chain providers; the execution boundary still requires explicit user confirmation, while tests inject provider doubles instead of using production credentials.

An execution may report `submitted` only after the chain or provider accepted it and a transaction hash is recorded. Confirmation comes from reconciliation using chain-specific finality rules.

Tests must never move real funds; provider doubles, fixtures, and deterministic reconciliation responses are required for automated tests.

