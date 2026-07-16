import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors.mjs";

const digest = (value) => createHash("sha256").update(value).digest();

export class LaunchExecutionCoordinator {
  constructor({ launchService, signingService, walletGroupRepository, vaultPassword, now = () => Date.now() }) {
    this.launchService = launchService;
    this.signingService = signingService;
    this.walletGroups = walletGroupRepository;
    this.vaultPassword = vaultPassword;
    this.now = now;
    this.executions = new Map();
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
    this.executions.set(executionId, { executionId, platform: input.platform, plan, walletReferenceId: cooking.walletReferenceId, tokenHash: digest(confirmationToken), expiresAt, status: "requires_user_confirmation" });
    return { executionId, platform: input.platform, chain, status: "requires_user_confirmation", confirmationToken, expiresAt: new Date(expiresAt).toISOString(), summary: { name: input.name, symbol: input.symbol, developerBuyAmount: input.developerBuyAmount, cookingWalletGroupId: input.cookingWalletGroupId, buyingWalletGroupId: input.buyingWalletGroupId, walletGroupBuyAmount: input.walletGroupBuyAmount } };
  }

  async confirm({ executionId, confirmationToken }) {
    const execution = this.executions.get(executionId);
    if (!execution) throw new ApiError(404, "LAUNCH_EXECUTION_NOT_FOUND", "Launch execution was not found");
    if (execution.status !== "requires_user_confirmation") throw new ApiError(409, "LAUNCH_EXECUTION_ALREADY_USED", "Launch execution is no longer awaiting confirmation");
    if (execution.expiresAt <= this.now()) throw new ApiError(410, "CONFIRMATION_EXPIRED", "Launch confirmation expired");
    const supplied = digest(String(confirmationToken || ""));
    if (!timingSafeEqual(supplied, execution.tokenHash)) throw new ApiError(403, "CONFIRMATION_INVALID", "Launch confirmation token is invalid");
    execution.status = "signing";
    try {
      const result = await this.signingService.signAndBroadcast({ platform: execution.platform, plan: execution.plan, walletReferenceId: execution.walletReferenceId, password: this.vaultPassword });
      execution.status = result.status;
      execution.transactionHash = result.transactionHash;
      return { executionId, ...result };
    } catch (error) {
      execution.status = "failed";
      throw error;
    }
  }
}
