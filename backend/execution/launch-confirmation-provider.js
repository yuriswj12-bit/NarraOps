import { Interface } from "ethers";
import { ExecutionError } from "./errors.js";

const tokenCreate = new Interface(["event TokenCreate(address creator,address token,uint256 requestId,string name,string symbol,uint256 totalSupply,uint256 launchTime,uint256 launchFee)"]);

export class LaunchConfirmationProvider {
  constructor({ solanaConnection, evmRpcClient, maxPolls = 30, pollIntervalMs = 2_000 } = {}) {
    this.solanaConnection = solanaConnection; this.evmRpcClient = evmRpcClient; this.maxPolls = maxPolls; this.pollIntervalMs = pollIntervalMs;
  }

  async wait({ platform, transactionHash, mintAddress }) {
    if (platform === "pump") {
      const result = await this.solanaConnection.confirmTransaction(transactionHash, "confirmed");
      if (result?.value?.err) throw new ExecutionError("LAUNCH_TRANSACTION_FAILED", "Pump launch transaction failed", { transactionHash });
      const blockNumber = typeof this.solanaConnection.getSlot === "function" ? await this.solanaConnection.getSlot("confirmed") : null;
      return { status: "confirmed", tokenAddress: mintAddress, transactionHash, blockNumber };
    }
    for (let attempt = 1; attempt <= this.maxPolls; attempt += 1) {
      const receipt = await this.evmRpcClient.request("eth_getTransactionReceipt", [transactionHash]);
      if (receipt) {
        if (BigInt(receipt.status) !== 1n) throw new ExecutionError("LAUNCH_TRANSACTION_FAILED", "Four.Meme launch transaction reverted", { transactionHash });
        for (const log of receipt.logs || []) {
          try {
            const parsed = tokenCreate.parseLog(log);
            if (parsed?.name === "TokenCreate") return { status: "confirmed", tokenAddress: parsed.args.token, transactionHash, blockNumber: receipt.blockNumber };
          } catch {}
        }
        throw new ExecutionError("TOKEN_ADDRESS_NOT_FOUND", "Four.Meme TokenCreate event was not found in the confirmed receipt", { transactionHash });
      }
      if (attempt < this.maxPolls) await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new ExecutionError("CONFIRMATION_TIMEOUT", "Launch transaction was not confirmed within the polling limit", { transactionHash });
  }

  async waitForBoundBuyBlock({ platform, launchBlockNumber, blockOffset, deadlineBlocks = 5 }) {
    if (!Number.isInteger(blockOffset) || blockOffset < 1 || blockOffset > 5) throw new ExecutionError("BOUND_BUY_BLOCK_OFFSET_INVALID", "Bound-buy block offset must be between T1 and T5");
    if (launchBlockNumber === null || launchBlockNumber === undefined) throw new ExecutionError("LAUNCH_BLOCK_UNKNOWN", "Launch block is required for delayed bound buys");
    const targetBlock = BigInt(launchBlockNumber) + BigInt(blockOffset);
    const finalBlock = targetBlock + BigInt(deadlineBlocks);
    for (let attempt = 1; attempt <= this.maxPolls; attempt += 1) {
      const current = platform === "pump"
        ? BigInt(await this.solanaConnection.getSlot("confirmed"))
        : BigInt(await this.evmRpcClient.request("eth_blockNumber", []));
      if (current > finalBlock) throw new ExecutionError("BOUND_BUY_WINDOW_EXPIRED", "Launch-bound-buy block window expired", { targetBlock: targetBlock.toString(), currentBlock: current.toString() });
      if (current >= targetBlock) return { targetBlock: targetBlock.toString(), observedBlock: current.toString() };
      if (attempt < this.maxPolls) await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new ExecutionError("BOUND_BUY_BLOCK_TIMEOUT", "Target block was not reached within the polling limit", { targetBlock: targetBlock.toString() });
  }
}
