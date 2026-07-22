// @ts-nocheck
import { openWalletSecret } from "./encrypted-wallet-vault.ts";
import { ExecutionError } from "./errors.ts";
import { Wallet } from "ethers";

export class LaunchSigningService {
  constructor({ walletRepository, evmAdapter, solanaAdapter }) {
    this.walletRepository = walletRepository;
    this.evmAdapter = evmAdapter;
    this.solanaAdapter = solanaAdapter;
  }

  async signAndBroadcast({ platform, plan, walletReferenceId, password }) {
    const envelope = await this.walletRepository.getEncryptedWallet(walletReferenceId);
    if (!envelope) throw new ExecutionError("WALLET_NOT_FOUND", "Cooking wallet signing reference was not found");
    const privateKey = openWalletSecret(envelope, password);
    try {
      if (platform === "pump") {
        const signedTransactionBase64 = this.solanaAdapter.signTransaction({ transactionBase64: plan.transactionBase64, privateKey });
        const transactionHash = await this.solanaAdapter.broadcastTransaction({ signedTransactionBase64 });
        return { platform, chain: "solana", status: "submitted", transactionHash, mintAddress: plan.mintAddress };
      }
      if (platform === "fourmeme") {
        const signedTransaction = await this.evmAdapter.signTransaction({ transaction: plan, privateKey });
        const transactionHash = await this.evmAdapter.broadcastTransaction({ signedTransaction });
        return { platform, chain: "bsc", status: "submitted", transactionHash };
      }
      throw new ExecutionError("UNSUPPORTED_LAUNCH_PLATFORM", "Launch signing supports Pump.fun and Four.Meme only");
    } finally {
      privateKey.fill(0);
    }
  }

  async signEvmMessage({ walletReferenceId, password, message }) {
    const envelope = await this.walletRepository.getEncryptedWallet(walletReferenceId);
    if (!envelope) throw new ExecutionError("WALLET_NOT_FOUND", "Cooking wallet signing reference was not found");
    const privateKey = openWalletSecret(envelope, password);
    try {
      return new Wallet(privateKey.toString("utf8")).signMessage(message);
    } finally {
      privateKey.fill(0);
    }
  }
}
