// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { WalletExportService } from "../wallet-export-service.ts";
import { WalletProvisioningService } from "../wallet-provisioning-service.ts";

test("exports an in-memory text artifact with matching addresses and base58 Solana private keys", async () => {
  const password = "test-password-at-least-16-characters";
  const envelopes = new Map();
  const repository = {
    putEncryptedWallet: async (envelope) => envelopes.set(envelope.walletReferenceId, envelope),
    getEncryptedWallet: async (referenceId) => envelopes.get(referenceId),
  };
  const wallet = await new WalletProvisioningService({ walletRepository: repository, password }).provision({ walletId: "wallet-1", network: "solana" });
  const result = await new WalletExportService({ walletRepository: repository, password }).exportText(
    { name: "Test group", network: "solana" },
    [{ label: "Wallet 1", addresses: wallet.addresses, signerReferences: wallet.signerReferences }],
  );
  assert.match(result.fileName, /^Test group-solana-/);
  assert.match(result.content, new RegExp(wallet.addresses.solana));
  assert.match(result.content, /Solana 私钥: [1-9A-HJ-NP-Za-km-z]{80,100}/);
  assert.doesNotMatch(result.content, /\[\d+(?:,\d+){63}\]/);
  assert.equal(result.walletCount, 1);
});
