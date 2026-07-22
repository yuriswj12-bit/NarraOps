# Decisions

1. `shared/openapi.yaml` and `shared/schemas/` are the contract source of truth.
2. Frontend uses relative `/api/v1` paths; local ports are infrastructure details.
3. `submitted` means a chain/provider accepted a transaction and a tx hash is recorded. It never means confirmed.
4. Real execution is disabled until durable idempotency, policy, signer isolation, and confirmation reconciliation exist.
5. Private keys never enter browser code, logs, Git, general database fields, or ordinary API payloads.
6. Wallet groups and platform treasury use separate identities, policies, and accounting.
7. Decimal monetary values cross API boundaries as strings, avoiding floating-point loss.
8. As of 2026-07-22, first-level product surfaces are `Go / Pulse / Assets`. Launch remains a Go-callable backend capability, and Invite is removed from the current product surface.
9. The product narrative is AI-native narrative discovery and meme operations, not a launchpad, K-line terminal, or profit-guarantee product.
10. The long-term codebase direction is TypeScript for product/API boundaries, Python for Pulse data and AI evidence work, SQL/Supabase for durable state, and OpenAPI/JSON Schema for cross-language contracts.
11. Pulse performs proactive discovery. User-submitted links and media belong to Go and are not a Pulse discovery source.
12. Pulse scoring and historical matching must be derived from stratified success and failure samples, with only pre-launch observable features used for comparison.
13. SaaS subscription is the primary commercial hypothesis; experienced Meme Devs are the first paid-user segment to validate.
14. Short narrative explanations may follow the information-density pattern demonstrated by Bitget Wallet, while NarraOps operates before token launch and must show original evidence and uncertainty.
15. NarraOps does not use a separate early-stage product narrative. Use current product state, current product boundary, and production readiness instead.

