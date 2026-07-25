// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { EncryptedBatchWalletSigner, OneTimeApprovalStore, digestBatch } from "../batch-wallet-signer.ts";
import { openWalletSecret, sealWalletSecret } from "../encrypted-wallet-vault.ts";

const contract = "0x1111111111111111111111111111111111111111";
const wallet = "0x2222222222222222222222222222222222222222";
const txHash = `0x${"a".repeat(64)}`;

function transaction(overrides = {}) {
  return { walletReferenceId: "wallet-1", chainId: 4663, from: wallet, to: contract, value: "10", data: "0x1234", ...overrides };
}

test("wallet secrets use authenticated encryption and reject the wrong password", () => {
  const envelope = sealWalletSecret({ walletReferenceId: "wallet-1", publicAddress: wallet, privateKey: "test-private-key", password: "correct horse battery staple" });
  assert.equal(openWalletSecret(envelope, "correct horse battery staple").toString(), "test-private-key");
  assert.throws(() => openWalletSecret(envelope, "wrong"), { code: "WALLET_UNLOCK_FAILED" });
  assert.doesNotMatch(JSON.stringify(envelope), /test-private-key/);
});

test("one approval unlocks a complete wallet batch without per-wallet prompts", async () => {
  const encrypted = sealWalletSecret({ walletReferenceId: "wallet-1", publicAddress: wallet, privateKey: "test-private-key", password: "password" });
  const approvalStore = new OneTimeApprovalStore();
  const transactions = [transaction()];
  const confirmationToken = approvalStore.issue({ executionId: "exec-1", transactionDigest: digestBatch(transactions), password: "password" });
  let signedKey;
  const signer = new EncryptedBatchWalletSigner({
    walletRepository: { getEncryptedWallet: async () => encrypted },
    approvalStore,
    policy: { chainId: 4663, allowedContracts: [contract], maxTransactionValueWei: "100", maxBatchValueWei: "100", maxWallets: 10 },
    transactionAdapter: {
      signTransaction: async ({ privateKey }) => { signedKey = privateKey.toString(); return "0xsigned"; },
      broadcastTransaction: async () => txHash,
    },
  });

  const result = await signer.signAndBroadcastBatch({ executionId: "exec-1", confirmationToken, transactions });
  assert.equal(signedKey, "test-private-key");
  assert.deepEqual(result, [{ walletReferenceId: "wallet-1", transactionHash: txHash }]);
  await assert.rejects(() => signer.signAndBroadcastBatch({ executionId: "exec-1", confirmationToken, transactions }), { code: "APPROVAL_REQUIRED" });
});

test("policy rejects unapproved contracts before decrypting wallets", async () => {
  let repositoryCalls = 0;
  const signer = new EncryptedBatchWalletSigner({
    walletRepository: { getEncryptedWallet: async () => { repositoryCalls += 1; } },
    approvalStore: new OneTimeApprovalStore(),
    policy: { chainId: 4663, allowedContracts: [contract], maxTransactionValueWei: "100", maxBatchValueWei: "100" },
    transactionAdapter: {},
  });
  await assert.rejects(() => signer.signAndBroadcastBatch({ executionId: "exec", transactions: [transaction({ to: wallet })] }), { code: "BATCH_POLICY_REJECTED" });
  assert.equal(repositoryCalls, 0);
});
