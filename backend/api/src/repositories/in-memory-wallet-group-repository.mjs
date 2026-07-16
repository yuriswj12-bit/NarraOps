import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApiError } from "../errors.mjs";

const ZERO_BALANCE_RECOVERY = "archive_zero_balance_wallets";

function clone(value) {
  return structuredClone(value);
}

function isZeroAmount(value) {
  return /^0+(?:\.0+)?$/.test(value);
}

function addMoney(values) {
  const cents = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value.split(".");
    return sum + (BigInt(whole) * 100n) + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  }, 0n);
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export class InMemoryWalletGroupRepository {
  #groups = new Map();
  #wallets = new Map();
  #deleteConfirmations = new Map();
  #audit = [];
  #filePath;

  constructor({ seed = true, filePath } = {}) {
    this.#filePath = filePath;
    if (!this.#load() && seed) this.#seed();
  }

  listGroups() {
    return [...this.#groups.values()].map((group) => this.#publicGroup(group));
  }

  getGroup(groupId) {
    const group = this.#groups.get(groupId);
    return group ? this.#publicGroup(group) : null;
  }

  createGroup({ name, walletCount, purpose = "general" }) {
    const now = new Date().toISOString();
    const group = {
      groupId: randomUUID(),
      name,
      purpose,
      walletIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#groups.set(group.groupId, group);
    this.addWallets(group.groupId, walletCount);
    this.#recordAudit("wallet_group.created", { groupId: group.groupId, walletCount });
    this.#save();
    return this.getGroup(group.groupId);
  }

  addWallets(groupId, count) {
    const group = this.#requireGroup(groupId);
    if (group.purpose === "cooking" && group.walletIds.length + count > 1) {
      throw new ApiError(400, "COOKING_WALLET_LIMIT_EXCEEDED", "A cooking wallet group can contain exactly one wallet");
    }
    if (group.walletIds.length + count > 200) {
      throw new ApiError(400, "WALLET_GROUP_LIMIT_EXCEEDED", "A wallet group can contain at most 200 wallets");
    }
    const created = [];
    for (let index = 0; index < count; index += 1) {
      const wallet = this.#createWallet(groupId, group.walletIds.length + 1, "0.00");
      group.walletIds.push(wallet.walletId);
      created.push(wallet);
    }
    group.updatedAt = new Date().toISOString();
    this.#recordAudit("wallet_group.wallets_added", { groupId, count });
    this.#save();
    return created.map(clone);
  }

  listWallets(groupId) {
    const group = this.#requireGroup(groupId);
    return group.walletIds.map((walletId) => this.#publicWallet(this.#wallets.get(walletId)));
  }

  activateWallet(walletId, provisioning) {
    const wallet = this.#wallets.get(walletId);
    if (!wallet) throw new ApiError(404, "WALLET_NOT_FOUND", "Wallet was not found");
    wallet.publicAddress = provisioning.publicAddress;
    wallet.addresses = clone(provisioning.addresses);
    wallet.signerReferences = clone(provisioning.signerReferences);
    wallet.custodyMode = provisioning.custodyMode;
    wallet.provisioningStatus = provisioning.provisioningStatus;
    wallet.updatedAt = new Date().toISOString();
    this.#recordAudit("wallet.provisioned", { walletId, groupId: wallet.groupId, custodyMode: wallet.custodyMode });
    this.#save();
    return this.#publicWallet(wallet);
  }

  mode() {
    return [...this.#wallets.values()].some(({ provisioningStatus }) => provisioningStatus === "active") ? "encrypted_vault" : "mock";
  }

  previewBatchDelete(groupId, walletIds, requestId) {
    const group = this.#requireGroup(groupId);
    const selected = this.#selectWallets(group, walletIds);
    const protectedWallets = selected.filter((wallet) => !isZeroAmount(wallet.balance));
    const deletableWalletIds = selected.filter((wallet) => isZeroAmount(wallet.balance)).map(({ walletId }) => walletId);
    const now = Date.now();
    const confirmation = {
      operationId: randomUUID(),
      confirmationToken: randomUUID(),
      groupId,
      walletIds: [...walletIds].sort(),
      deletableWalletIds,
      protectedWalletIds: protectedWallets.map(({ walletId }) => walletId),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      used: false,
    };
    this.#deleteConfirmations.set(confirmation.confirmationToken, confirmation);
    this.#recordAudit("wallet_group.batch_delete_previewed", {
      requestId,
      groupId,
      operationId: confirmation.operationId,
      requestedCount: walletIds.length,
      protectedCount: protectedWallets.length,
    });
    return {
      operationId: confirmation.operationId,
      status: "requires_user_confirmation",
      requiresConfirmation: true,
      confirmationToken: confirmation.confirmationToken,
      expiresAt: confirmation.expiresAt,
      deletableWalletIds,
      protectedWallets: protectedWallets.map(({ walletId, label, balance, balanceAsset }) => ({
        walletId,
        label,
        balance,
        balanceAsset,
        reason: "non_zero_balance",
      })),
      recoveryPolicy: {
        requiredStrategy: ZERO_BALANCE_RECOVERY,
        nonZeroBalanceAction: "protected_no_delete",
        sweepSupported: false,
      },
    };
  }

  confirmBatchDelete(groupId, input, requestId) {
    const confirmation = this.#deleteConfirmations.get(input.confirmationToken);
    if (!confirmation || confirmation.groupId !== groupId) {
      throw new ApiError(400, "INVALID_CONFIRMATION_TOKEN", "The delete confirmation token is invalid");
    }
    if (confirmation.used) throw new ApiError(409, "CONFIRMATION_ALREADY_USED", "The delete confirmation token was already used");
    if (Date.parse(confirmation.expiresAt) <= Date.now()) {
      throw new ApiError(410, "CONFIRMATION_EXPIRED", "The delete confirmation token has expired");
    }
    if (input.recoveryStrategy !== ZERO_BALANCE_RECOVERY) {
      throw new ApiError(400, "RECOVERY_STRATEGY_REQUIRED", `recoveryStrategy must be ${ZERO_BALANCE_RECOVERY}`);
    }
    if (JSON.stringify([...input.walletIds].sort()) !== JSON.stringify(confirmation.walletIds)) {
      throw new ApiError(409, "DELETE_SELECTION_CHANGED", "Wallet selection changed after the delete preview");
    }

    const group = this.#requireGroup(groupId);
    const deletedWalletIds = [];
    for (const walletId of confirmation.deletableWalletIds) {
      const wallet = this.#wallets.get(walletId);
      if (!wallet || !isZeroAmount(wallet.balance)) continue;
      this.#wallets.delete(walletId);
      group.walletIds = group.walletIds.filter((id) => id !== walletId);
      deletedWalletIds.push(walletId);
    }
    confirmation.used = true;
    group.updatedAt = new Date().toISOString();
    this.#recordAudit("wallet_group.batch_delete_confirmed", {
      requestId,
      groupId,
      operationId: confirmation.operationId,
      deletedCount: deletedWalletIds.length,
      protectedCount: confirmation.protectedWalletIds.length,
    });
    this.#save();
    return {
      operationId: confirmation.operationId,
      status: "completed",
      deletedWalletIds,
      protectedWalletIds: confirmation.protectedWalletIds,
      recoveryStrategy: ZERO_BALANCE_RECOVERY,
    };
  }

  recordExportAttempt({ requestId, groupId, outcome }) {
    this.#requireGroup(groupId);
    this.#recordAudit("wallet_group.export_attempted", { requestId, groupId, outcome });
  }

  auditEvents() {
    return this.#audit.map(clone);
  }

  loginWalletBalance() {
    return "8420.00";
  }

  #seed() {
    const primary = this.createGroup({ name: "Core Launch", walletCount: 3 });
    const wallets = this.listWallets(primary.groupId);
    this.#wallets.get(wallets[1].walletId).balance = "42.50";
    this.createGroup({ name: "Research", walletCount: 2 });
    this.#audit = [];
  }

  #createWallet(groupId, sequence, balance) {
    const now = new Date().toISOString();
    const wallet = {
      walletId: randomUUID(),
      groupId,
      label: `Wallet ${sequence}`,
      publicAddress: `SIM-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
      balance,
      balanceAsset: "USD",
      custodyMode: "provider_managed_reference",
      provisioningStatus: "simulation_only",
      exportEligible: false,
      createdAt: now,
      updatedAt: now,
    };
    this.#wallets.set(wallet.walletId, wallet);
    return wallet;
  }

  #publicGroup(group) {
    const wallets = group.walletIds.map((walletId) => this.#wallets.get(walletId)).filter(Boolean);
    return {
      groupId: group.groupId,
      name: group.name,
      purpose: group.purpose,
      walletCount: wallets.length,
      totalBalance: addMoney(wallets.map(({ balance }) => balance)),
      balanceAsset: "USD",
      executionMode: wallets.length && wallets.every(({ provisioningStatus }) => provisioningStatus === "active") ? "encrypted_vault" : "simulation",
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  #publicWallet(wallet) {
    const { signerReferences: _signerReferences, ...publicWallet } = wallet;
    return clone(publicWallet);
  }

  #selectWallets(group, walletIds) {
    const selected = walletIds.map((walletId) => this.#wallets.get(walletId));
    if (selected.some((wallet) => !wallet || wallet.groupId !== group.groupId)) {
      throw new ApiError(404, "WALLET_NOT_FOUND", "One or more wallets were not found in the selected group");
    }
    return selected;
  }

  #requireGroup(groupId) {
    const group = this.#groups.get(groupId);
    if (!group) throw new ApiError(404, "WALLET_GROUP_NOT_FOUND", "Wallet group was not found");
    return group;
  }

  #recordAudit(type, data) {
    this.#audit.push({ auditId: randomUUID(), type, at: new Date().toISOString(), ...clone(data) });
  }

  #load() {
    if (!this.#filePath || !existsSync(this.#filePath)) return false;
    try {
      const payload = JSON.parse(readFileSync(this.#filePath, "utf8"));
      if (payload?.format !== "narraops-wallet-groups-v1" || !Array.isArray(payload.groups) || !Array.isArray(payload.wallets)) return false;
      this.#groups = new Map(payload.groups.map((group) => [group.groupId, group]));
      this.#wallets = new Map(payload.wallets.map((wallet) => [wallet.walletId, wallet]));
      return true;
    } catch {
      throw new ApiError(500, "WALLET_GROUP_STORE_CORRUPTED", "Wallet group metadata store cannot be read safely");
    }
  }

  #save() {
    if (!this.#filePath) return;
    mkdirSync(dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify({ format: "narraops-wallet-groups-v1", groups: [...this.#groups.values()], wallets: [...this.#wallets.values()] })}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#filePath);
  }
}
