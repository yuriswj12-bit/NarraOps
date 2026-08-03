var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/integrations/gmgn-execution-adapter.ts
var gmgn_execution_adapter_exports = {};
__export(gmgn_execution_adapter_exports, {
  GmgnExecutionAdapter: () => GmgnExecutionAdapter,
  SOL: () => SOL
});
module.exports = __toCommonJS(gmgn_execution_adapter_exports);
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_path = __toESM(require("node:path"));
var import_node_util = require("node:util");
var execFileAsync = (0, import_node_util.promisify)(import_node_child_process.execFile);
var CHAIN_MAP = Object.freeze({ solana: "sol", sol: "sol", bsc: "bsc", base: "base", eth: "eth", ethereum: "eth" });
var SOL = "So11111111111111111111111111111111111111112";
var GmgnExecutionAdapter = class {
  constructor({ enabled = false, cliPath, timeoutMs = 3e4, execFileImpl } = {}) {
    this.enabled = Boolean(enabled);
    this.cliCommand = resolveCliCommand(cliPath);
    this.timeoutMs = Math.min(Math.max(Number(timeoutMs) || 3e4, 5e3), 12e4);
    this.credentialsRequired = !execFileImpl;
    this.execFileImpl = execFileImpl || execFileAsync;
  }
  async tokenSecurity({ chain = "solana", address, requestId } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !address) return { status: "invalid_request", source: "gmgn", request_id: requestId };
    if (!this.enabled) return { status: "unavailable", source: "gmgn", operation: "token.security", chain: normalized.name, address, request_id: requestId, reason: "GMGN live provider is not configured" };
    return this.run(["token", "security", "--chain", normalized.cli, "--address", String(address), "--raw"], {
      operation: "token.security",
      chain: normalized.name,
      requestId
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
    requestId
  } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !fromAddress || !name || !symbol || !buyAmount || !imageUrl && !imageBase64) {
      return { status: "invalid_request", source: "gmgn", operation: "cooking.create", request_id: requestId };
    }
    if (!this.enabled) {
      return { status: "unavailable", source: "gmgn", operation: "cooking.create", chain: normalized.name, request_id: requestId, reason: "GMGN cooking executor is not configured" };
    }
    const args = [
      "cooking",
      "create",
      "--chain",
      normalized.cli,
      "--dex",
      String(dex),
      "--from",
      String(fromAddress),
      "--name",
      String(name),
      "--symbol",
      String(symbol),
      "--buy-amt",
      String(buyAmount)
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
      "multi-swap",
      "--chain",
      normalized.cli,
      "--accounts",
      accounts.join(","),
      "--input-token",
      String(inputToken),
      "--output-token",
      String(outputToken),
      "--anti-mev"
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
      operation: "order.get",
      chain: normalized.name,
      requestId
    });
  }
  async waitForOrder({ chain, orderId, requestId, attempts = 3, delayMs = 5e3 } = {}) {
    let last = null;
    for (let index = 0; index < Math.min(Math.max(Number(attempts) || 3, 1), 3); index += 1) {
      last = await this.orderGet({ chain, orderId, requestId });
      if (["confirmed", "successful", "failed", "expired"].includes(orderStatus(last))) return last;
      if (index < attempts - 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return last;
  }
  async waitForCookingOrder({ chain, orderId, requestId, attempts = 15, delayMs = 2e3 } = {}) {
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
        reason: "GMGN_API_KEY and GMGN_PRIVATE_KEY are required for live execution"
      };
    }
    try {
      const { stdout } = await this.execFileImpl(this.cliCommand.file, [...this.cliCommand.args, ...args], {
        timeout: this.timeoutMs,
        maxBuffer: 2e6,
        windowsHide: true,
        env: process.env
      });
      const raw = String(stdout || "").trim();
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        data = { raw: raw.slice(0, 2e4) };
      }
      return { status: "live", source: "gmgn", operation, chain, request_id: requestId, data };
    } catch (error) {
      return {
        status: error?.killed || error?.code === "ETIMEDOUT" ? "timeout" : "unavailable",
        source: "gmgn",
        operation,
        chain,
        request_id: requestId,
        reason: "GMGN execution command failed",
        error_code: typeof error?.code === "string" ? error.code : "GMGN_COMMAND_FAILED"
      };
    }
  }
};
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
    import_node_path.default.join(process.cwd(), "node_modules", "gmgn-cli", "dist", "index.js"),
    process.env.APPDATA ? import_node_path.default.join(process.env.APPDATA, "npm", "node_modules", "gmgn-cli", "dist", "index.js") : null
  ].find((candidate) => candidate && (0, import_node_fs.existsSync)(candidate));
  if (packageMain && (process.platform === "win32" || !configuredPath)) return { file: process.execPath, args: [packageMain] };
  if (configuredPath) return { file: configuredPath, args: [] };
  return { file: process.platform === "win32" ? "gmgn-cli.cmd" : "gmgn-cli", args: [] };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  GmgnExecutionAdapter,
  SOL
});
