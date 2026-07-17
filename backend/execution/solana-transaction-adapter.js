import { Keypair, Transaction } from "@solana/web3.js";
import { ExecutionError } from "./errors.js";

export class SolanaTransactionAdapter {
  constructor({ connection, executionEnabled = false } = {}) {
    if (!connection) throw new ExecutionError("SOLANA_RPC_REQUIRED", "Solana connection is required");
    this.connection = connection;
    this.executionEnabled = executionEnabled;
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
    if (!this.executionEnabled) throw new ExecutionError("REAL_EXECUTION_DISABLED", "Real Solana broadcasting is disabled");
    return this.connection.sendRawTransaction(Buffer.from(signedTransactionBase64, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
  }
}
