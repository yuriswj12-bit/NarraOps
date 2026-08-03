// @ts-nocheck
import { randomUUID } from "node:crypto";
import { ApiError } from "../errors.ts";

function splitAtomic(total, count, distribution) {
  const weights = Array.from({ length: count }, (_, index) => distribution === "random" ? BigInt(index + 1) : 1n);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  const amounts = weights.map((weight) => (total * weight) / weightTotal);
  let remainder = total - amounts.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % amounts.length) {
    amounts[index] += 1n;
    remainder -= 1n;
  }
  return amounts;
}

function nativeDecimals(chain) {
  return chain === "solana" ? 9 : 18;
}

function nativeFeeReserveAtomic(chain) {
  return chain === "solana" ? 5_000n : 1_000_000_000_000n;
}

function decimalToNativeAtomic(value, chain) {
  const decimals = nativeDecimals(chain);
  const scale = 10n ** BigInt(decimals);
  const [whole, fraction = ""] = String(value).split(".");
  return (BigInt(whole) * scale) + BigInt(fraction.padEnd(decimals, "0").slice(0, decimals));
}

function nativeAtomicToDecimal(value, chain) {
  const decimals = nativeDecimals(chain);
  const scale = 10n ** BigInt(decimals);
  const fraction = String(value % scale).padStart(decimals, "0").replace(/0+$/, "");
  return `${value / scale}${fraction ? `.${fraction}` : ""}`;
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
    if (!this.#assetService) throw new ApiError(503, "TRANSFER_PROVIDER_UNAVAILABLE", "Live asset provider is required for wallet transfers");
    return this.#previewLive(input, requestId);
  }

  async create(input, headerIdempotencyKey, requestId) {
    if (!this.#assetService) throw new ApiError(503, "TRANSFER_PROVIDER_UNAVAILABLE", "Live asset provider is required for wallet transfers");
    return this.#createLive(input, headerIdempotencyKey, requestId);
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
    if (sourceWallets.length === 0) throw new ApiError(400, "EMPTY_SOURCE_GROUP", "Source wallet group has no wallets");
    if (input.destination.type === "wallet_group" && destinationWallets.length === 0) throw new ApiError(400, "EMPTY_DESTINATION_GROUP", "Destination wallet group has no wallets");
    const sourceRows = [];
    for (const wallet of sourceWallets) {
      const balance = (await this.#assetService.balances({ addresses: wallet.addresses }))[input.chain];
      if (!balance || balance.status !== "live" || balance.atomic == null) throw new ApiError(503, "CHAIN_BALANCE_UNAVAILABLE", `Cannot read ${input.chain} balance right now`);
      sourceRows.push({ ...wallet, balance });
    }
    const toAtomic = (value) => decimalToNativeAtomic(value, input.chain);
    const fromAtomic = (value) => nativeAtomicToDecimal(value, input.chain);
    const feeReserveAtomic = nativeFeeReserveAtomic(input.chain);
    const spendableRows = sourceRows
      .map((wallet) => ({ ...wallet, spendableAtomic: BigInt(wallet.balance.atomic) > feeReserveAtomic ? BigInt(wallet.balance.atomic) - feeReserveAtomic : 0n }))
      .filter(({ spendableAtomic }) => spendableAtomic > 0n);
    if (spendableRows.length === 0) throw new ApiError(400, "NO_FUNDED_SOURCE_WALLETS", "No source wallet has spendable native balance");

    const buildRoutes = () => {
      if (input.destination.type !== "wallet_group") {
        return spendableRows.map((source, index) => ({ source, destination: null, destinationWalletId: null, routeIndex: index }));
      }
      if (destinationWallets.length === 1) {
        return spendableRows.map((source, index) => ({ source, destination: destinationWallets[0], destinationWalletId: destinationWallets[0].walletId, routeIndex: index }));
      }
      if (spendableRows.length < destinationWallets.length) {
        return destinationWallets.map((destination, index) => ({ source: spendableRows[index % spendableRows.length], destination, destinationWalletId: destination.walletId, routeIndex: index }));
      }
      return destinationWallets.map((destination, index) => ({ source: spendableRows[index], destination, destinationWalletId: destination.walletId, routeIndex: index }));
    };
    const routes = buildRoutes();
    if (routes.length === 0) throw new ApiError(400, "EMPTY_TRANSFER_ROUTE", "The transfer route has no wallet pairs");

    let routeAmounts;
    if (input.amountMode === "fraction") {
      const spendBySource = new Map();
      for (const route of routes) {
        if (!spendBySource.has(route.source.walletId)) {
          const balanceAtomic = BigInt(route.source.balance.atomic);
          const requestedAtomic = (balanceAtomic * BigInt(input.fractionBps)) / 10_000n;
          spendBySource.set(route.source.walletId, requestedAtomic >= balanceAtomic ? route.source.spendableAtomic : requestedAtomic);
        }
      }
      const routesBySource = new Map();
      routes.forEach((route, index) => {
        const current = routesBySource.get(route.source.walletId) || [];
        current.push(index);
        routesBySource.set(route.source.walletId, current);
      });
      routeAmounts = Array.from({ length: routes.length }, () => 0n);
      for (const [sourceWalletId, routeIndexes] of routesBySource) {
        const split = splitAtomic(spendBySource.get(sourceWalletId) || 0n, routeIndexes.length, input.distribution);
        routeIndexes.forEach((routeIndex, splitIndex) => { routeAmounts[routeIndex] = split[splitIndex]; });
      }
    } else {
      routeAmounts = splitAtomic(toAtomic(input.amount), routes.length, input.distribution);
    }
    const allocations = routes
      .map((route, index) => ({
        route,
        amountAtomic: routeAmounts[index] || 0n,
      }))
      .filter(({ amountAtomic }) => amountAtomic > 0n)
      .map(({ route, amountAtomic }, index) => ({
        pairIndex: index,
        sourceWalletId: route.source.walletId,
        walletReferenceId: route.source.walletReferenceId,
        from: route.source.publicAddress,
        to: input.destination.type === "wallet_group" ? route.destination.publicAddress : input.destination.address,
        destinationWalletId: route.destinationWalletId,
        amount: fromAtomic(amountAtomic),
      }));
    if (allocations.length === 0) throw new ApiError(400, "TRANSFER_AMOUNT_TOO_SMALL", "One or more transfer amounts resolve to zero");
    const sourceSpend = new Map();
    for (const allocation of allocations) {
      const amountAtomic = toAtomic(allocation.amount);
      sourceSpend.set(allocation.sourceWalletId, (sourceSpend.get(allocation.sourceWalletId) || 0n) + amountAtomic);
    }
    for (const [walletId, spendAtomic] of sourceSpend) {
      const source = spendableRows.find((wallet) => wallet.walletId === walletId);
      if (!source || spendAtomic > source.spendableAtomic) throw new ApiError(400, "INSUFFICIENT_NATIVE_BALANCE", "Transfer must leave enough native asset for network fees");
    }
    const pairingMode = input.destination.type !== "wallet_group"
      ? "wallet_group_to_external"
      : destinationWallets.length === 1
        ? "wallet_group_collect_to_single_destination"
        : spendableRows.length < destinationWallets.length
          ? "source_group_to_destination_group_distribution"
          : "wallet_index_1_to_1";
    const totalAtomic = allocations.reduce((sum, allocation) => sum + toAtomic(allocation.amount), 0n);
    const usedSourceWalletIds = new Set(allocations.map(({ sourceWalletId }) => sourceWalletId));
    const usedDestinationWalletIds = new Set(allocations.map(({ destinationWalletId }) => destinationWalletId).filter(Boolean));
    const now = new Date();
    const preview = {
      previewToken: randomUUID(), confirmationToken: randomUUID(), status: "requires_user_confirmation",
      executionMode: "live", chain: input.chain, source: structuredClone(input.source), destination: structuredClone(input.destination),
      amountMode: input.amountMode, requestedAmount: input.amountMode === "amount" ? input.amount : null,
      fractionBps: input.amountMode === "fraction" ? input.fractionBps : null,
      estimatedAmount: fromAtomic(totalAtomic), currency: input.chain === "solana" ? "SOL" : "BNB",
      distribution: input.distribution, pairingMode,
      pairCount: allocations.length,
      unmatchedSourceWalletIds: sourceWallets.map(({ walletId }) => walletId).filter((walletId) => !usedSourceWalletIds.has(walletId)),
      unmatchedDestinationWalletIds: destinationWallets.map(({ walletId }) => walletId).filter((walletId) => !usedDestinationWalletIds.has(walletId)),
      allocations,
      requiresConfirmation: true, signingStatus: "awaiting_confirmation", broadcastingStatus: "not_started", executable: true,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(), createdAt: now.toISOString(),
    };
    this.#previewsByToken.set(preview.previewToken, { preview, idempotencyKey: input.idempotencyKey });
    this.#previewsByIdempotency.set(input.idempotencyKey, { signature, preview });
    this.#recordAudit("transfer.previewed_live", { requestId, idempotencyKey: input.idempotencyKey, chain: input.chain, pairCount: allocations.length });
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
    const batches = new Map();
    for (const allocation of record.preview.allocations) {
      const key = `${allocation.walletReferenceId}::${allocation.from}`;
      const batch = batches.get(key) || [];
      batch.push(allocation);
      batches.set(key, batch);
    }
    for (const batch of batches.values()) {
      try {
        const refreshed = await this.#refreshExecutableBatch(record.preview.chain, batch);
        if (refreshed.length === 0) {
          for (const allocation of batch) {
            transfer.transactions.push({
              sourceWalletId: allocation.sourceWalletId,
              destinationWalletId: allocation.destinationWalletId,
              from: allocation.from,
              to: allocation.to,
              amount: allocation.amount,
              status: "failed",
              error: { code: "NO_SPENDABLE_BALANCE", message: "Source wallet has no spendable native balance at execution time" },
            });
          }
          continue;
        }
        if (batch.length > 1 && typeof this.#assetService.transferBatch === "function") {
          const results = await this.#assetService.transferBatch({
            chain: record.preview.chain,
            walletReferenceId: refreshed[0].walletReferenceId,
            from: refreshed[0].from,
            transfers: refreshed.map((allocation) => ({ to: allocation.to, amount: allocation.amount })),
          });
          results.forEach((result, index) => {
            const allocation = refreshed[index];
            transfer.transactions.push({ sourceWalletId: allocation.sourceWalletId, destinationWalletId: allocation.destinationWalletId, to: allocation.to, ...result });
          });
        } else {
          for (const allocation of refreshed) {
            const result = await this.#assetService.transfer({ chain: record.preview.chain, walletReferenceId: allocation.walletReferenceId, from: allocation.from, to: allocation.to, amount: allocation.amount });
            transfer.transactions.push({ sourceWalletId: allocation.sourceWalletId, destinationWalletId: allocation.destinationWalletId, ...result });
          }
        }
      } catch (error) {
        for (const allocation of batch) {
          transfer.transactions.push({
            sourceWalletId: allocation.sourceWalletId,
            destinationWalletId: allocation.destinationWalletId,
            from: allocation.from,
            to: allocation.to,
            amount: allocation.amount,
            status: "failed",
            error: { code: error.code || "TRANSFER_ALLOCATION_FAILED", message: error.message },
          });
        }
      }
    }
    const succeeded = transfer.transactions.filter(({ status }) => status !== "failed");
    const failed = transfer.transactions.filter(({ status }) => status === "failed");
    transfer.submitted = succeeded.length > 0;
    transfer.confirmed = succeeded.length > 0 && succeeded.every(({ status }) => status === "confirmed") && failed.length === 0;
    transfer.status = failed.length === 0 ? (transfer.confirmed ? "confirmed" : "submitted") : succeeded.length > 0 ? "partially_failed" : "failed";
    transfer.signingStatus = succeeded.length > 0 ? "signed" : "failed";
    transfer.broadcastingStatus = failed.length === 0 ? (transfer.confirmed ? "confirmed" : "submitted") : transfer.status;
    transfer.txHash = succeeded.length === 1 && transfer.transactions.length === 1 ? succeeded[0].txHash : null;
    if (failed.length > 0) transfer.error = { code: "TRANSFER_ALLOCATIONS_FAILED", message: `${failed.length} transfer allocation(s) failed` };
    transfer.updatedAt = new Date().toISOString();
    transfer.statusHistory.push({ status: transfer.status, at: transfer.updatedAt });
    this.#recordAudit("transfer.executed_live", { requestId, transferId: transfer.transferId, status: transfer.status, transactionCount: transfer.transactions.length });
    return structuredClone(transfer);
  }

  async #refreshExecutableBatch(chain, batch) {
    const first = batch[0];
    const balances = await this.#assetService.balances({ addresses: { [chain]: first.from } });
    const balance = balances?.[chain];
    if (!balance || balance.status !== "live" || balance.atomic == null) return batch;
    const reserve = nativeFeeReserveAtomic(chain);
    const spendable = BigInt(balance.atomic) > reserve ? BigInt(balance.atomic) - reserve : 0n;
    if (spendable <= 0n) return [];
    const requested = batch.reduce((sum, allocation) => sum + decimalToNativeAtomic(allocation.amount, chain), 0n);
    if (requested <= spendable) return batch;
    const amounts = splitAtomic(spendable, batch.length, "equal");
    return batch
      .map((allocation, index) => ({ ...allocation, amount: nativeAtomicToDecimal(amounts[index], chain) }))
      .filter((allocation) => decimalToNativeAtomic(allocation.amount, chain) > 0n);
  }

  #recordAudit(type, data) {
    this.#audit.push({ auditId: randomUUID(), type, at: new Date().toISOString(), ...structuredClone(data) });
  }
}
