import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ExecutionError } from "./errors.js";
import { openWalletSecret } from "./encrypted-wallet-vault.js";

function hash(value) {
  return createHash("sha256").update(value).digest();
}

function normalizeAddress(value) {
  return String(value || "").toLowerCase();
}

export class OneTimeApprovalStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.approvals = new Map();
  }

  issue({ executionId, transactionDigest, password, ttlMs = 120_000 }) {
    const token = randomUUID();
    if (typeof password !== "string" || !password.length) throw new ExecutionError("APPROVAL_REQUIRED", "Wallet password is required for approval");
    this.approvals.set(executionId, {
      tokenHash: hash(token),
      transactionDigest,
      expiresAt: this.now() + ttlMs,
      password: Buffer.from(password, "utf8"),
    });
    return token;
  }

  consume({ executionId, token, transactionDigest }) {
    const approval = this.approvals.get(executionId);
    this.approvals.delete(executionId);
    if (!approval || approval.expiresAt < this.now()) {
      approval?.password.fill(0);
      throw new ExecutionError("APPROVAL_REQUIRED", "Batch approval is missing or expired");
    }
    const supplied = hash(String(token || ""));
    if (!timingSafeEqual(supplied, approval.tokenHash) || approval.transactionDigest !== transactionDigest) {
      approval.password.fill(0);
      throw new ExecutionError("APPROVAL_MISMATCH", "Batch approval does not match this transaction plan");
    }
    return approval.password;
  }
}

export function digestBatch(transactions) {
  return createHash("sha256").update(JSON.stringify(transactions.map((transaction) => ({
    walletReferenceId: transaction.walletReferenceId,
    chainId: Number(transaction.chainId),
    to: normalizeAddress(transaction.to),
    value: String(transaction.value),
    data: transaction.data,
  })))).digest("hex");
}

export class EncryptedBatchWalletSigner {
  constructor({ walletRepository, transactionAdapter, approvalStore, policy }) {
    this.walletRepository = walletRepository;
    this.transactionAdapter = transactionAdapter;
    this.approvalStore = approvalStore;
    this.policy = {
      chainId: Number(policy.chainId),
      allowedContracts: new Set(policy.allowedContracts.map(normalizeAddress)),
      maxTransactionValueWei: BigInt(policy.maxTransactionValueWei),
      maxBatchValueWei: BigInt(policy.maxBatchValueWei),
      maxWallets: Number(policy.maxWallets || 100),
    };
  }

  validate(transactions) {
    if (!Array.isArray(transactions) || !transactions.length || transactions.length > this.policy.maxWallets) {
      throw new ExecutionError("BATCH_POLICY_REJECTED", "Wallet count is outside the approved policy");
    }
    let total = 0n;
    const seen = new Set();
    for (const transaction of transactions) {
      if (Number(transaction.chainId) !== this.policy.chainId) throw new ExecutionError("BATCH_POLICY_REJECTED", "Chain is not approved");
      if (!this.policy.allowedContracts.has(normalizeAddress(transaction.to))) throw new ExecutionError("BATCH_POLICY_REJECTED", "Contract is not approved");
      const value = BigInt(transaction.value);
      if (value < 0n || value > this.policy.maxTransactionValueWei) throw new ExecutionError("BATCH_POLICY_REJECTED", "Transaction value exceeds policy");
      if (seen.has(transaction.walletReferenceId)) throw new ExecutionError("BATCH_POLICY_REJECTED", "A wallet may only appear once per batch");
      seen.add(transaction.walletReferenceId);
      total += value;
    }
    if (total > this.policy.maxBatchValueWei) throw new ExecutionError("BATCH_POLICY_REJECTED", "Batch value exceeds policy");
  }

  async signAndBroadcastBatch({ executionId, confirmationToken, transactions }) {
    this.validate(transactions);
    const password = this.approvalStore.consume({ executionId, token: confirmationToken, transactionDigest: digestBatch(transactions) });

    const results = [];
    try {
      for (const transaction of transactions) {
        const envelope = await this.walletRepository.getEncryptedWallet(transaction.walletReferenceId);
        if (!envelope || normalizeAddress(envelope.publicAddress) !== normalizeAddress(transaction.from)) {
          throw new ExecutionError("WALLET_NOT_FOUND", "Wallet reference does not match the transaction sender");
        }
        const privateKey = openWalletSecret(envelope, password);
        try {
          const signedTransaction = await this.transactionAdapter.signTransaction({ transaction, privateKey });
          const transactionHash = await this.transactionAdapter.broadcastTransaction({ signedTransaction });
          results.push({ walletReferenceId: transaction.walletReferenceId, transactionHash });
        } finally {
          privateKey.fill(0);
        }
      }
      return results;
    } finally {
      password.fill(0);
    }
  }
}
