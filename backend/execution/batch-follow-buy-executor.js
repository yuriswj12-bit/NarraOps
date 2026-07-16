import { openWalletSecret } from "./encrypted-wallet-vault.js";
import { ExecutionError } from "./errors.js";

function splitAmount(total, count) {
  const base = total / BigInt(count); const remainder = total % BigInt(count);
  return Array.from({ length: count }, (_, index) => base + (BigInt(index) < remainder ? 1n : 0n));
}

export class BatchFollowBuyExecutor {
  constructor({ walletRepository, pumpPlanner, fourMemePlanner, solanaAdapter, evmAdapter }) {
    Object.assign(this, { walletRepository, pumpPlanner, fourMemePlanner, solanaAdapter, evmAdapter });
  }

  async execute({ platform, tokenAddress, wallets, totalAmountAtomic, password, slippageBps = 500 }) {
    if (!Array.isArray(wallets) || !wallets.length) throw new ExecutionError("FOLLOW_BUY_WALLETS_REQUIRED", "Follow-buy wallet group is empty");
    const amounts = splitAmount(BigInt(totalAmountAtomic), wallets.length);
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
