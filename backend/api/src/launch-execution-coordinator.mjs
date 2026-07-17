import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.mjs";
import { parseUnits } from "ethers";

const digest = (value) => createHash("sha256").update(value).digest();

export class LaunchExecutionCoordinator {
  constructor({ launchService, signingService, walletGroupRepository, vaultPassword, confirmationProvider, followBuyExecutor, repository, now = () => Date.now() }) {
    this.launchService = launchService;
    this.signingService = signingService;
    this.walletGroups = walletGroupRepository;
    this.vaultPassword = vaultPassword;
    this.now = now;
    this.confirmationProvider = confirmationProvider;
    this.followBuyExecutor = followBuyExecutor;
    this.repository = repository;
  }

  async prepare(input) {
    if (!this.vaultPassword) throw new ApiError(503, "WALLET_VAULT_LOCKED", "Wallet vault password is not configured");
    const chain = input.platform === "pump" ? "solana" : "bsc";
    const cooking = this.walletGroups.getSigningWallet(input.cookingWalletGroupId, chain);
    let loginSignature = input.loginSignature;
    if (input.platform === "fourmeme") {
      const challenge = await this.launchService.requestFourMemeLogin({ address: cooking.publicAddress });
      loginSignature = await this.signingService.signEvmMessage({ walletReferenceId: cooking.walletReferenceId, password: this.vaultPassword, message: challenge.message });
    }
    const plan = await this.launchService.plan({ ...input, walletAddress: cooking.publicAddress, loginSignature });
    const executionId = randomUUID();
    const confirmationToken = randomUUID();
    const expiresAt = this.now() + 5 * 60_000;
    this.repository.create({ executionId, platform: input.platform, plan, walletReferenceId: cooking.walletReferenceId, boundBuy: input.boundBuy, tokenHash: digest(confirmationToken).toString("hex"), expiresAt, status: "requires_user_confirmation", createdAt: new Date(this.now()).toISOString() });
    return { executionId, platform: input.platform, chain, status: "requires_user_confirmation", confirmationToken, expiresAt: new Date(expiresAt).toISOString(), summary: { name: input.name, symbol: input.symbol, developerBuyAmount: input.developerBuyAmount, cookingWalletGroupId: input.cookingWalletGroupId, boundBuy: input.boundBuy } };
  }

  async confirm({ executionId, confirmationToken }) {
    let execution = this.repository.get(executionId);
    if (!execution) throw new ApiError(404, "LAUNCH_EXECUTION_NOT_FOUND", "Launch execution was not found");
    if (execution.status !== "requires_user_confirmation") throw new ApiError(409, "LAUNCH_EXECUTION_ALREADY_USED", "Launch execution is no longer awaiting confirmation");
    if (execution.expiresAt <= this.now()) throw new ApiError(410, "CONFIRMATION_EXPIRED", "Launch confirmation expired");
    const supplied = digest(String(confirmationToken || ""));
    if (!timingSafeEqual(supplied, Buffer.from(execution.tokenHash, "hex"))) throw new ApiError(403, "CONFIRMATION_INVALID", "Launch confirmation token is invalid");
    execution = this.repository.update(executionId, { status: "signing" });
    try {
      const result = await this.signingService.signAndBroadcast({ platform: execution.platform, plan: execution.plan, walletReferenceId: execution.walletReferenceId, password: this.vaultPassword });
      execution = this.repository.update(executionId, { status: "confirming_launch", transactionHash: result.transactionHash, mintAddress: result.mintAddress }, "launch.submitted");
      const confirmation = await this.confirmationProvider.wait({ platform: execution.platform, transactionHash: result.transactionHash, mintAddress: result.mintAddress });
      execution = this.repository.update(executionId, { status: "launch_confirmed", tokenAddress: confirmation.tokenAddress, launchBlockNumber: confirmation.blockNumber }, "launch.confirmed");
      if (!execution.boundBuy?.enabled) {
        execution = this.repository.update(executionId, { status: "confirmed", boundBuys: [] }, "launch.completed");
        return { executionId, ...result, tokenAddress: confirmation.tokenAddress, status: execution.status, boundBuys: [] };
      }
      const chain = execution.platform === "pump" ? "solana" : "bsc";
      const wallets = this.walletGroups.getExecutionWallets(execution.boundBuy.walletGroupId, chain);
      const decimals = execution.platform === "pump" ? 9 : 18;
      const sourceAllocation = execution.boundBuy.allocation;
      const allocation = sourceAllocation.mode === "PER_WALLET_EQUAL"
        ? { mode: sourceAllocation.mode, amountPerWalletAtomic: parseUnits(sourceAllocation.amountPerWallet, decimals).toString() }
        : { mode: sourceAllocation.mode, customAmountsAtomic: sourceAllocation.customAmounts.map(({ walletId, amount }) => ({ walletId, amountAtomic: parseUnits(amount, decimals).toString() })) };
      execution = this.repository.update(executionId, { status: "waiting_bound_buy_block" }, "bound_buys.waiting_for_block");
      const timing = await this.confirmationProvider.waitForBoundBuyWindow({ platform: execution.platform, launchBlockNumber: confirmation.blockNumber });
      execution = this.repository.update(executionId, { status: "bound_buy_signing", boundBuyEarliestBlock: timing.earliestBlock, boundBuyLatestBlock: timing.latestBlock, boundBuyObservedBlock: timing.observedBlock, boundBuyActualOffset: timing.actualOffset });
      const boundBuys = await this.followBuyExecutor.execute({ platform: execution.platform, tokenAddress: confirmation.tokenAddress, wallets, allocation, password: this.vaultPassword, slippageBps: execution.boundBuy.slippageBps });
      const failedCount = boundBuys.filter(({ status }) => status === "failed").length;
      const status = failedCount === 0 ? "bound_buys_submitted" : failedCount === boundBuys.length ? "failed" : "partially_failed";
      execution = this.repository.update(executionId, { status, boundBuys }, "bound_buys.submitted");
      return { executionId, ...result, tokenAddress: confirmation.tokenAddress, status: execution.status, boundBuys };
    } catch (error) {
      this.repository.update(executionId, { status: "failed", failure: { code: error.code || "LAUNCH_EXECUTION_FAILED", message: error.message } }, "launch.failed");
      throw error;
    }
  }

  getStatus(executionId) {
    const execution = this.repository.get(executionId);
    if (!execution) throw new ApiError(404, "LAUNCH_EXECUTION_NOT_FOUND", "Launch execution was not found");
    const { plan: _plan, tokenHash: _tokenHash, walletReferenceId: _walletReferenceId, ...publicExecution } = execution;
    return publicExecution;
  }

  markInterruptedExecutions() {
    for (const execution of this.repository.recoverable()) {
      this.repository.update(execution.executionId, { status: "recovery_required", recoveryFromStatus: execution.status }, "launch.recovery_required");
    }
  }

  async retryFailedFollowBuys({ executionId, confirmRetry }) {
    if (confirmRetry !== true) throw new ApiError(400, "RETRY_CONFIRMATION_REQUIRED", "confirmRetry must be true");
    let execution = this.repository.get(executionId);
    if (!execution) throw new ApiError(404, "LAUNCH_EXECUTION_NOT_FOUND", "Launch execution was not found");
    const failed = (execution.boundBuys || []).filter(({ status }) => status === "failed");
    if (!failed.length || !["failed", "partially_failed"].includes(execution.status)) throw new ApiError(409, "NO_RETRYABLE_BOUND_BUYS", "No failed launch-bound buys are available for safe retry");
    const chain = execution.platform === "pump" ? "solana" : "bsc";
    const wallets = this.walletGroups.getExecutionWallets(execution.boundBuy.walletGroupId, chain);
    const retryResults = [];
    execution = this.repository.update(executionId, { status: "bound_buy_retrying" }, "bound_buys.retry_started");
    for (const failedBuy of failed) {
      const wallet = wallets.find(({ walletId }) => walletId === failedBuy.walletId);
      if (!wallet) continue;
      const [result] = await this.followBuyExecutor.execute({ platform: execution.platform, tokenAddress: execution.tokenAddress, wallets: [wallet], allocation: { mode: "PER_WALLET_EQUAL", amountPerWalletAtomic: failedBuy.amountAtomic }, password: this.vaultPassword, slippageBps: execution.boundBuy.slippageBps });
      retryResults.push(result);
    }
    const replacements = new Map(retryResults.map((result) => [result.walletId, result]));
    const boundBuys = execution.boundBuys.map((result) => replacements.get(result.walletId) || result);
    const remainingFailures = boundBuys.filter(({ status }) => status === "failed").length;
    const status = remainingFailures === 0 ? "bound_buys_submitted" : remainingFailures === boundBuys.length ? "failed" : "partially_failed";
    this.repository.update(executionId, { status, boundBuys }, "bound_buys.retry_completed");
    return this.getStatus(executionId);
  }
}
