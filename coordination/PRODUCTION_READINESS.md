# NarraOps production readiness

Status: active implementation plan. Mock behavior remains explicitly labeled until its production gate is complete.

## Local implementation track

- `/api/v1` and SSE frontend integration.
- Authentication middleware, actor scoping, authorization tests, and session policy.
- PostgreSQL repositories, migrations, durable idempotency, task storage, and audit storage.
- Queue workers, retries, reconciliation, and recovery state machines.
- Isolated signer interface, policy approval, transaction simulation, and secret redaction.
- Solana/BSC adapters, mocked RPC tests, confirmation/finality logic, and ledger reconciliation.
- Deployment manifests, health checks, logs, metrics, alerts, backups, and release verification.

## Owner inputs to collect

Never place these values in Git, browser code, chat logs, or ordinary database fields.

- Production domain, DNS provider, legal/support URLs and contacts.
- Authentication provider, OAuth client IDs/secrets, callback URLs, and email/SMS provider.
- Cloud provider, region, deployment account, PostgreSQL, queue/Redis, object storage, monitoring, and alert destinations.
- Solana and BSC RPC/WebSocket providers for development, staging, and production.
- Custody provider choice: KMS, HSM, MPC, or external wallet infrastructure.
- Test signer identities; production signer ceremony, approval roles, spending limits, allowlists, and emergency-pause owners.
- Finality, fee, retry, and reconciliation policies.
- GMGN, HertzFlow/Surf, X, Telegram, TikTok, Instagram, launchpad, and analytics credentials for enabled integrations.

## Release gates

1. Every account, wallet, transfer, task, and audit route is actor-scoped and authorized.
2. Production uses no in-memory state repositories.
3. Durable unique constraints and transactions enforce idempotency.
4. Signing is isolated; raw keys never enter API or browser processes.
5. Policy approval precedes signing; broadcasting precedes submitted state.
6. Only chain reconciliation at required finality produces confirmed state.
7. Immutable audit covers intent, approval, signing, broadcast, confirmation, failure, and recovery.
8. Rate limits, CSRF/CORS/cookies, secret rotation, restore drills, observability, and incident runbooks pass review.
9. Staging end-to-end tests pass with test funds.
10. Production execution begins disabled and requires explicit reviewed enablement.
