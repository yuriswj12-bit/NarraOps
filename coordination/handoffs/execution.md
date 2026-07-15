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
- Added an atomic JSON encrypted-wallet repository that persists only authenticated ciphertext envelopes, never plaintext keys or passwords.
- Added a Robinhood Chain EVM adapter using `ethers`: validates signer address and chain ID, obtains pending nonce/gas price/gas estimate over JSON-RPC, applies a gas buffer, signs legacy EIP-155 transactions locally, and rejects broadcasting unless the explicit production execution switch is enabled.
- Pinned the transitive `ws` dependency to a patched release after npm audit identified vulnerabilities in the version bundled by ethers; dependency install then reported zero vulnerabilities.
- Verification: 22/22 execution tests pass, including persistent ciphertext checks and signed-transaction decoding; broadcast remains disabled in tests and product defaults.

Not production-ready:

- In-memory stores are process-local and are unsafe for multi-instance or crash recovery.
- No production key-service isolation, multi-process nonce reservation, enabled transaction broadcaster, retry worker, or treasury ledger exists.
- Real execution deliberately throws and cannot submit funds.
- Pons post-launch buying still requires a reviewed public on-chain Router path or an official Pons transaction builder; the launch transaction itself is already independent of this blocker.
- Simulation inputs are internal execution-layer contracts only; API/OpenAPI exposure remains for the backend and integration owners because this role cannot modify `shared/` or `backend/api/`.

