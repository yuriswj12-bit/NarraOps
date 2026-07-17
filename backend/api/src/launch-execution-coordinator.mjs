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
    this.repository.create({ executionId, platform: input.platform, plan, walletReferenceId: cooking.walletReferenceId, buyingWalletGroupId: input.buyingWalletGroupId, walletGroupBuyAmount: input.walletGroupBuyAmount, buyCondition: input.buyCondition, tokenHash: digest(confirmationToken).toString("hex"), expiresAt, status: "requires_user_confirmation", createdAt: new Date(this.now()).toISOString() });
    return { executionId, platform: input.platform, chain, status: "requires_user_confirmation", confirmationToken, expiresAt: new Date(expiresAt).toISOString(), summary: { name: input.name, symbol: input.symbol, developerBuyAmount: input.developerBuyAmount, cookingWalletGroupId: input.cookingWalletGroupId, buyingWalletGroupId: input.buyingWalletGroupId, walletGroupBuyAmount: input.walletGroupBuyAmount, buyCondition: input.buyCondition } };
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
      execution = this.repository.update(executionId, { status: "launch_confirmed", tokenAddress: confirmation.tokenAddress }, "launch.confirmed");
      const chain = execution.platform === "pump" ? "solana" : "bsc";
      const wallets = this.walletGroups.getExecutionWallets(execution.buyingWalletGroupId, chain);
      const decimals = execution.platform === "pump" ? 9 : 18;
      const totalAmountAtomic = parseUnits(execution.walletGroupBuyAmount, decimals).toString();
      execution = this.repository.update(executionId, { status: "follow_buy_signing" });
      const followBuys = BigInt(totalAmountAtomic) > 0n ? await this.followBuyExecutor.execute({ platform: execution.platform, tokenAddress: confirmation.tokenAddress, wallets, totalAmountAtomic, password: this.vaultPassword, distributionMode: execution.buyCondition, distributionSeed: execution.executionId }) : [];
      const failedCount = followBuys.filter(({ status }) => status === "failed").length;
      const status = failedCount === 0 ? (followBuys.length ? "follow_buys_submitted" : "confirmed") : failedCount === followBuys.length ? "failed" : "partially_failed";
      execution = this.repository.update(executionId, { status, followBuys }, "follow_buys.submitted");
      return { executionId, ...result, tokenAddress: confirmation.tokenAddress, status: execution.status, followBuys };
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
    const failed = (execution.followBuys || []).filter(({ status }) => status === "failed");
    if (!failed.length || !["failed", "partially_failed"].includes(execution.status)) throw new ApiError(409, "NO_RETRYABLE_FOLLOW_BUYS", "No failed follow buys are available for safe retry");
    const chain = execution.platform === "pump" ? "solana" : "bsc";
    const wallets = this.walletGroups.getExecutionWallets(execution.buyingWalletGroupId, chain);
    const retryResults = [];
    execution = this.repository.update(executionId, { status: "follow_buy_retrying" }, "follow_buys.retry_started");
    for (const failedBuy of failed) {
      const wallet = wallets.find(({ walletId }) => walletId === failedBuy.walletId);
      if (!wallet) continue;
      const [result] = await this.followBuyExecutor.execute({ platform: execution.platform, tokenAddress: execution.tokenAddress, wallets: [wallet], totalAmountAtomic: failedBuy.amountAtomic, password: this.vaultPassword });
      retryResults.push(result);
    }
    const replacements = new Map(retryResults.map((result) => [result.walletId, result]));
    const followBuys = execution.followBuys.map((result) => replacements.get(result.walletId) || result);
    const remainingFailures = followBuys.filter(({ status }) => status === "failed").length;
    const status = remainingFailures === 0 ? "follow_buys_submitted" : remainingFailures === followBuys.length ? "failed" : "partially_failed";
    this.repository.update(executionId, { status, followBuys }, "follow_buys.retry_completed");
    return this.getStatus(executionId);
  }
}
