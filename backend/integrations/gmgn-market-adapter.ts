// @ts-nocheck
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHAIN_MAP = Object.freeze({
  sol: "sol",
  solana: "sol",
  bsc: "bsc",
  base: "base",
  eth: "eth",
  ethereum: "eth",
});
const PLATFORM_MAP = Object.freeze({
  solana: "Pump.fun",
  bsc: "fourmeme",
});
const TRENDING_INTERVALS = new Set(["1m", "5m", "1h", "6h", "24h"]);
const TRENDING_ORDER_BY = new Set(["default", "volume", "swaps", "marketcap", "holder_count", "price", "change1h"]);
const SORT_DIRECTIONS = new Set(["asc", "desc"]);
const TRENCH_TYPES = new Set(["new_creation", "near_completion", "completed"]);
const TRENCH_SORT_BY = new Set([
  "smart_degen_count",
  "renowned_count",
  "volume_24h",
  "volume_1h",
  "swaps_24h",
  "swaps_1h",
  "rug_ratio",
  "holder_count",
  "usd_market_cap",
  "created_timestamp",
]);
const KLINE_RESOLUTIONS = new Set(["30s", "1m", "5m", "15m", "1h", "4h", "1d"]);

export class GmgnMarketAdapter {
  constructor({ enabled = false, cliPath, timeoutMs = 15_000, maxRetries = 1, execFileImpl } = {}) {
    this.enabled = enabled;
    this.cliCommand = resolveCliCommand(cliPath);
    this.cliPath = this.cliCommand.file;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.min(Math.max(Number(maxRetries) || 0, 0), 3);
    this.execFileImpl = execFileImpl || execFileAsync;
  }

  async scanDevWallets({ chain, limit = 20, requestId }) {
    if (!this.enabled) {
      return { status: "unavailable", source: "gmgn", tokens: [], request_id: requestId, reason: "GMGN market provider is not configured" };
    }
    if (!CHAIN_MAP[chain]) {
      return { status: "unsupported_chain", source: "gmgn", tokens: [], chain, request_id: requestId };
    }

    const args = [
      "market", "trenches",
      "--chain", CHAIN_MAP[chain],
      "--type", "new_creation", "near_completion", "completed",
      "--launchpad-platform", PLATFORM_MAP[chain],
      "--limit", String(Math.min(Math.max(limit, 1), 80)),
      "--sort-by", "created_timestamp",
      "--raw",
    ];

    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const { stdout } = await this.execFileImpl(this.cliCommand.file, [...this.cliCommand.args, ...args], this.execOptions());
        const payload = JSON.parse(stdout.trim());
        const records = collectTokenRecords(payload);
        const tokens = records.map((record) => normalizeToken(record, chain)).filter(Boolean);
        const creators = [...new Set(tokens.map(({ creator_address }) => creator_address))].slice(0, 20);
        const walletStats = creators.length ? await this.fetchWalletStats({ chain, wallets: creators }) : [];
        return {
          status: "live",
          source: "gmgn",
          request_id: requestId,
          observed_at: new Date().toISOString(),
          tokens,
          wallet_stats: walletStats,
          wallet_stats_status: walletStats.length ? "live" : "enrichment_pending",
        };
      } catch (error) {
        lastError = error;
      }
    }
    return {
      status: lastError?.killed ? "timeout" : "unavailable",
      source: "gmgn",
      request_id: requestId,
      tokens: [],
      reason: "GMGN market data could not be fetched",
    };
  }

  async fetchWalletStats({ chain, wallets }) {
    if (!CHAIN_MAP[chain] || !Array.isArray(wallets) || wallets.length === 0) return [];
    const output = [];
    for (const period of ["7d", "30d"]) {
      const args = ["portfolio", "stats", "--chain", CHAIN_MAP[chain]];
      for (const wallet of wallets.slice(0, 20)) args.push("--wallet", wallet);
      args.push("--period", period, "--raw");
      let completed = false;
      for (let attempt = 0; attempt <= this.maxRetries && !completed; attempt += 1) {
        try {
          const { stdout } = await this.execFileImpl(this.cliCommand.file, [...this.cliCommand.args, ...args], this.execOptions());
          output.push(...normalizeStatsPayload(JSON.parse(stdout.trim()), chain, period));
          completed = true;
        } catch {
          if (attempt === this.maxRetries) return output;
        }
      }
    }
    return output;
  }

  async marketTrending({
    chain = "solana",
    interval = "1h",
    limit = 20,
    orderBy = "volume",
    direction = "desc",
    filters = [],
    platforms = [],
    requestId,
  } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized) return unsupportedResult("market.trending", chain, requestId);
    const args = [
      "market", "trending",
      "--chain", normalized.cli,
      "--interval", safeChoice(interval, TRENDING_INTERVALS, "1h"),
      "--limit", String(clampInteger(limit, 1, 100, 20)),
      "--order-by", safeChoice(orderBy, TRENDING_ORDER_BY, "volume"),
      "--direction", safeChoice(direction, SORT_DIRECTIONS, "desc"),
    ];
    appendRepeated(args, "--filter", filters);
    appendRepeated(args, "--platform", platforms);
    args.push("--raw");
    return this.runRawCommand(args, { requestId, operation: "market.trending", chain: normalized.name });
  }

  async marketTrenches({
    chain = "solana",
    types = ["new_creation", "near_completion", "completed"],
    limit = 20,
    launchpadPlatforms = [],
    filterPreset,
    sortBy = "created_timestamp",
    direction = "desc",
    requestId,
  } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized) return unsupportedResult("market.trenches", chain, requestId);
    const selectedTypes = normalizeChoices(types, TRENCH_TYPES);
    const args = ["market", "trenches", "--chain", normalized.cli, "--type", ...(selectedTypes.length ? selectedTypes : [...TRENCH_TYPES])];
    args.push("--limit", String(clampInteger(limit, 1, 80, 20)));
    appendRepeated(args, "--launchpad-platform", launchpadPlatforms);
    if (["safe", "smart-money", "strict"].includes(filterPreset)) args.push("--filter-preset", filterPreset);
    args.push(
      "--sort-by", safeChoice(sortBy, TRENCH_SORT_BY, "created_timestamp"),
      "--direction", safeChoice(direction, SORT_DIRECTIONS, "desc"),
      "--raw",
    );
    return this.runRawCommand(args, { requestId, operation: "market.trenches", chain: normalized.name });
  }

  async marketKline({
    chain = "solana",
    address,
    resolution = "1h",
    from,
    to,
    requestId,
  } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized) return unsupportedResult("market.kline", chain, requestId);
    if (!isTokenAddress(address, normalized.cli)) {
      return {
        status: "invalid_address",
        source: "gmgn",
        operation: "market.kline",
        chain: normalized.name,
        request_id: requestId,
        data: null,
        reason: "A valid token contract address is required",
      };
    }
    const args = [
      "market", "kline",
      "--chain", normalized.cli,
      "--address", String(address),
      "--resolution", safeChoice(resolution, KLINE_RESOLUTIONS, "1h"),
    ];
    appendTimestamp(args, "--from", from);
    appendTimestamp(args, "--to", to);
    args.push("--raw");
    return this.runRawCommand(args, { requestId, operation: "market.kline", chain: normalized.name });
  }

  async marketSignals({
    chain = "solana",
    signalTypes = [],
    requestId,
  } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized || !["sol", "bsc"].includes(normalized.cli)) {
      return unsupportedResult("market.signal", chain, requestId);
    }
    const args = ["market", "signal", "--chain", normalized.cli];
    const types = normalizeSignalTypes(signalTypes);
    if (types.length) args.push("--signal-type", ...types);
    args.push("--raw");
    return this.runRawCommand(args, { requestId, operation: "market.signal", chain: normalized.name });
  }

  async analyzeToken({ chain = "solana", address, includeWallets = true, requestId } = {}) {
    const normalized = normalizeChain(chain);
    if (!normalized) return unsupportedResult("token.analyze", chain, requestId);
    if (!isTokenAddress(address, normalized.cli)) {
      return {
        status: "invalid_address",
        source: "gmgn",
        operation: "token.analyze",
        chain: normalized.name,
        request_id: requestId,
        data: null,
        reason: "A valid token contract address is required",
      };
    }

    const commands = [
      ["info", ["token", "info", "--chain", normalized.cli, "--address", String(address), "--raw"]],
      ["security", ["token", "security", "--chain", normalized.cli, "--address", String(address), "--raw"]],
      ["pool", ["token", "pool", "--chain", normalized.cli, "--address", String(address), "--raw"]],
    ];
    if (includeWallets !== false) {
      commands.push(
        ["smart_money_holders", ["token", "holders", "--chain", normalized.cli, "--address", String(address), "--tag", "smart_degen", "--limit", "20", "--raw"]],
        ["smart_money_traders", ["token", "traders", "--chain", normalized.cli, "--address", String(address), "--tag", "smart_degen", "--limit", "20", "--raw"]],
      );
    }
    const entries = await Promise.all(commands.map(async ([key, args]) => [key, await this.runRawCommand(args, { requestId, operation: `token.${key}`, chain: normalized.name })]));
    const data = Object.fromEntries(entries.map(([key, value]) => [key, value.data]));
    const statuses = Object.fromEntries(entries.map(([key, value]) => [key, value.status]));
    const errors = Object.fromEntries(entries
      .filter(([, value]) => value.error_code || value.error_detail)
      .map(([key, value]) => [key, { code: value.error_code, detail: value.error_detail }]));
    const live = entries.some(([, value]) => value.status === "live");
    return {
      status: live ? "live" : statuses.info || "unavailable",
      source: "gmgn",
      operation: "token.analyze",
      chain: normalized.name,
      address: String(address),
      request_id: requestId,
      observed_at: new Date().toISOString(),
      component_statuses: statuses,
      ...(Object.keys(errors).length ? { component_errors: errors } : {}),
      data,
      ...(live ? {} : { reason: "GMGN token research could not be fetched" }),
    };
  }

  async fetchSolanaMemeResearch({ address, requestId, limit = 100, includeTagScans = false } = {}) {
    const normalized = normalizeChain("solana");
    if (!isTokenAddress(address, normalized.cli)) {
      return {
        status: "invalid_address",
        source: "gmgn",
        operation: "token.sol_meme_research",
        chain: "solana",
        request_id: requestId,
        data: null,
        reason: "A valid Solana token contract address is required",
      };
    }

    const boundedLimit = clampInteger(limit, 20, 100, 100);
    // Holder/trader rows already contain GMGN wallet and maker tags. Optional
    // filtered scans are deliberately off by default: GMGN rate limits this
    // endpoint aggressively, and a report must not fan out into an IP ban.
    const tagNames = includeTagScans ? ["smart_degen", "bundler"] : [];
    const commands = [
      ["info", ["token", "info", "--chain", normalized.cli, "--address", String(address), "--raw"]],
      ["security", ["token", "security", "--chain", normalized.cli, "--address", String(address), "--raw"]],
      ["pool", ["token", "pool", "--chain", normalized.cli, "--address", String(address), "--raw"]],
      ["holders", ["token", "holders", "--chain", normalized.cli, "--address", String(address), "--limit", String(boundedLimit), "--raw"]],
      ["traders", ["token", "traders", "--chain", normalized.cli, "--address", String(address), "--limit", String(boundedLimit), "--raw"]],
      ...tagNames.map((tag) => [
        `holders_${tag}`,
        ["token", "holders", "--chain", normalized.cli, "--address", String(address), "--tag", tag, "--limit", String(boundedLimit), "--raw"],
      ]),
    ];

    const entries = [];
    // Keep fan-out bounded. Three concurrent requests is enough to keep the
    // report responsive without repeating the 11-request rate-limit failure.
    for (let index = 0; index < commands.length; index += 3) {
      const batch = commands.slice(index, index + 3);
      const results = await Promise.all(batch.map(async ([key, args]) => [
        key,
        await this.runRawCommand(args, { requestId, operation: `token.${key}`, chain: normalized.name }),
      ]));
      entries.push(...results);
      if (index + 3 < commands.length) await pause(250);
    }
    const statuses = Object.fromEntries(entries.map(([key, value]) => [key, value.status]));
    const errors = Object.fromEntries(entries
      .filter(([, value]) => value.error_code || value.error_detail)
      .map(([key, value]) => [key, { code: value.error_code, detail: value.error_detail }]));
    const live = entries.some(([, value]) => value.status === "live");
    return {
      status: live ? "live" : statuses.info || "unavailable",
      source: "gmgn",
      operation: "token.sol_meme_research",
      chain: normalized.name,
      address: String(address),
      request_id: requestId,
      observed_at: new Date().toISOString(),
      limit: boundedLimit,
      tags: tagNames,
      tag_scans_enabled: Boolean(includeTagScans),
      component_statuses: statuses,
      ...(Object.keys(errors).length ? { component_errors: errors } : {}),
      data: Object.fromEntries(entries.map(([key, value]) => [key, value.data])),
      ...(live ? {} : { reason: "GMGN Solana meme research could not be fetched" }),
    };
  }

  execOptions() {
    return {
      timeout: this.timeoutMs,
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024,
    };
  }

  async runRawCommand(args, { requestId, operation, chain } = {}) {
    if (!this.enabled) {
      return {
        status: "unavailable",
        source: "gmgn",
        operation,
        chain,
        request_id: requestId,
        data: null,
        reason: "GMGN market provider is not configured",
      };
    }
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const { stdout } = await this.execFileImpl(this.cliCommand.file, [...this.cliCommand.args, ...args], this.execOptions());
        return {
          status: "live",
          source: "gmgn",
          operation,
          chain,
          request_id: requestId,
          observed_at: new Date().toISOString(),
          data: capPayload(JSON.parse(String(stdout || "").trim())),
        };
      } catch (error) {
        lastError = error;
        if (isRateLimited(error)) break;
      }
    }
    const errorCode = typeof lastError?.code === "string" ? lastError.code : "GMGN_COMMAND_FAILED";
    const errorDetail = safeErrorDetail(lastError);
    console.error(`[gmgn-adapter] ${operation} failed`, { error_code: errorCode, detail: errorDetail });
    return {
      status: lastError?.killed || lastError?.code === "ETIMEDOUT"
        ? "timeout"
        : isRateLimited(lastError)
          ? "rate_limited"
          : "unavailable",
      source: "gmgn",
      operation,
      chain,
      request_id: requestId,
      data: null,
      reason: "GMGN market data could not be fetched",
      error_code: errorCode,
      ...(errorDetail ? { error_detail: errorDetail } : {}),
    };
  }
}

function resolveCliCommand(configuredPath) {
  const packageMain = [
    path.join(process.cwd(), "node_modules", "gmgn-cli", "dist", "index.js"),
    process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules", "gmgn-cli", "dist", "index.js") : null,
  ].find((candidate) => candidate && existsSync(candidate));
  if (packageMain && (process.platform === "win32" || !configuredPath)) {
    return { file: process.execPath, args: [packageMain] };
  }
  if (configuredPath) return { file: configuredPath, args: [] };
  return { file: process.platform === "win32" ? "gmgn-cli.cmd" : "gmgn-cli", args: [] };
}

function normalizeChain(value) {
  const cli = CHAIN_MAP[String(value || "").trim().toLowerCase()];
  if (!cli) return null;
  return { cli, name: cli === "sol" ? "solana" : cli };
}

function unsupportedResult(operation, chain, requestId) {
  return {
    status: "unsupported_chain",
    source: "gmgn",
    operation,
    chain,
    request_id: requestId,
    data: null,
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

function safeChoice(value, allowed, fallback) {
  const normalized = String(value || "").trim();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeChoices(value, allowed) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((entry) => String(entry || "").trim()).filter((entry) => allowed.has(entry)))];
}

function appendRepeated(args, flag, values) {
  for (const value of normalizeChoices(values, new Set(valuesOfStrings(values)))) {
    if (/^[A-Za-z0-9_.-]{1,80}$/.test(value)) args.push(flag, value);
  }
}

function valuesOfStrings(value) {
  return (Array.isArray(value) ? value : [value])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function appendTimestamp(args, flag, value) {
  if (value == null || value === "") return;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) args.push(flag, String(parsed));
}

function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSignalTypes(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 1 && entry <= 18)
    .map(String))];
}

function isTokenAddress(address, chain) {
  const value = String(address || "").trim();
  return chain === "sol"
    ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)
    : /^0x[a-fA-F0-9]{40}$/.test(value);
}

function capPayload(value, maxItems = 100, depth = 0) {
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, maxItems).map((entry) => capPayload(entry, maxItems, depth + 1));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, entry]) => [key, capPayload(entry, maxItems, depth + 1)]));
}

function safeErrorDetail(error) {
  const raw = String(error?.stderr || error?.message || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  return raw
    .replace(/(api[_ -]?key|authorization|bearer)\s*[:=]\s*[^\s]+/gi, "$1=[redacted]")
    .slice(0, 240);
}

function isRateLimited(error) {
  const raw = String(error?.stderr || error?.stdout || error?.message || "");
  return /\b429\b|RATE_LIMIT|rate limit|temporarily banned/i.test(raw);
}

function collectTokenRecords(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object" && (item.address || item.token_address) && item.creator) output.push(item);
      else collectTokenRecords(item, output);
    }
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectTokenRecords(entry, output);
  }
  return output;
}

function normalizeToken(record, chain) {
  const tokenAddress = record.address || record.token_address;
  if (!tokenAddress || !record.creator) return null;
  return {
    chain,
    token_address: tokenAddress,
    creator_address: record.creator,
    symbol: record.symbol || null,
    name: record.name || null,
    launchpad_platform: record.launchpad_platform || PLATFORM_MAP[chain],
    platform_id: chain === "solana" ? "pump" : "fourmeme",
    created_at: record.created_timestamp || null,
    market_cap_usd: stringOrNull(record.usd_market_cap),
    creator_hold_rate: numberOrNull(record.creator_balance_rate ?? record.creator_hold_rate),
    creator_token_status: record.creator_token_status || null,
    dev_team_hold_rate: numberOrNull(record.dev_team_hold_rate),
  };
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringOrNull(value) {
  return value == null ? null : String(value);
}

function normalizeStatsPayload(payload, chain, period, output = []) {
  if (Array.isArray(payload)) {
    for (const item of payload) normalizeStatsPayload(item, chain, period, output);
    return output;
  }
  if (!payload || typeof payload !== "object") return output;
  for (const [address, stats] of Object.entries(payload)) {
    const addressMatches = chain === "solana"
      ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
      : /^0x[a-fA-F0-9]{40}$/.test(address);
    if (addressMatches && stats && typeof stats === "object" && !Array.isArray(stats)
      && (stats.realized_profit != null || stats.unrealized_profit != null || stats.pnl != null)) {
      output.push({
      chain,
      address,
      period,
      realized_profit_usd: stringOrNull(stats.realized_profit),
      unrealized_profit_usd: stringOrNull(stats.unrealized_profit),
      win_rate: stringOrNull(stats.winrate),
      total_cost_usd: stringOrNull(stats.total_cost),
      pnl_ratio: stringOrNull(stats.pnl),
      buy_count: Number.isInteger(stats.buy_count) ? stats.buy_count : null,
      sell_count: Number.isInteger(stats.sell_count) ? stats.sell_count : null,
      });
    } else {
      normalizeStatsPayload(stats, chain, period, output);
    }
  }
  return output;
}
