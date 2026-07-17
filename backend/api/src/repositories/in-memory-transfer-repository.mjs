import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.mjs";

function toCents(value) {
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

function fromCents(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function allocations(wallets, totalCents, distribution) {
  const weights = distribution === "equal" ? wallets.map(() => 1n) : wallets.map((_, index) => BigInt(index + 1));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  const amounts = weights.map((weight) => (totalCents * weight) / weightTotal);
  let remainder = totalCents - amounts.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % amounts.length) {
    amounts[index] += 1n;
    remainder -= 1n;
  }
  return wallets.map((wallet, index) => ({ walletId: wallet.walletId, amount: fromCents(amounts[index]) }));
}

function fractionOf(value, fractionBps) {
  return (toCents(value) * BigInt(fractionBps)) / 10_000n;
}

function groupPairAllocations(sourceWallets, destinationWallets, input) {
  const pairCount = Math.min(sourceWallets.length, destinationWallets.length);
  const pairs = [];
  if (input.amountMode === "fraction") {
    for (let index = 0; index < pairCount; index += 1) {
      const amountCents = fractionOf(sourceWallets[index].balance, input.fractionBps);
      pairs.push({
        pairIndex: index,
        sourceWalletId: sourceWallets[index].walletId,
        destinationWalletId: destinationWallets[index].walletId,
        amount: fromCents(amountCents),
      });
    }
  } else {
    const split = allocations(destinationWallets.slice(0, pairCount), toCents(input.amount), "equal");
    for (let index = 0; index < pairCount; index += 1) {
      pairs.push({
        pairIndex: index,
        sourceWalletId: sourceWallets[index].walletId,
        destinationWalletId: destinationWallets[index].walletId,
        amount: split[index].amount,
      });
    }
  }
  return {
    pairingMode: "wallet_index_1_to_1",
    pairCount,
    unmatchedSourceWalletIds: sourceWallets.slice(pairCount).map(({ walletId }) => walletId),
    unmatchedDestinationWalletIds: destinationWallets.slice(pairCount).map(({ walletId }) => walletId),
    allocations: pairs,
  };
}

function groupToLoginAllocations(sourceWallets, input) {
  if (input.amountMode === "fraction") {
    return sourceWallets.map((wallet, index) => ({ pairIndex: index, sourceWalletId: wallet.walletId, destinationType: "login_wallet", amount: fromCents(fractionOf(wallet.balance, input.fractionBps)) }));
  }
  const split = allocations(sourceWallets, toCents(input.amount), "equal");
  return sourceWallets.map((wallet, index) => ({ pairIndex: index, sourceWalletId: wallet.walletId, destinationType: "login_wallet", amount: split[index].amount }));
}

export class InMemoryTransferRepository {
  #walletGroups;
  #previewsByToken = new Map();
  #previewsByIdempotency = new Map();
  #transfersByIdempotency = new Map();
  #audit = [];

  constructor({ walletGroupRepository }) {
    this.#walletGroups = walletGroupRepository;
  }

  preview(input, requestId) {
    const signature = JSON.stringify(input);
    const existing = this.#previewsByIdempotency.get(input.idempotencyKey);
    if (existing) {
      if (existing.signature !== signature) {
        throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "idempotencyKey was already used with different preview input");
      }
      return structuredClone(existing.preview);
    }

    const destinationWallets = input.destination.type === "wallet_group" ? this.#walletGroups.listWallets(input.destination.id) : [];
    if (input.destination.type === "wallet_group" && destinationWallets.length === 0) throw new ApiError(400, "EMPTY_DESTINATION_GROUP", "Destination wallet group has no wallets");
    const sourceWallets = input.source.type === "wallet_group" ? this.#walletGroups.listWallets(input.source.id) : [];
    if (input.source.type === "wallet_group" && sourceWallets.length === 0) throw new ApiError(400, "EMPTY_SOURCE_GROUP", "Source wallet group has no wallets");
    const sourceBalance = input.source.type === "login_wallet"
      ? this.#walletGroups.loginWalletBalance()
      : this.#walletGroups.getGroup(input.source.id)?.totalBalance;
    if (sourceBalance == null) throw new ApiError(404, "SOURCE_WALLET_GROUP_NOT_FOUND", "Source wallet group was not found");
    const sourceCents = toCents(sourceBalance);
    let amountCents = input.amountMode === "fraction"
      ? (sourceCents * BigInt(input.fractionBps)) / 10_000n
      : toCents(input.amount);
    let transferPlan;
    if (input.source.type === "wallet_group" && input.destination.type === "wallet_group") {
      transferPlan = groupPairAllocations(sourceWallets, destinationWallets, input);
      amountCents = transferPlan.allocations.reduce((sum, item) => sum + toCents(item.amount), 0n);
    } else if (input.source.type === "wallet_group") {
      const pairAllocations = groupToLoginAllocations(sourceWallets, input);
      amountCents = pairAllocations.reduce((sum, item) => sum + toCents(item.amount), 0n);
      transferPlan = { pairingMode: "wallet_group_to_login", pairCount: pairAllocations.length, allocations: pairAllocations, unmatchedSourceWalletIds: [], unmatchedDestinationWalletIds: [] };
    } else {
      const distributed = allocations(destinationWallets, amountCents, input.distribution);
      transferPlan = { pairingMode: "login_to_wallet_group", pairCount: distributed.length, allocations: distributed, unmatchedSourceWalletIds: [], unmatchedDestinationWalletIds: [] };
    }
    if (amountCents <= 0n) throw new ApiError(400, "TRANSFER_AMOUNT_TOO_SMALL", "Transfer amount resolves to zero");
    if (amountCents > sourceCents) throw new ApiError(400, "INSUFFICIENT_SIMULATED_BALANCE", "Transfer amount exceeds the simulated source balance");

    const now = new Date();
    const preview = {
      previewToken: randomUUID(),
      confirmationToken: randomUUID(),
      status: "planned",
      executionMode: "disabled",
      source: structuredClone(input.source),
      destination: structuredClone(input.destination),
      amountMode: input.amountMode,
      requestedAmount: input.amountMode === "amount" ? input.amount : null,
      fractionBps: input.amountMode === "fraction" ? input.fractionBps : null,
      estimatedAmount: fromCents(amountCents),
      currency: "USD",
      distribution: input.distribution,
      pairingMode: transferPlan.pairingMode,
      pairCount: transferPlan.pairCount,
      unmatchedSourceWalletIds: transferPlan.unmatchedSourceWalletIds,
      unmatchedDestinationWalletIds: transferPlan.unmatchedDestinationWalletIds,
      allocations: transferPlan.allocations,
      requiresConfirmation: true,
      signingStatus: "signing_disabled",
      broadcastingStatus: "broadcasting_disabled",
      executable: false,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      createdAt: now.toISOString(),
    };
    this.#previewsByToken.set(preview.previewToken, { preview, idempotencyKey: input.idempotencyKey });
    this.#previewsByIdempotency.set(input.idempotencyKey, { signature, preview });
    this.#recordAudit("transfer.previewed", { requestId, idempotencyKey: input.idempotencyKey });
    return structuredClone(preview);
  }

  create(input, headerIdempotencyKey, requestId) {
    if (headerIdempotencyKey !== input.idempotencyKey) {
      throw new ApiError(400, "IDEMPOTENCY_KEY_MISMATCH", "Idempotency-Key header must equal body idempotencyKey");
    }
    const previewRecord = this.#previewsByToken.get(input.previewToken);
    if (!previewRecord || previewRecord.preview.confirmationToken !== input.confirmationToken) {
      throw new ApiError(400, "INVALID_TRANSFER_CONFIRMATION", "Preview or confirmation token is invalid");
    }
    if (Date.parse(previewRecord.preview.expiresAt) <= Date.now()) {
      throw new ApiError(410, "TRANSFER_PREVIEW_EXPIRED", "Transfer preview has expired");
    }
    if (previewRecord.idempotencyKey !== input.idempotencyKey) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Transfer idempotency key does not match its preview");
    }
    const existing = this.#transfersByIdempotency.get(input.idempotencyKey);
    if (existing) return structuredClone(existing);

    const now = new Date().toISOString();
    const transfer = {
      transferId: randomUUID(),
      previewToken: input.previewToken,
      status: "planned",
      allowedStatuses: ["planned", "signing", "submitted", "confirmed", "failed"],
      statusHistory: [{ status: "planned", at: now }],
      executionMode: "disabled",
      signingStatus: "signing_disabled",
      broadcastingStatus: "broadcasting_disabled",
      submitted: false,
      confirmed: false,
      txHash: null,
      reason: "real_execution_disabled_pending_security_review",
      createdAt: now,
      updatedAt: now,
    };
    this.#transfersByIdempotency.set(input.idempotencyKey, transfer);
    this.#recordAudit("transfer.planned", { requestId, transferId: transfer.transferId, idempotencyKey: input.idempotencyKey });
    return structuredClone(transfer);
  }

  auditEvents() {
    return structuredClone(this.#audit);
  }

  #recordAudit(type, data) {
    this.#audit.push({ auditId: randomUUID(), type, at: new Date().toISOString(), ...structuredClone(data) });
  }
}
