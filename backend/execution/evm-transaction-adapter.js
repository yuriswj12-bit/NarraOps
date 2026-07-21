import { Transaction, Wallet, getAddress } from "ethers";
import { ExecutionError } from "./errors.js";

function quantity(value) {
  return `0x${BigInt(value).toString(16)}`;
}

export class EvmJsonRpcClient {
  constructor({ rpcUrl, fetchImpl = fetch }) {
    this.rpcUrl = rpcUrl;
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
  }

  async request(method, params = []) {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });
    if (!response.ok) throw new ExecutionError("RPC_UNAVAILABLE", `EVM RPC returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new ExecutionError("RPC_ERROR", payload.error.message || "EVM RPC error", { rpcCode: payload.error.code });
    return payload.result;
  }
}

export class EvmTransactionAdapter {
  constructor({ rpcClient, chainId = 4663, executionEnabled = false }) {
    this.rpcClient = rpcClient;
    this.chainId = Number(chainId);
    this.executionEnabled = executionEnabled;
  }

  async signTransaction({ transaction, privateKey }) {
    const wallet = new Wallet(privateKey.toString("utf8"));
    if (getAddress(wallet.address) !== getAddress(transaction.from)) {
      throw new ExecutionError("SIGNER_ADDRESS_MISMATCH", "Decrypted wallet does not match transaction sender");
    }
    const remoteChainId = Number(BigInt(await this.rpcClient.request("eth_chainId")));
    if (remoteChainId !== this.chainId || Number(transaction.chainId) !== this.chainId) {
      throw new ExecutionError("CHAIN_ID_MISMATCH", "RPC or transaction chain does not match the configured chain");
    }
    const nonce = transaction.nonce ?? await this.rpcClient.request("eth_getTransactionCount", [wallet.address, "pending"]);
    const gasPrice = transaction.gasPrice ?? await this.rpcClient.request("eth_gasPrice");
    const estimateRequest = {
      from: wallet.address,
      to: transaction.to,
      value: quantity(transaction.value),
      data: transaction.data || "0x",
    };
    const estimatedGas = transaction.gasLimit ?? await this.rpcClient.request("eth_estimateGas", [estimateRequest]);
    const gasLimit = (BigInt(estimatedGas) * 120n) / 100n;
    return wallet.signTransaction({
      type: 0,
      chainId: this.chainId,
      nonce: BigInt(nonce),
      to: transaction.to,
      value: BigInt(transaction.value),
      data: transaction.data || "0x",
      gasPrice: BigInt(gasPrice),
      gasLimit,
    });
  }

  async broadcastTransaction({ signedTransaction }) {
    if (!this.executionEnabled) throw new ExecutionError("REAL_EXECUTION_DISABLED", "Real EVM broadcasting is disabled");
    const transactionHash = await this.rpcClient.request("eth_sendRawTransaction", [signedTransaction]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash || "")) throw new ExecutionError("RPC_INVALID_RESPONSE", "RPC did not return a transaction hash");
    return transactionHash.toLowerCase();
  }

  parseSignedTransaction(signedTransaction) {
    return Transaction.from(signedTransaction);
  }
}

