// @ts-nocheck
import bs58 from "bs58";
import { openWalletSecret } from "./encrypted-wallet-vault.ts";
import { ExecutionError } from "./errors.ts";

export class WalletExportService {
  constructor({ walletRepository, password }) {
    if (!walletRepository || !password) throw new ExecutionError("WALLET_EXPORT_CONFIG_REQUIRED", "Wallet export requires the encrypted wallet store and vault password");
    this.walletRepository = walletRepository;
    this.password = password;
  }

  async exportText(group, wallets) {
    const blocks = [];
    for (const wallet of wallets) {
      const rows = [`${wallet.label}`];
      for (const [kind, referenceId] of Object.entries(wallet.signerReferences || {})) {
        const envelope = await this.walletRepository.getEncryptedWallet(referenceId);
        if (!envelope) throw new ExecutionError("WALLET_SECRET_NOT_FOUND", `Encrypted material is missing for ${wallet.label}`);
        const secret = openWalletSecret(envelope, this.password);
        try {
          const chain = kind === "solana" ? "Solana" : "EVM";
          const address = kind === "solana" ? wallet.addresses.solana : wallet.addresses.bsc;
          const privateKey = kind === "solana" ? bs58.encode(Buffer.from(secret.toString("utf8"), "base64")) : secret.toString("utf8");
          rows.push(`${chain} 地址: ${address}`, `${chain} 私钥: ${privateKey}`);
        } finally {
          secret.fill(0);
        }
      }
      blocks.push(rows.join("\n"));
    }
    const safeName = group.name.replace(/[\\/:*?"<>|]/g, "_");
    return { fileName: `${safeName}-${group.network}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`, content: `${blocks.join("\n\n")}\n`, walletCount: wallets.length };
  }
}
