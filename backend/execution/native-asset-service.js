import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { formatEther, getAddress, parseEther, Wallet } from "ethers";
import { openWalletSecret } from "./encrypted-wallet-vault.js";
import { ExecutionError } from "./errors.js";

function decimalToLamports(value) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,9})?$/.test(text)) throw new ExecutionError("INVALID_AMOUNT", "SOL amount must contain at most 9 decimals");
  const [whole, fraction = ""] = text.split(".");
  return (BigInt(whole) * 1_000_000_000n) + BigInt(fraction.padEnd(9, "0"));
}

function lamportsToDecimal(value) {
  const amount = BigInt(value);
  const fraction = String(amount % 1_000_000_000n).padStart(9, "0").replace(/0+$/, "");
  return `${amount / 1_000_000_000n}${fraction ? `.${fraction}` : ""}`;
}

export class NativeAssetService {
  constructor({ walletRepository, vaultPassword, solanaConnection, evmChains = {}, executionEnabled = false }) {
    this.walletRepository = walletRepository;
    this.vaultPassword = vaultPassword;
    this.solanaConnection = solanaConnection;
    this.evmChains = evmChains;
    this.executionEnabled = executionEnabled;
  }

  async balances(wallet) {
    const result = {};
    if (wallet?.addresses?.solana && this.solanaConnection) {
      try {
        const lamports = await this.solanaConnection.getBalance(new PublicKey(wallet.addresses.solana), "confirmed");
        result.solana = { chain: "solana", asset: "SOL", amount: lamportsToDecimal(lamports), atomic: String(lamports), status: "live" };
      } catch {
        result.solana = { chain: "solana", asset: "SOL", amount: null, atomic: null, status: "unavailable" };
      }
    }
    for (const [chain, config] of Object.entries(this.evmChains)) {
      const address = wallet?.addresses?.[chain];
      if (!address) continue;
      try {
        const atomic = BigInt(await config.rpcClient.request("eth_getBalance", [getAddress(address), "latest"]));
        result[chain] = { chain, asset: config.asset, amount: formatEther(atomic), atomic: String(atomic), status: "live" };
      } catch {
        result[chain] = { chain, asset: config.asset, amount: null, atomic: null, status: "unavailable" };
      }
    }
    return result;
  }

  async transfer({ chain, walletReferenceId, from, to, amount }) {
    if (!this.executionEnabled) throw new ExecutionError("REAL_EXECUTION_DISABLED", "Real asset broadcasting is disabled");
    const envelope = await this.walletRepository.getEncryptedWallet(walletReferenceId);
    if (!envelope || envelope.publicAddress.toLowerCase() !== String(from).toLowerCase()) {
      throw new ExecutionError("WALLET_NOT_FOUND", "Encrypted wallet reference does not match the sender");
    }
    const password = Buffer.from(this.vaultPassword, "utf8");
    const privateKey = openWalletSecret(envelope, password);
    try {
      if (chain === "solana") return await this.#transferSolana({ from, to, amount, privateKey });
      return await this.#transferEvm({ chain, from, to, amount, privateKey });
    } finally {
      privateKey.fill(0);
      password.fill(0);
    }
  }

  async transferBatch({ chain, walletReferenceId, from, transfers }) {
    if (!this.executionEnabled) throw new ExecutionError("REAL_EXECUTION_DISABLED", "Real asset broadcasting is disabled");
    if (!Array.isArray(transfers) || transfers.length === 0) throw new ExecutionError("EMPTY_TRANSFER_BATCH", "Transfer batch is empty");
    const envelope = await this.walletRepository.getEncryptedWallet(walletReferenceId);
    if (!envelope || envelope.publicAddress.toLowerCase() !== String(from).toLowerCase()) {
      throw new ExecutionError("WALLET_NOT_FOUND", "Encrypted wallet reference does not match the sender");
    }
    const password = Buffer.from(this.vaultPassword, "utf8");
    const privateKey = openWalletSecret(envelope, password);
    try {
      if (chain === "solana") return await this.#transferSolanaBatch({ from, transfers, privateKey });
      const results = [];
      for (const transfer of transfers) {
        results.push(await this.#transferEvm({ chain, from, to: transfer.to, amount: transfer.amount, privateKey }));
      }
      return results;
    } finally {
      privateKey.fill(0);
      password.fill(0);
    }
  }

  async #transferSolana({ from, to, amount, privateKey }) {
    const lamports = decimalToLamports(amount);
    if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new ExecutionError("INVALID_AMOUNT", "SOL transfer amount is outside the supported range");
    const secret = Buffer.from(privateKey.toString("utf8"), "base64");
    try {
      const signer = Keypair.fromSecretKey(secret);
      if (signer.publicKey.toBase58() !== new PublicKey(from).toBase58()) throw new ExecutionError("SIGNER_ADDRESS_MISMATCH", "Solana signer does not match sender");
      const latest = await this.solanaConnection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: signer.publicKey, ...latest }).add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(to), lamports: Number(lamports) }));
      transaction.sign(signer);
      const signature = await this.solanaConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
      const confirmation = await this.solanaConnection.confirmTransaction({ signature, ...latest }, "confirmed");
      if (confirmation.value.err) throw new ExecutionError("TRANSACTION_FAILED", "Solana transfer was rejected", { signature, error: confirmation.value.err });
      return { chain: "solana", asset: "SOL", amount: lamportsToDecimal(lamports), txHash: signature, status: "confirmed" };
    } finally {
      secret.fill(0);
    }
  }

  async #transferSolanaBatch({ from, transfers, privateKey }) {
    const secret = Buffer.from(privateKey.toString("utf8"), "base64");
    try {
      const signer = Keypair.fromSecretKey(secret);
      if (signer.publicKey.toBase58() !== new PublicKey(from).toBase58()) throw new ExecutionError("SIGNER_ADDRESS_MISMATCH", "Solana signer does not match sender");
      const latest = await this.solanaConnection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: signer.publicKey, ...latest });
      const normalized = transfers.map((transfer) => {
        const lamports = decimalToLamports(transfer.amount);
        if (lamports <= 0n || lamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new ExecutionError("INVALID_AMOUNT", "SOL transfer amount is outside the supported range");
        transaction.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(transfer.to), lamports: Number(lamports) }));
        return { ...transfer, lamports };
      });
      transaction.sign(signer);
      const signature = await this.solanaConnection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
      const confirmation = await this.solanaConnection.confirmTransaction({ signature, ...latest }, "confirmed");
      if (confirmation.value.err) throw new ExecutionError("TRANSACTION_FAILED", "Solana transfer batch was rejected", { signature, error: confirmation.value.err });
      return normalized.map((transfer) => ({
        chain: "solana",
        asset: "SOL",
        amount: lamportsToDecimal(transfer.lamports),
        txHash: signature,
        status: "confirmed",
      }));
    } finally {
      secret.fill(0);
    }
  }

  async #transferEvm({ chain, from, to, amount, privateKey }) {
    const config = this.evmChains[chain];
    if (!config) throw new ExecutionError("UNSUPPORTED_CHAIN", `Native transfers are not configured for ${chain}`);
    const wallet = new Wallet(privateKey.toString("utf8"));
    if (getAddress(wallet.address) !== getAddress(from)) throw new ExecutionError("SIGNER_ADDRESS_MISMATCH", "EVM signer does not match sender");
    const value = parseEther(String(amount));
    const nonce = BigInt(await config.rpcClient.request("eth_getTransactionCount", [wallet.address, "pending"]));
    const gasPrice = BigInt(await config.rpcClient.request("eth_gasPrice"));
    const gasEstimate = BigInt(await config.rpcClient.request("eth_estimateGas", [{ from: wallet.address, to: getAddress(to), value: `0x${value.toString(16)}` }]));
    const signed = await wallet.signTransaction({ type: 0, chainId: config.chainId, nonce, to: getAddress(to), value, gasPrice, gasLimit: (gasEstimate * 120n) / 100n });
    const txHash = await config.rpcClient.request("eth_sendRawTransaction", [signed]);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const receipt = await config.rpcClient.request("eth_getTransactionReceipt", [txHash]);
      if (receipt) {
        if (BigInt(receipt.status) !== 1n) throw new ExecutionError("TRANSACTION_FAILED", "EVM transfer reverted", { txHash });
        return { chain, asset: config.asset, amount: formatEther(value), txHash: txHash.toLowerCase(), status: "confirmed" };
      }
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    return { chain, asset: config.asset, amount: formatEther(value), txHash: txHash.toLowerCase(), status: "submitted" };
  }
}

export { decimalToLamports, lamportsToDecimal };
