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
- Added a no-API Pons follow-buy builder over the official Robinhood Chain Uniswap V3 deployment: reads the token's public pool configuration and launch limits, verifies the pool against the official factory, quotes through QuoterV2, applies minimum-output slippage protection, and builds payable SwapRouter02 `exactInputSingle` transactions for each wallet.
- Split Pons follow-buy into plan and approved-execution phases so the one-time wallet approval is bound to the exact quoted transaction digest and cannot be replayed.
- Read-only mainnet validation against a live Pons token returned a QuoterV2 amount and successful `eth_estimateGas` for the generated SwapRouter02 call; no signature or transaction was submitted.
- Verification: 25/25 execution tests pass after the public-router integration.
- Added Pump.fun launch planning through the official `@pump-fun/pump-sdk`: creates a fresh mint, supports `createV2` and atomic `createV2 + developer buy`, partially signs only with the ephemeral mint key, and returns a serialized transaction for the user's Solana Cooking wallet signature.
- Added Four.Meme launch planning through its official wallet-authenticated flow: nonce/login message, image upload, public BNB configuration, signed create payload, live launch/trading fee reads, and TokenManager2 `createToken` calldata for the user's BSC Cooking wallet.
- Verification: 27/27 execution tests pass. No launch transaction was broadcast.

Not production-ready:

- In-memory stores are process-local and are unsafe for multi-instance or crash recovery.
- No production key-service isolation, multi-process nonce reservation, enabled transaction broadcaster, retry worker, or treasury ledger exists.
- Real execution deliberately throws and cannot submit funds.
- Pons public on-chain follow-buy construction is implemented; production activation still requires durable plan/approval storage, nonce reservation, API mounting, and an explicit reviewed broadcast enablement.
- Pump.fun metadata still needs an IPFS/HTTPS metadata publisher. The current official Pump SDK dependency tree reports upstream npm advisories; keep it process-isolated and do not enable production submission until the vendor resolves or the affected dependency surface is replaced/reviewed.
- Four.Meme creation depends on its official wallet-authenticated web API for image upload and signed create arguments; it needs rate-limit/error monitoring but no static API key.
- Simulation inputs are internal execution-layer contracts only; API/OpenAPI exposure remains for the backend and integration owners because this role cannot modify `shared/` or `backend/api/`.

