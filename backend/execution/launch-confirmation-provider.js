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
      return { status: "confirmed", tokenAddress: mintAddress, transactionHash };
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
}
