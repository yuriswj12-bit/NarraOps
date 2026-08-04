// @ts-nocheck
import { createHash } from "node:crypto";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";

const SOL = "So11111111111111111111111111111111111111112";
const DEFAULT_JUPITER_BASE_URL = "https://api.jup.ag/swap/v1";

export class SolanaSwapAdapter {
  constructor({
    baseUrl = process.env.JUPITER_API_BASE_URL || DEFAULT_JUPITER_BASE_URL,
    apiKey = process.env.JUPITER_API_KEY || "",
    rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    timeoutMs = 15_000,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = String(baseUrl || DEFAULT_JUPITER_BASE_URL).replace(/\/$/, "");
    this.apiKey = String(apiKey || "").trim();
    this.rpcUrl = String(rpcUrl || "").trim();
    this.timeoutMs = Math.min(Math.max(Number(timeoutMs) || 15_000, 3_000), 60_000);
    this.fetchImpl = fetchImpl;
  }

  async prepare({
    walletAddress,
    inputToken,
    outputToken,
    amountAtomic,
    percentBps,
    slippageBps = 50,
    requestId,
  } = {}) {
    if (!this.fetchImpl) return unavailable(requestId, "Fetch is not available on the server");
    if (!validPublicKey(walletAddress) || !validPublicKey(inputToken) || !validPublicKey(outputToken)) {
      return { status: "invalid_request", provider: "jupiter", operation: "swap.prepare", request_id: requestId, reason: "A valid Solana wallet and token address are required" };
    }
    if (inputToken === outputToken) {
      return { status: "invalid_request", provider: "jupiter", operation: "swap.prepare", request_id: requestId, reason: "Input and output tokens must be different" };
    }
    let resolvedAmountAtomic = String(amountAtomic || "");
    if ((!/^\d+$/.test(resolvedAmountAtomic) || BigInt(resolvedAmountAtomic) <= 0n) && percentBps != null) {
      const boundedPercentBps = Math.min(Math.max(Number(percentBps) || 0, 1), 10_000);
      try {
        const balance = await this.tokenBalanceAtomic(walletAddress, inputToken);
        resolvedAmountAtomic = ((balance * BigInt(boundedPercentBps)) / 10_000n).toString();
      } catch (error) {
        return unavailable(requestId, error instanceof Error ? error.message : "Unable to read the token balance", "balance");
      }
    }
    if (!/^\d+$/.test(resolvedAmountAtomic) || BigInt(resolvedAmountAtomic) <= 0n) {
      return { status: "invalid_request", provider: "jupiter", operation: "swap.prepare", request_id: requestId, reason: "amountAtomic must be a positive integer" };
    }
    const boundedSlippageBps = Math.min(Math.max(Number(slippageBps) || 50, 1), 1_000);
    const quoteUrl = new URL(`${this.baseUrl}/quote`);
    quoteUrl.searchParams.set("inputMint", inputToken);
    quoteUrl.searchParams.set("outputMint", outputToken);
    quoteUrl.searchParams.set("amount", resolvedAmountAtomic);
    quoteUrl.searchParams.set("slippageBps", String(boundedSlippageBps));
    quoteUrl.searchParams.set("restrictIntermediateTokens", "true");
    quoteUrl.searchParams.set("instructionVersion", "V2");

    try {
      const quote = await this.request(quoteUrl, { method: "GET" });
      if (!quote || quote.error || !quote.outAmount) {
        return unavailable(requestId, quote?.error || "Jupiter did not return a route", "quote");
      }
      const swap = await this.request(`${this.baseUrl}/swap`, {
        method: "POST",
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: walletAddress,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              priorityLevel: "high",
              maxLamports: 500_000,
            },
          },
        }),
      });
      if (!swap || swap.error || !swap.swapTransaction) {
        return unavailable(requestId, swap?.error || "Jupiter did not return a signable transaction", "swap");
      }
      const transaction = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
      const messageHash = createHash("sha256").update(transaction.message.serialize()).digest("hex");
      return {
        status: "requires_user_signature",
        provider: "jupiter",
        operation: "swap.prepare",
        execution_mode: "client_signed",
        request_id: requestId,
        wallet_address: walletAddress,
        input_token: inputToken,
        output_token: outputToken,
        input_amount_atomic: resolvedAmountAtomic,
        quoted_output_amount_atomic: String(quote.outAmount),
        slippage_bps: boundedSlippageBps,
        price_impact_pct: quote.priceImpactPct ?? null,
        route_plan: Array.isArray(quote.routePlan) ? quote.routePlan.map((route) => route?.swapInfo?.label || route?.swapInfo?.ammKey).filter(Boolean) : [],
        transaction_base64: swap.swapTransaction,
        message_hash: messageHash,
        last_valid_block_height: swap.lastValidBlockHeight ?? null,
        prioritization_fee_lamports: swap.prioritizationFeeLamports ?? null,
      };
    } catch (error) {
      return unavailable(requestId, error instanceof Error ? error.message : "Jupiter request failed");
    }
  }

  async tokenBalanceAtomic(walletAddress, mintAddress) {
    if (!this.rpcUrl) throw new Error("SOLANA_RPC_URL is required for percentage sells");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [
            walletAddress,
            { mint: mintAddress },
            { encoding: "jsonParsed", commitment: "confirmed" },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(`Solana RPC balance lookup failed: ${payload?.error?.message || response.status}`);
      }
      return (payload?.result?.value || []).reduce((total, account) => {
        const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
        return /^\d+$/.test(String(amount || "")) ? total + BigInt(amount) : total;
      }, 0n);
    } finally {
      clearTimeout(timer);
    }
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
          ...(options.headers || {}),
        },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`Jupiter HTTP ${response.status}: ${payload?.error || payload?.message || "request failed"}`);
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }
}

function validPublicKey(value) {
  try {
    new PublicKey(String(value || ""));
    return true;
  } catch {
    return false;
  }
}

function unavailable(requestId, reason, operation = "prepare") {
  return {
    status: "unavailable",
    provider: "jupiter",
    operation: `swap.${operation}`,
    request_id: requestId,
    reason: String(reason || "Jupiter swap service is unavailable"),
  };
}

export { SOL };
