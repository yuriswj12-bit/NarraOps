# NarraOps engineering roadmap

## Foundation

- [x] Versioned Agent API skeleton and tests
- [x] Planning-only execution core and tests
- [x] Shared OpenAPI execution and Agent contract
- [x] Deployment routing skeleton
- [x] Independent worktrees and role rules
- [ ] Frontend API client using relative `/api/v1`
- [ ] Persisted Agent task repository
- [ ] Authentication and authorization model

## Product loop

- [ ] Narrative source adapters with provenance
- [ ] Narrative generation and scoring workflow
- [ ] Launch package review and approval flow
- [ ] Agent task progress UI over SSE
- [ ] Wallet-group execution planning UI
- [ ] Transaction and audit record UI

## Production execution gates

- [ ] Durable idempotency and execution state machine
- [ ] Isolated signer using an approved KMS/HSM or custody design
- [ ] Chain-specific adapters and nonce/blockhash strategy
- [ ] Submission and finality reconciliation workers
- [ ] Immutable audit and treasury separation
- [ ] Threat model, load tests, failure drills, and security review

## Public launch

- [ ] Production frontend build and asset pipeline
- [ ] Database, backups, rate limiting, monitoring, and alerts
- [ ] Domain, HTTPS, CDN, gateway, and rollback process
- [ ] Legal, privacy, risk disclosures, and incident response

