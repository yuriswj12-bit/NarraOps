import { openWalletSecret } from "./encrypted-wallet-vault.js";
import { ExecutionError } from "./errors.js";
import { createHash } from "node:crypto";

function allocateFixedTotalRandom({ totalAmountAtomic, walletCount, seed }) {
  const total = BigInt(totalAmountAtomic); const count = Number(walletCount);
  if (!Number.isInteger(count) || count < 1 || total < BigInt(count)) throw new ExecutionError("BOUND_BUY_TOTAL_TOO_SMALL", "Random bound-buy total must allocate at least one atomic unit per wallet");
  const weights = Array.from({ length: count }, (_, index) => BigInt(`0x${createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0, 16)}`) + 1n);
  const distributable = total - BigInt(count); const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  const amounts = weights.map((weight) => 1n + (distributable * weight) / weightTotal);
  let remainder = total - amounts.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % count, remainder -= 1n) amounts[index] += 1n;
  return amounts;
}

export function resolveBoundBuyAmounts({ wallets, allocation }) {
  if (!Array.isArray(wallets) || !wallets.length) throw new ExecutionError("BOUND_BUY_WALLETS_REQUIRED", "Launch-bound-buy wallet group is empty");
  if (allocation?.mode === "PER_WALLET_EQUAL") {
    const amount = BigInt(allocation.amountPerWalletAtomic || 0);
    if (amount <= 0n) throw new ExecutionError("BOUND_BUY_AMOUNT_INVALID", "Per-wallet bound-buy amount must be positive");
    return wallets.map(() => amount);
  }
  if (allocation?.mode === "PER_WALLET_CUSTOM") {
    const entries = new Map((allocation.customAmountsAtomic || []).map(({ walletId, amountAtomic }) => [walletId, BigInt(amountAtomic)]));
    if (entries.size !== wallets.length || wallets.some(({ walletId }) => !entries.has(walletId))) throw new ExecutionError("BOUND_BUY_WALLET_MISMATCH", "Custom bound-buy amounts must contain exactly one entry for every selected wallet");
    const amounts = wallets.map(({ walletId }) => entries.get(walletId));
    if (amounts.some((amount) => amount <= 0n)) throw new ExecutionError("BOUND_BUY_AMOUNT_INVALID", "Every custom bound-buy amount must be positive");
    return amounts;
  }
  if (allocation?.mode === "TOTAL_RANDOM") return allocateFixedTotalRandom({ totalAmountAtomic: allocation.totalAmountAtomic, walletCount: wallets.length, seed: allocation.seed });
  throw new ExecutionError("BOUND_BUY_ALLOCATION_INVALID", "Bound-buy allocation must be PER_WALLET_EQUAL, PER_WALLET_CUSTOM, or TOTAL_RANDOM");
}

export class BatchFollowBuyExecutor {
  constructor({ walletRepository, pumpPlanner, fourMemePlanner, solanaAdapter, evmAdapter }) {
    Object.assign(this, { walletRepository, pumpPlanner, fourMemePlanner, solanaAdapter, evmAdapter });
  }

  prepareAllocation({ wallets, allocation }) {
    return resolveBoundBuyAmounts({ wallets, allocation }).map((amount, index) => ({ walletId: wallets[index].walletId, amountAtomic: amount.toString() }));
  }

  async execute({ platform, tokenAddress, wallets, allocation, password, slippageBps = 500 }) {
    const amounts = resolveBoundBuyAmounts({ wallets, allocation });
    const results = [];
    for (let index = 0; index < wallets.length; index += 1) {
      const wallet = wallets[index]; const envelope = await this.walletRepository.getEncryptedWallet(wallet.walletReferenceId);
      if (!envelope) { results.push({ walletId: wallet.walletId, status: "failed", errorCode: "WALLET_NOT_FOUND", amountAtomic: amounts[index].toString() }); continue; }
      const privateKey = openWalletSecret(envelope, password);
      try {
        if (platform === "pump") {
          const plan = await this.pumpPlanner.buildBuy({ mintAddress: tokenAddress, userAddress: wallet.publicAddress, quoteLamports: amounts[index].toString(), slippageBps });
          const signedTransactionBase64 = this.solanaAdapter.signTransaction({ transactionBase64: plan.transactionBase64, privateKey });
          const transactionHash = await this.solanaAdapter.broadcastTransaction({ signedTransactionBase64 });
          results.push({ walletId: wallet.walletId, status: "submitted", transactionHash, amountAtomic: amounts[index].toString() });
        } else {
          const plan = await this.fourMemePlanner.buildBuy({ tokenAddress, userAddress: wallet.publicAddress, fundsWei: amounts[index].toString(), slippageBps });
          const signedTransaction = await this.evmAdapter.signTransaction({ transaction: plan, privateKey });
          const transactionHash = await this.evmAdapter.broadcastTransaction({ signedTransaction });
          results.push({ walletId: wallet.walletId, status: "submitted", transactionHash, amountAtomic: amounts[index].toString() });
        }
      } catch (error) {
        results.push({ walletId: wallet.walletId, status: "failed", errorCode: error.code || "FOLLOW_BUY_FAILED", amountAtomic: amounts[index].toString() });
      } finally { privateKey.fill(0); }
    }
    return results;
  }
}
