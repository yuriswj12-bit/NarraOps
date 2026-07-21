import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import { sealWalletSecret } from "../encrypted-wallet-vault.js";
import { LaunchSigningService } from "../launch-signing-service.js";
import { SolanaTransactionAdapter } from "../solana-transaction-adapter.js";

test("signs a Pump launch with the encrypted Cooking wallet and broadcasts once", async () => {
  const cooking = Keypair.generate();
  const mint = Keypair.generate();
  const instruction = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: cooking.publicKey, isSigner: true, isWritable: true }, { pubkey: mint.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(0) });
  const transaction = new Transaction({ feePayer: cooking.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(instruction);
  transaction.partialSign(mint);
  const envelope = sealWalletSecret({ walletReferenceId: "cook:solana", publicAddress: cooking.publicKey.toBase58(), privateKey: Buffer.from(cooking.secretKey).toString("base64"), password: "test-password-at-least-16-characters" });
  const solanaAdapter = new SolanaTransactionAdapter({ connection: { sendRawTransaction: async () => "solana-signature" }, executionEnabled: true });
  const service = new LaunchSigningService({ walletRepository: { getEncryptedWallet: async () => envelope }, solanaAdapter });
  const result = await service.signAndBroadcast({ platform: "pump", walletReferenceId: "cook:solana", password: "test-password-at-least-16-characters", plan: { transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), mintAddress: mint.publicKey.toBase58() } });
  assert.equal(result.status, "submitted");
  assert.equal(result.transactionHash, "solana-signature");
});

test("real Solana broadcast remains disabled by default", async () => {
  const adapter = new SolanaTransactionAdapter({ connection: { sendRawTransaction: async () => { throw new Error("must not broadcast"); } } });
  await assert.rejects(() => adapter.broadcastTransaction({ signedTransactionBase64: "AA==" }), /disabled/);
});
