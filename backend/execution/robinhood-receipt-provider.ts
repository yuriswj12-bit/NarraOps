// @ts-nocheck
import { ExecutionError } from "./errors.ts";

export class RobinhoodReceiptProvider {
  constructor({ rpcUrl = "https://rpc.mainnet.chain.robinhood.com", fetchImpl = fetch, maxPolls = 30, pollIntervalMs = 2_000 } = {}) {
    this.rpcUrl = rpcUrl;
    this.fetchImpl = fetchImpl;
    this.maxPolls = maxPolls;
    this.pollIntervalMs = pollIntervalMs;
  }

  async waitForReceipt(transactionHash) {
    for (let attempt = 1; attempt <= this.maxPolls; attempt += 1) {
      const response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: attempt, method: "eth_getTransactionReceipt", params: [transactionHash] }),
      });
      if (!response.ok) throw new ExecutionError("RPC_UNAVAILABLE", `Robinhood RPC returned HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new ExecutionError("RPC_ERROR", payload.error.message || "Robinhood RPC error", { rpcCode: payload.error.code });
      if (payload.result) return payload.result;
      if (attempt < this.maxPolls) await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new ExecutionError("CONFIRMATION_TIMEOUT", "Transaction was not confirmed within the polling limit", { transactionHash });
  }
}
