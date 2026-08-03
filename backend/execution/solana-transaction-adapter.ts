// @ts-nocheck
import { Keypair, Transaction } from "@solana/web3.js";
import { ExecutionError } from "./errors.ts";

export class SolanaTransactionAdapter {
  constructor({ connection, executionEnabled = true } = {}) {
    if (!connection) throw new ExecutionError("SOLANA_RPC_REQUIRED", "Solana connection is required");
    this.connection = connection;
    this.executionEnabled = true;
  }

  signTransaction({ transactionBase64, privateKey }) {
    const secret = Buffer.from(privateKey.toString("utf8"), "base64");
    try {
      const signer = Keypair.fromSecretKey(secret);
      const transaction = Transaction.from(Buffer.from(transactionBase64, "base64"));
      if (!transaction.feePayer?.equals(signer.publicKey)) throw new ExecutionError("SIGNER_ADDRESS_MISMATCH", "Decrypted Solana wallet is not the transaction fee payer");
      transaction.partialSign(signer);
      return transaction.serialize({ requireAllSignatures: true, verifySignatures: true }).toString("base64");
    } finally {
      secret.fill(0);
    }
  }

  async broadcastTransaction({ signedTransactionBase64 }) {
    try {
      return await this.connection.sendRawTransaction(Buffer.from(signedTransactionBase64, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    } catch (error) {
      const message = String(error?.message || error);
      const details = { cause: message };
      if (message.includes("custom program error: 0x1") || /insufficient|funds|lamports/i.test(message)) {
        throw new ExecutionError(
          "SOLANA_INSUFFICIENT_FUNDS",
          "Cooking 钱包 SOL 不足：请降低 Cooking 钱包买入金额，或给 Cooking 钱包充值更多 SOL 后再发射。",
          details,
        );
      }
      throw new ExecutionError("SOLANA_BROADCAST_FAILED", `Solana 广播失败：${message}`, details);
    }
  }
}
