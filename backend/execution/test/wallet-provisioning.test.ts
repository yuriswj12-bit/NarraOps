// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { openWalletSecret } from "../encrypted-wallet-vault.ts";
import { WalletProvisioningService } from "../wallet-provisioning-service.ts";

test("provisions real EVM and Solana addresses while persisting only encrypted secrets", async () => {
  const envelopes = new Map();
  const service = new WalletProvisioningService({
    password: "test-password-at-least-16-characters",
    walletRepository: { putEncryptedWallet: async (envelope) => envelopes.set(envelope.walletReferenceId, envelope) },
  });
  const wallet = await service.provision({ walletId: "wallet-1" });
  assert.match(wallet.addresses.bsc, /^0x[0-9a-fA-F]{40}$/);
  assert.match(wallet.addresses.solana, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  assert.equal(wallet.addresses.robinhood, wallet.addresses.bsc);
  assert.equal(envelopes.size, 2);
  assert.equal(JSON.stringify([...envelopes.values()]).includes("privateKey"), false);
  const evmSecret = openWalletSecret(envelopes.get("wallet-1:evm"), "test-password-at-least-16-characters").toString("utf8");
  assert.match(evmSecret, /^0x[0-9a-fA-F]{64}$/);
});

test("rejects provisioning without a strong vault password", () => {
  assert.throws(() => new WalletProvisioningService({ password: "short", walletRepository: {} }), /at least 16/);
});
