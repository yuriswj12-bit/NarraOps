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
  #assetService;
  #previewsByToken = new Map();
  #previewsByIdempotency = new Map();
  #transfersByIdempotency = new Map();
  #audit = [];

  constructor({ walletGroupRepository, assetService = null }) {
    this.#walletGroups = walletGroupRepository;
    this.#assetService = assetService;
  }

  async preview(input, requestId) {
    if (this.#assetService) return this.#previewLive(input, requestId);
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

  async create(input, headerIdempotencyKey, requestId) {
    if (this.#assetService) return this.#createLive(input, headerIdempotencyKey, requestId);
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

  async #previewLive(input, requestId) {
    const signature = JSON.stringify(input);
    const existing = this.#previewsByIdempotency.get(input.idempotencyKey);
    if (existing) {
      if (existing.signature !== signature) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "idempotencyKey was already used with different preview input");
      return structuredClone(existing.preview);
    }
    if (input.source.type !== "wallet_group") {
      throw new ApiError(400, "EXTERNAL_WALLET_SIGNATURE_REQUIRED", "Deposits from an external wallet must be signed by that wallet; use the displayed deposit address");
    }
    const sourceWallets = this.#walletGroups.getAssetWallets(input.source.id, input.chain);
    const destinationWallets = input.destination.type === "wallet_group"
      ? this.#walletGroups.getAssetWallets(input.destination.id, input.chain)
      : [];
    const pairCount = input.destination.type === "wallet_group" ? Math.min(sourceWallets.length, destinationWallets.length) : sourceWallets.length;
    if (!pairCount) throw new ApiError(400, "EMPTY_TRANSFER_ROUTE", "The transfer route has no wallet pairs");
    const sourceRows = [];
    for (const wallet of sourceWallets.slice(0, pairCount)) {
      const balance = (await this.#assetService.balances({ addresses: wallet.addresses }))[input.chain];
      if (!balance || balance.status !== "live" || balance.atomic == null) throw new ApiError(503, "CHAIN_BALANCE_UNAVAILABLE", `Cannot read ${input.chain} balance right now`);
      sourceRows.push({ ...wallet, balance });
    }
    const decimals = input.chain === "solana" ? 9 : 18;
    const scale = 10n ** BigInt(decimals);
    const toAtomic = (value) => {
      const [whole, fraction = ""] = String(value).split(".");
      return (BigInt(whole) * scale) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
    };
    const fromAtomic = (value) => {
      const fraction = String(value % scale).padStart(decimals, "0").replace(/0+$/, "");
      return `${value / scale}${fraction ? `.${fraction}` : ""}`;
    };
    let amounts;
    if (input.amountMode === "fraction") {
      amounts = sourceRows.map(({ balance }) => (BigInt(balance.atomic) * BigInt(input.fractionBps)) / 10_000n);
    } else {
      const total = toAtomic(input.amount);
      amounts = sourceRows.map(() => total / BigInt(pairCount));
      let remainder = total - amounts.reduce((sum, value) => sum + value, 0n);
      for (let index = 0; remainder > 0n; index = (index + 1) % amounts.length) { amounts[index] += 1n; remainder -= 1n; }
    }
    if (amounts.some((amount) => amount <= 0n)) throw new ApiError(400, "TRANSFER_AMOUNT_TOO_SMALL", "One or more transfer amounts resolve to zero");
    if (amounts.some((amount, index) => amount >= BigInt(sourceRows[index].balance.atomic))) {
      throw new ApiError(400, "INSUFFICIENT_NATIVE_BALANCE", "Transfer must leave enough native asset for network fees");
    }
    const allocations = sourceRows.map((wallet, index) => ({
      pairIndex: index,
      sourceWalletId: wallet.walletId,
      walletReferenceId: wallet.walletReferenceId,
      from: wallet.publicAddress,
      to: input.destination.type === "wallet_group" ? destinationWallets[index].publicAddress : input.destination.address,
      destinationWalletId: input.destination.type === "wallet_group" ? destinationWallets[index].walletId : null,
      amount: fromAtomic(amounts[index]),
    }));
    const totalAtomic = amounts.reduce((sum, value) => sum + value, 0n);
    const now = new Date();
    const preview = {
      previewToken: randomUUID(), confirmationToken: randomUUID(), status: "requires_user_confirmation",
      executionMode: "live", chain: input.chain, source: structuredClone(input.source), destination: structuredClone(input.destination),
      amountMode: input.amountMode, requestedAmount: input.amountMode === "amount" ? input.amount : null,
      fractionBps: input.amountMode === "fraction" ? input.fractionBps : null,
      estimatedAmount: fromAtomic(totalAtomic), currency: input.chain === "solana" ? "SOL" : "BNB",
      distribution: input.distribution, pairingMode: input.destination.type === "wallet_group" ? "wallet_index_1_to_1" : "wallet_group_to_external",
      pairCount, unmatchedSourceWalletIds: sourceWallets.slice(pairCount).map(({ walletId }) => walletId),
      unmatchedDestinationWalletIds: destinationWallets.slice(pairCount).map(({ walletId }) => walletId), allocations,
      requiresConfirmation: true, signingStatus: "awaiting_confirmation", broadcastingStatus: "not_started", executable: true,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), createdAt: now.toISOString(),
    };
    this.#previewsByToken.set(preview.previewToken, { preview, idempotencyKey: input.idempotencyKey });
    this.#previewsByIdempotency.set(input.idempotencyKey, { signature, preview });
    this.#recordAudit("transfer.previewed_live", { requestId, idempotencyKey: input.idempotencyKey, chain: input.chain, pairCount });
    return structuredClone(preview);
  }

  async #createLive(input, headerIdempotencyKey, requestId) {
    if (headerIdempotencyKey !== input.idempotencyKey) throw new ApiError(400, "IDEMPOTENCY_KEY_MISMATCH", "Idempotency-Key header must equal body idempotencyKey");
    const record = this.#previewsByToken.get(input.previewToken);
    if (!record || record.preview.confirmationToken !== input.confirmationToken) throw new ApiError(400, "INVALID_TRANSFER_CONFIRMATION", "Preview or confirmation token is invalid");
    if (Date.parse(record.preview.expiresAt) <= Date.now()) throw new ApiError(410, "TRANSFER_PREVIEW_EXPIRED", "Transfer preview has expired");
    if (record.idempotencyKey !== input.idempotencyKey) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Transfer idempotency key does not match its preview");
    const existing = this.#transfersByIdempotency.get(input.idempotencyKey);
    if (existing) return structuredClone(existing);
    const now = new Date().toISOString();
    const transfer = { transferId: randomUUID(), previewToken: input.previewToken, status: "signing", executionMode: "live", submitted: false, confirmed: false, transactions: [], statusHistory: [{ status: "signing", at: now }], createdAt: now, updatedAt: now };
    this.#transfersByIdempotency.set(input.idempotencyKey, transfer);
    try {
      for (const allocation of record.preview.allocations) {
        const result = await this.#assetService.transfer({ chain: record.preview.chain, walletReferenceId: allocation.walletReferenceId, from: allocation.from, to: allocation.to, amount: allocation.amount });
        transfer.transactions.push({ sourceWalletId: allocation.sourceWalletId, destinationWalletId: allocation.destinationWalletId, ...result });
      }
      transfer.submitted = true;
      transfer.confirmed = transfer.transactions.every(({ status }) => status === "confirmed");
      transfer.status = transfer.confirmed ? "confirmed" : "submitted";
      transfer.signingStatus = "signed";
      transfer.broadcastingStatus = transfer.confirmed ? "confirmed" : "submitted";
      transfer.txHash = transfer.transactions.length === 1 ? transfer.transactions[0].txHash : null;
    } catch (error) {
      transfer.status = transfer.transactions.length ? "partially_failed" : "failed";
      transfer.error = { code: error.code || "TRANSFER_FAILED", message: error.message };
    }
    transfer.updatedAt = new Date().toISOString();
    transfer.statusHistory.push({ status: transfer.status, at: transfer.updatedAt });
    this.#recordAudit("transfer.executed_live", { requestId, transferId: transfer.transferId, status: transfer.status, transactionCount: transfer.transactions.length });
    return structuredClone(transfer);
  }

  #recordAudit(type, data) {
    this.#audit.push({ auditId: randomUUID(), type, at: new Date().toISOString(), ...structuredClone(data) });
  }
}
