import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "./errors.mjs";
import { formatUnits, parseUnits } from "ethers";

const digest = (value) => createHash("sha256").update(value).digest();
const PUMP_LAUNCH_RESERVED_LAMPORTS = 30_000_000n;
const PUMP_BOUND_BUY_RESERVED_LAMPORTS = 5_000_000n;

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
    if (input.platform === "pump") await this.assertPumpCookingWalletCanLaunch({ address: cooking.publicAddress, developerBuyAmount: input.developerBuyAmount });
    let loginSignature = input.loginSignature;
    if (input.platform === "fourmeme") {
      const challenge = await this.launchService.requestFourMemeLogin({ address: cooking.publicAddress });
      loginSignature = await this.signingService.signEvmMessage({ walletReferenceId: cooking.walletReferenceId, password: this.vaultPassword, message: challenge.message });
    }
    const executionId = randomUUID();
    let preparedBoundBuys = [];
    if (input.boundBuy.enabled) {
      if (!this.followBuyExecutor) throw new ApiError(503, "BOUND_BUY_EXECUTION_UNAVAILABLE", "Launch-bound-buy execution is not configured");
      const wallets = this.walletGroups.getExecutionWallets(input.boundBuy.walletGroupId, chain);
      const decimals = input.platform === "pump" ? 9 : 18;
      const source = input.boundBuy.allocation;
      const allocation = source.mode === "PER_WALLET_EQUAL"
        ? { mode: source.mode, amountPerWalletAtomic: parseUnits(source.amountPerWallet, decimals).toString() }
        : source.mode === "TOTAL_RANDOM"
          ? { mode: source.mode, totalAmountAtomic: parseUnits(source.totalAmount, decimals).toString(), seed: executionId }
          : { mode: source.mode, customAmountsAtomic: source.customAmounts.map(({ walletId, amount }) => ({ walletId, amountAtomic: parseUnits(amount, decimals).toString() })) };
      preparedBoundBuys = this.followBuyExecutor.prepareAllocation({ wallets, allocation }).map(({ walletId, amountAtomic }) => ({ walletId, amountAtomic, amount: formatUnits(amountAtomic, decimals), status: "planned" }));
      if (input.platform === "pump") await this.assertPumpBoundBuyWalletsCanBuy({ wallets, preparedBoundBuys });
    }
    const plan = await this.launchService.plan({ ...input, walletAddress: cooking.publicAddress, loginSignature });
    const confirmationToken = randomUUID();
    const expiresAt = this.now() + 5 * 60_000;
    this.repository.create({ executionId, platform: input.platform, plan, walletReferenceId: cooking.walletReferenceId, boundBuy: input.boundBuy, preparedBoundBuys, tokenHash: digest(confirmationToken).toString("hex"), expiresAt, status: "requires_user_confirmation", createdAt: new Date(this.now()).toISOString() });
    return { executionId, platform: input.platform, chain, status: "requires_user_confirmation", confirmationToken, expiresAt: new Date(expiresAt).toISOString(), summary: { name: input.name, symbol: input.symbol, developerBuyAmount: input.developerBuyAmount, cookingWalletGroupId: input.cookingWalletGroupId, boundBuy: input.boundBuy, preparedBoundBuys } };
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
      const allocation = { mode: "PER_WALLET_CUSTOM", customAmountsAtomic: execution.preparedBoundBuys.map(({ walletId, amountAtomic }) => ({ walletId, amountAtomic })) };
      execution = this.repository.update(executionId, { status: "bound_buy_signing" }, "bound_buys.signing");
      try {
        const boundBuys = await this.followBuyExecutor.execute({ platform: execution.platform, tokenAddress: confirmation.tokenAddress, wallets, allocation, password: this.vaultPassword, slippageBps: execution.boundBuy.slippageBps });
        const failedCount = boundBuys.filter(({ status }) => status === "failed").length;
        const status = failedCount === 0 ? "bound_buys_submitted" : failedCount === boundBuys.length ? "bound_buys_failed" : "partially_failed";
        execution = this.repository.update(executionId, { status, boundBuys }, "bound_buys.submitted");
        return { executionId, ...result, tokenAddress: confirmation.tokenAddress, status: execution.status, boundBuys };
      } catch (error) {
        execution = this.repository.update(executionId, {
          status: "bound_buys_failed",
          boundBuys: execution.preparedBoundBuys.map((buy) => ({ ...buy, status: "failed", error: error.message })),
          boundBuyFailure: { code: error.code || "BOUND_BUY_EXECUTION_FAILED", message: error.message },
        }, "bound_buys.failed");
        return { executionId, ...result, tokenAddress: confirmation.tokenAddress, status: execution.status, boundBuys: execution.boundBuys, boundBuyFailure: execution.boundBuyFailure };
      }
    } catch (error) {
      this.repository.update(executionId, { status: "failed", failure: { code: error.code || "LAUNCH_EXECUTION_FAILED", message: error.message } }, "launch.failed");
      throw error;
    }
  }

  async assertPumpCookingWalletCanLaunch({ address, developerBuyAmount }) {
    const connection = this.launchService?.pump?.connection;
    if (!connection) return;
    let lamports;
    try {
      lamports = BigInt(await connection.getBalance(new PublicKey(address), "confirmed"));
    } catch (error) {
      throw new ApiError(502, "SOLANA_BALANCE_READ_FAILED", `读取 Cooking 钱包 SOL 余额失败：${error.message}`);
    }
    const developerBuyLamports = BigInt(parseUnits(String(developerBuyAmount || "0"), 9).toString());
    const required = developerBuyLamports + PUMP_LAUNCH_RESERVED_LAMPORTS;
    if (lamports < required) {
      throw new ApiError(
        400,
        "COOKING_WALLET_INSUFFICIENT_SOL",
        `Cooking 钱包 SOL 不足：当前 ${formatUnits(lamports, 9)} SOL，至少需要约 ${formatUnits(required, 9)} SOL。请降低 Cooking 钱包买入金额，或充值后再发射。`,
        { currentLamports: lamports.toString(), requiredLamports: required.toString(), reserveLamports: PUMP_LAUNCH_RESERVED_LAMPORTS.toString() },
      );
    }
  }

  async assertPumpBoundBuyWalletsCanBuy({ wallets, preparedBoundBuys }) {
    const connection = this.launchService?.pump?.connection;
    if (!connection || !preparedBoundBuys.length) return;
    const amountByWalletId = new Map(preparedBoundBuys.map(({ walletId, amountAtomic }) => [walletId, BigInt(amountAtomic)]));
    const insufficient = [];
    for (const wallet of wallets) {
      const buyLamports = amountByWalletId.get(wallet.walletId);
      if (!buyLamports) continue;
      let lamports;
      try {
        lamports = BigInt(await connection.getBalance(new PublicKey(wallet.publicAddress), "confirmed"));
      } catch (error) {
        throw new ApiError(502, "SOLANA_BALANCE_READ_FAILED", `读取 T1-T5 买入钱包 SOL 余额失败：${error.message}`);
      }
      const required = buyLamports + PUMP_BOUND_BUY_RESERVED_LAMPORTS;
      if (lamports < required) {
        insufficient.push({
          walletId: wallet.walletId,
          address: wallet.publicAddress,
          currentLamports: lamports.toString(),
          requiredLamports: required.toString(),
          buyLamports: buyLamports.toString(),
          reserveLamports: PUMP_BOUND_BUY_RESERVED_LAMPORTS.toString(),
          current: formatUnits(lamports, 9),
          required: formatUnits(required, 9),
          buyAmount: formatUnits(buyLamports, 9),
        });
      }
    }
    if (insufficient.length) {
      const first = insufficient[0];
      throw new ApiError(
        400,
        "BOUND_BUY_WALLET_INSUFFICIENT_SOL",
        `T1-T5 买入钱包 SOL 不足：${insufficient.length}/${preparedBoundBuys.length} 个钱包余额不够。第一个不足钱包当前 ${first.current} SOL，本次买入 ${first.buyAmount} SOL，至少需要约 ${first.required} SOL。请降低买入金额，或先给买入钱包组充值/分发 SOL 后再发射。`,
        { insufficient },
      );
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
    if (!failed.length || !["bound_buys_failed", "partially_failed"].includes(execution.status)) throw new ApiError(409, "NO_RETRYABLE_BOUND_BUYS", "No failed launch-bound buys are available for safe retry");
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
    const status = remainingFailures === 0 ? "bound_buys_submitted" : remainingFailures === boundBuys.length ? "bound_buys_failed" : "partially_failed";
    this.repository.update(executionId, { status, boundBuys }, "bound_buys.retry_completed");
    return this.getStatus(executionId);
  }
}
