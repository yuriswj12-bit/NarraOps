// @ts-nocheck
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHAIN_MAP = Object.freeze({ solana: "sol", sol: "sol", bsc: "bsc", base: "base", eth: "eth", ethereum: "eth" });
const SOL = "So11111111111111111111111111111111111111112";

export class GmgnExecutionAdapter {
  constructor({ enabled = false, cliPath, timeoutMs = 30_000, execFileImpl } = {}) {
    this.enabled = Boolean(enabled);
    this.cliCommand = resolveCliCommand(cliPath);
    this.timeoutMs = Math.min(Math.max(Number(timeoutMs) || 30_000, 5_000), 120_000);
    this.credentialsRequired = !execFileImpl;
    this.execFileImpl = execFileImpl || execFileAsync;
  }

  async tokenSecurity({ chain = "solana", address, requestId } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !address) return { status: "invalid_request", source: "gmgn", request_id: requestId };
    if (!this.enabled) return { status: "unavailable", source: "gmgn", operation: "token.security", chain: normalized.name, address, request_id: requestId, reason: "GMGN live provider is not configured" };
    return this.run(["token", "security", "--chain", normalized.cli, "--address", String(address), "--raw"], {
      operation: "token.security", chain: normalized.name, requestId,
    });
  }

  async cookingCreate({
    chain = "solana",
    dex = "pump",
    fromAddress,
    name,
    symbol,
    buyAmount,
    imageUrl,
    imageBase64,
    description,
    twitter,
    telegram,
    website,
    slippage,
    autoSlippage = true,
    bundleWallets = [],
    requestId,
  } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !fromAddress || !name || !symbol || !buyAmount || (!imageUrl && !imageBase64)) {
      return { status: "invalid_request", source: "gmgn", operation: "cooking.create", request_id: requestId };
    }
    if (!this.enabled) {
      return { status: "unavailable", source: "gmgn", operation: "cooking.create", chain: normalized.name, request_id: requestId, reason: "GMGN cooking executor is not configured" };
    }

    const args = [
      "cooking", "create",
      "--chain", normalized.cli,
      "--dex", String(dex),
      "--from", String(fromAddress),
      "--name", String(name),
      "--symbol", String(symbol),
      "--buy-amt", String(buyAmount),
    ];
    if (imageUrl) args.push("--image-url", String(imageUrl));
    else args.push("--image", String(imageBase64));
    if (autoSlippage) args.push("--auto-slippage");
    else args.push("--slippage", String(Math.min(Math.max(Number(slippage) || 30, 1), 100)));
    if (description) args.push("--description", String(description));
    if (twitter) args.push("--twitter", String(twitter));
    if (telegram) args.push("--telegram", String(telegram));
    if (website) args.push("--website", String(website));
    if (Array.isArray(bundleWallets) && bundleWallets.length) {
      args.push("--buy-wallets", JSON.stringify(bundleWallets));
    }
    args.push("--raw");
    return this.run(args, { operation: "cooking.create", chain: normalized.name, requestId });
  }

  async multiSwap({ chain = "solana", accounts = [], inputToken, outputToken, inputAmountByWallet, percentBpsByWallet, slippage = 30, autoSlippage = false, requestId } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !Array.isArray(accounts) || !accounts.length || !inputToken || !outputToken) {
      return { status: "invalid_request", source: "gmgn", operation: "multi_swap", request_id: requestId };
    }
    if (!this.enabled) {
      return { status: "unavailable", source: "gmgn", operation: "multi_swap", chain: normalized.name, request_id: requestId, reason: "GMGN live provider is not configured" };
    }
    const args = [
      "multi-swap", "--chain", normalized.cli,
      "--accounts", accounts.join(","),
      "--input-token", String(inputToken),
      "--output-token", String(outputToken),
      "--anti-mev",
    ];
    if (inputAmountByWallet) args.push("--input-amount", JSON.stringify(inputAmountByWallet));
    if (percentBpsByWallet) args.push("--input-amount-bps", JSON.stringify(percentBpsByWallet));
    if (autoSlippage) args.push("--auto-slippage");
    else args.push("--slippage", String(Math.min(Math.max(Number(slippage) || 30, 1), 100)));
    args.push("--raw");
    return this.run(args, { operation: "multi_swap", chain: normalized.name, requestId });
  }

  async orderGet({ chain = "solana", orderId, requestId } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !orderId) return { status: "invalid_request", source: "gmgn", operation: "order.get", request_id: requestId };
    if (!this.enabled) return { status: "unavailable", source: "gmgn", operation: "order.get", chain: normalized.name, request_id: requestId, reason: "GMGN live provider is not configured" };
    return this.run(["order", "get", "--chain", normalized.cli, "--order-id", String(orderId), "--raw"], {
      operation: "order.get", chain: normalized.name, requestId,
    });
  }

  async waitForOrder({ chain, orderId, requestId, attempts = 3, delayMs = 5_000 } = {}) {
    let last = null;
    for (let index = 0; index < Math.min(Math.max(Number(attempts) || 3, 1), 3); index += 1) {
      last = await this.orderGet({ chain, orderId, requestId });
      if (["confirmed", "successful", "failed", "expired"].includes(orderStatus(last))) return last;
      if (index < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return last;
  }

  async waitForCookingOrder({ chain, orderId, requestId, attempts = 15, delayMs = 2_000 } = {}) {
    let last = null;
    const maxAttempts = Math.min(Math.max(Number(attempts) || 15, 1), 15);
    for (let index = 0; index < maxAttempts; index += 1) {
      last = await this.orderGet({ chain, orderId, requestId });
      if (["confirmed", "successful", "failed", "expired"].includes(orderStatus(last))) return last;
      if (index < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return last;
  }

  async run(args, { operation, chain, requestId } = {}) {
    if (this.credentialsRequired && (!String(process.env.GMGN_API_KEY || "").trim() || !String(process.env.GMGN_PRIVATE_KEY || "").trim())) {
      return {
        status: "unavailable",
        source: "gmgn",
        operation,
        chain,
        request_id: requestId,
        reason: "GMGN_API_KEY and GMGN_PRIVATE_KEY are required for live execution",
      };
    }
    try {
      const { stdout } = await this.execFileImpl(this.cliCommand.file, [...this.cliCommand.args, ...args], {
        timeout: this.timeoutMs,
        maxBuffer: 2_000_000,
        windowsHide: true,
        env: process.env,
      });
      const raw = String(stdout || "").trim();
      let data;
      try { data = JSON.parse(raw); } catch { data = { raw: raw.slice(0, 20_000) }; }
      return { status: "live", source: "gmgn", operation, chain, request_id: requestId, data };
    } catch (error) {
      return {
        status: error?.killed || error?.code === "ETIMEDOUT" ? "timeout" : "unavailable",
        source: "gmgn", operation, chain, request_id: requestId,
        reason: "GMGN execution command failed",
        error_code: typeof error?.code === "string" ? error.code : "GMGN_COMMAND_FAILED",
      };
    }
  }
}

function normalizeChain(value) {
  const cli = CHAIN_MAP[String(value || "").trim().toLowerCase()];
  return cli ? { cli, name: cli === "sol" ? "solana" : cli } : null;
}

function orderStatus(result) {
  const data = result?.data || {};
  return String(data.status || data.state || data.order_status || data.report?.status || "").toLowerCase();
}

function resolveCliCommand(configuredPath) {
  const packageMain = [
    path.join(process.cwd(), "node_modules", "gmgn-cli", "dist", "index.js"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "gmgn-cli", "dist", "index.js") : null,
  ].find((candidate) => candidate && existsSync(candidate));
  if (packageMain && (process.platform === "win32" || !configuredPath)) return { file: process.execPath, args: [packageMain] };
  if (configuredPath) return { file: configuredPath, args: [] };
  return { file: process.platform === "win32" ? "gmgn-cli.cmd" : "gmgn-cli", args: [] };
}

export { SOL };
