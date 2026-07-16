import test from "node:test";
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { BatchFollowBuyExecutor } from "../batch-follow-buy-executor.js";
import { allocateFollowBuyAmounts } from "../batch-follow-buy-executor.js";
import { sealWalletSecret } from "../encrypted-wallet-vault.js";

test("one approved password executes an equal Four.Meme follow-buy batch", async () => {
  const password = "test-password-at-least-16-characters";
  const entries = [];
  for (let index = 0; index < 2; index += 1) { const wallet = Wallet.createRandom(); entries.push({ walletId: `w${index}`, walletReferenceId: `w${index}:evm`, publicAddress: wallet.address, envelope: sealWalletSecret({ walletReferenceId: `w${index}:evm`, publicAddress: wallet.address, privateKey: wallet.privateKey, password }) }); }
  const executor = new BatchFollowBuyExecutor({
    walletRepository: { getEncryptedWallet: async (id) => entries.find(({ walletReferenceId }) => walletReferenceId === id).envelope },
    fourMemePlanner: { buildBuy: async ({ userAddress, fundsWei }) => ({ from: userAddress, chainId: 56, to: "0x3333333333333333333333333333333333333333", value: fundsWei, data: "0x" }) },
    evmAdapter: { signTransaction: async ({ transaction }) => JSON.stringify(transaction), broadcastTransaction: async ({ signedTransaction }) => `hash-${JSON.parse(signedTransaction).value}` },
  });
  const result = await executor.execute({ platform: "fourmeme", tokenAddress: "0x2222222222222222222222222222222222222222", wallets: entries, totalAmountAtomic: "101", password });
  assert.deepEqual(result.map(({ amountAtomic }) => amountAtomic), ["51", "50"]);
  assert.deepEqual(result.map(({ transactionHash }) => transactionHash), ["hash-51", "hash-50"]);
});

test("random and ladder allocation preserve the exact total", () => {
  const random = allocateFollowBuyAmounts({ totalAmountAtomic: "10000000000", walletCount: 20, mode: "random", seed: "execution-1" });
  const repeated = allocateFollowBuyAmounts({ totalAmountAtomic: "10000000000", walletCount: 20, mode: "random", seed: "execution-1" });
  const ladder = allocateFollowBuyAmounts({ totalAmountAtomic: "10000000000", walletCount: 20, mode: "ladder" });
  assert.equal(random.reduce((sum, value) => sum + value, 0n), 10000000000n);
  assert.deepEqual(random, repeated);
  assert.ok(new Set(random.map(String)).size > 10);
  assert.equal(ladder.reduce((sum, value) => sum + value, 0n), 10000000000n);
  assert.ok(ladder.every((value, index) => index === 0 || value >= ladder[index - 1]));
});
