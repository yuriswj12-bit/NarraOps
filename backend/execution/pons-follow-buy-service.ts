// @ts-nocheck
import { randomUUID } from "node:crypto";
import { InMemoryAuditLog } from "./audit-log.ts";
import { ExecutionError } from "./errors.ts";
import { digestBatch } from "./batch-wallet-signer.ts";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = `0x${"0".repeat(64)}`;
const DEFAULT_EXCLUDED_TOKENS = new Set(["0x0bd7d308f8e1639fab988df18a8011f41eacad73"]);

function requireHexHash(value, field) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value || "")) throw new ExecutionError("INVALID_EXECUTION_INPUT", `${field} must be a 32-byte transaction hash`);
  return value.toLowerCase();
}

function requireAmount(value) {
  try {
    const amount = BigInt(value);
    if (amount <= 0n) throw new Error();
    return amount;
  } catch {
    throw new ExecutionError("INVALID_EXECUTION_INPUT", "totalAmountWei must be a positive integer string");
  }
}

export function extractLaunchedTokenAddress(receipt, excludedTokens = DEFAULT_EXCLUDED_TOKENS) {
  if (!receipt || receipt.status !== "0x1") throw new ExecutionError("LAUNCH_NOT_CONFIRMED", "Launch transaction is not confirmed successfully");
  const candidates = (receipt.logs || []).filter((log) => {
    const address = String(log.address || "").toLowerCase();
    const topics = log.topics || [];
    return topics[0]?.toLowerCase() === TRANSFER_TOPIC && topics[1]?.toLowerCase() === ZERO_TOPIC && !excludedTokens.has(address);
  });
  const candidate = candidates.at(-1);
  if (!candidate) throw new ExecutionError("TOKEN_ADDRESS_NOT_FOUND", "No launched token mint event was found in the launch receipt");
  return candidate.address.toLowerCase();
}

function equalAllocations(wallets, totalAmountWei) {
  const total = BigInt(totalAmountWei);
  const count = BigInt(wallets.length);
  const base = total / count;
  let remainder = total % count;
  return wallets.map((wallet) => {
    const amount = base + (remainder > 0n ? 1n : 0n);
    if (remainder > 0n) remainder -= 1n;
    return { walletReferenceId: wallet.walletReferenceId, publicAddress: wallet.publicAddress, amountWei: amount.toString() };
  });
}

async function withRetries(action, attempts, onRetry) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await action(attempt); }
    catch (error) {
      lastError = error;
      if (attempt < attempts) onRetry?.(attempt, error);
    }
  }
  throw lastError;
}

export class PonsFollowBuyService {
  constructor({ receiptProvider, quoteProvider, batchSigner, auditLog = new InMemoryAuditLog(), maxAttempts = 3 } = {}) {
    this.receiptProvider = receiptProvider;
    this.quoteProvider = quoteProvider;
    this.batchSigner = batchSigner;
    this.auditLog = auditLog;
    this.maxAttempts = maxAttempts;
    this.plans = new Map();
  }

  async plan(input) {
    const executionId = randomUUID();
    const launchTransactionHash = requireHexHash(input.launchTransactionHash, "launchTransactionHash");
    const totalAmountWei = requireAmount(input.totalAmountWei);
    const wallets = input.wallets || [];
    if (!wallets.length) throw new ExecutionError("EMPTY_WALLET_GROUP", "The follow-buy wallet group has no wallets");
    this.auditLog.append({ executionId, type: "follow_buy.planned", launchTransactionHash, walletCount: wallets.length, totalAmountWei: totalAmountWei.toString() });

    const launchReceipt = await this.receiptProvider.waitForReceipt(launchTransactionHash);
    const tokenAddress = extractLaunchedTokenAddress(launchReceipt);
    this.auditLog.append({ executionId, type: "follow_buy.launch_confirmed", tokenAddress, blockNumber: launchReceipt.blockNumber });

    const allocations = equalAllocations(wallets, totalAmountWei);
    const unsignedTransactions = await withRetries(
      () => this.quoteProvider.buildPonsBuyBatch({ tokenAddress, allocations, slippageBps: input.slippageBps }),
      this.maxAttempts,
      (attempt, error) => this.auditLog.append({ executionId, type: "follow_buy.quote_retry", attempt, code: error.code || "QUOTE_FAILED" }),
    );
    if (unsignedTransactions.length !== wallets.length) throw new ExecutionError("QUOTE_COUNT_MISMATCH", "Quote provider did not return one transaction per wallet");

    const transactionDigest = digestBatch(unsignedTransactions);
    this.plans.set(executionId, { executionId, tokenAddress, launchTransactionHash, wallets, unsignedTransactions });
    this.auditLog.append({ executionId, type: "follow_buy.awaiting_approval", transactionDigest, walletCount: wallets.length });
    return {
      executionId,
      tokenAddress,
      launchTransactionHash,
      transactionDigest,
      walletCount: wallets.length,
      totalAmountWei: totalAmountWei.toString(),
      transactions: unsignedTransactions.map(({ walletReferenceId, from, to, value, quote }) => ({ walletReferenceId, from, to, value, quote })),
    };
  }

  async executeApproved({ executionId, confirmationToken }) {
    if (!confirmationToken) throw new ExecutionError("CONFIRMATION_REQUIRED", "A single batch policy confirmation is required");
    const plan = this.plans.get(executionId);
    this.plans.delete(executionId);
    if (!plan) throw new ExecutionError("FOLLOW_BUY_PLAN_NOT_FOUND", "Follow-buy plan is missing, expired, or already consumed");
    const { tokenAddress, launchTransactionHash, wallets, unsignedTransactions } = plan;

    this.auditLog.append({ executionId, type: "follow_buy.batch_signing_requested", walletCount: wallets.length });
    // The approval is intentionally single-use; the signer owns any safe,
    // idempotent broadcast retry and must never request a second approval.
    const submissions = await this.batchSigner.signAndBroadcastBatch({ executionId, confirmationToken, transactions: unsignedTransactions });
    const accepted = submissions.filter((item) => /^0x[0-9a-fA-F]{64}$/.test(item.transactionHash || ""));
    this.auditLog.append({ executionId, type: "follow_buy.submitted", submittedCount: accepted.length, failedCount: wallets.length - accepted.length });

    const reconciled = await Promise.all(accepted.map(async (submission) => {
      try {
        const receipt = await this.receiptProvider.waitForReceipt(submission.transactionHash);
        return { ...submission, status: receipt.status === "0x1" ? "confirmed" : "failed", blockNumber: receipt.blockNumber };
      } catch (error) {
        return { ...submission, status: "timed_out", errorCode: error.code || "CONFIRMATION_TIMEOUT" };
      }
    }));
    const confirmedCount = reconciled.filter(({ status }) => status === "confirmed").length;
    const failedCount = wallets.length - confirmedCount;
    const status = confirmedCount === wallets.length ? "confirmed" : confirmedCount > 0 ? "partially_failed" : "failed";
    this.auditLog.append({ executionId, type: "follow_buy.reconciled", status, confirmedCount, failedCount });
    return { executionId, status, tokenAddress, launchTransactionHash, submittedCount: accepted.length, confirmedCount, failedCount, transactions: reconciled };
  }

  async execute(input) {
    const plan = await this.plan(input);
    return this.executeApproved({ executionId: plan.executionId, confirmationToken: input.confirmationToken });
  }
}
