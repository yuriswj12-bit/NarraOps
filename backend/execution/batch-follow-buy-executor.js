import { openWalletSecret } from "./encrypted-wallet-vault.js";
import { ExecutionError } from "./errors.js";
import { createHash } from "node:crypto";

function splitAmount(total, count) {
  const base = total / BigInt(count); const remainder = total % BigInt(count);
  return Array.from({ length: count }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n));
}

export function allocateFollowBuyAmounts({ totalAmountAtomic, walletCount, mode = "equal", seed = "narraops" }) {
  const total = BigInt(totalAmountAtomic); const count = Number(walletCount);
  if (!Number.isInteger(count) || count < 1 || total < BigInt(count)) throw new ExecutionError("FOLLOW_BUY_AMOUNT_TOO_SMALL", "Follow-buy total must allocate at least one atomic unit per wallet");
  if (mode === "equal") return splitAmount(total, count);
  const weights = mode === "ladder"
    ? Array.from({ length: count }, (_, index) => BigInt(index + 1))
    : mode === "random"
      ? Array.from({ length: count }, (_, index) => BigInt(`0x${createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0, 12)}`) + 1n)
      : (() => { throw new ExecutionError("FOLLOW_BUY_MODE_INVALID", "Follow-buy mode must be equal, random, or ladder"); })();
  const distributable = total - BigInt(count); const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  const amounts = weights.map((weight) => 1n + (distributable * weight) / weightTotal);
  let remainder = total - amounts.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % count, remainder -= 1n) amounts[index] += 1n;
  return amounts;
}

export class BatchFollowBuyExecutor {
  constructor({ walletRepository, pumpPlanner, fourMemePlanner, solanaAdapter, evmAdapter }) {
    Object.assign(this, { walletRepository, pumpPlanner, fourMemePlanner, solanaAdapter, evmAdapter });
  }

  async execute({ platform, tokenAddress, wallets, totalAmountAtomic, password, slippageBps = 500, distributionMode = "equal", distributionSeed = "narraops" }) {
    if (!Array.isArray(wallets) || !wallets.length) throw new ExecutionError("FOLLOW_BUY_WALLETS_REQUIRED", "Follow-buy wallet group is empty");
    const amounts = allocateFollowBuyAmounts({ totalAmountAtomic, walletCount: wallets.length, mode: distributionMode, seed: distributionSeed });
    if (amounts.some((amount) => amount <= 0n)) throw new ExecutionError("FOLLOW_BUY_AMOUNT_TOO_SMALL", "Follow-buy amount is too small for the selected wallet count");
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
