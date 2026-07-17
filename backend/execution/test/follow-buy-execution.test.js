import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { BatchFollowBuyExecutor } from "../batch-follow-buy-executor.js";
import { resolveBoundBuyAmounts } from "../batch-follow-buy-executor.js";
import { sealWalletSecret } from "../encrypted-wallet-vault.js";

test("one approved password executes an equal Four.Meme launch-bound-buy batch", async () => {
  const password = "test-password-at-least-16-characters";
  const entries = [];
  for (let index = 0; index < 2; index += 1) { const wallet = Wallet.createRandom(); entries.push({ walletId: `w${index}`, walletReferenceId: `w${index}:evm`, publicAddress: wallet.address, envelope: sealWalletSecret({ walletReferenceId: `w${index}:evm`, publicAddress: wallet.address, privateKey: wallet.privateKey, password }) }); }
  const executor = new BatchFollowBuyExecutor({
    walletRepository: { getEncryptedWallet: async (id) => entries.find(({ walletReferenceId }) => walletReferenceId === id).envelope },
    fourMemePlanner: { buildBuy: async ({ userAddress, fundsWei }) => ({ from: userAddress, chainId: 56, to: "0x3333333333333333333333333333333333333333", value: fundsWei, data: "0x" }) },
    evmAdapter: { signTransaction: async ({ transaction }) => JSON.stringify(transaction), broadcastTransaction: async ({ signedTransaction }) => `hash-${JSON.parse(signedTransaction).value}` },
  });
  const result = await executor.execute({ platform: "fourmeme", tokenAddress: "0x2222222222222222222222222222222222222222", wallets: entries, allocation: { mode: "PER_WALLET_EQUAL", amountPerWalletAtomic: "50" }, password });
  assert.deepEqual(result.map(({ amountAtomic }) => amountAtomic), ["50", "50"]);
  assert.deepEqual(result.map(({ transactionHash }) => transactionHash), ["hash-50", "hash-50"]);
});

test("custom allocation requires exactly one positive amount per wallet", () => {
  const wallets = [{ walletId: "w1" }, { walletId: "w2" }];
  assert.deepEqual(resolveBoundBuyAmounts({ wallets, allocation: { mode: "PER_WALLET_CUSTOM", customAmountsAtomic: [{ walletId: "w1", amountAtomic: "40" }, { walletId: "w2", amountAtomic: "60" }] } }), [40n, 60n]);
  assert.throws(() => resolveBoundBuyAmounts({ wallets, allocation: { mode: "PER_WALLET_CUSTOM", customAmountsAtomic: [{ walletId: "w1", amountAtomic: "100" }] } }), { code: "BOUND_BUY_WALLET_MISMATCH" });
});
