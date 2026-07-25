// @ts-nocheck
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CHAIN_MAP = Object.freeze({ solana: "sol", bsc: "bsc" });
const PLATFORM_MAP = Object.freeze({
  solana: "Pump.fun",
  bsc: "fourmeme",
});

export class GmgnMarketAdapter {
  constructor({ enabled = false, cliPath, timeoutMs = 15_000, maxRetries = 1 } = {}) {
    this.enabled = enabled;
    this.cliPath = cliPath || (process.platform === "win32" ? "gmgn-cli.cmd" : "gmgn-cli");
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.min(Math.max(Number(maxRetries) || 0, 0), 3);
  }

  async scanDevWallets({ chain, limit = 20, requestId }) {
    if (!this.enabled) {
      return { status: "disabled", source: "gmgn", tokens: [], request_id: requestId, reason: "GMGN_LIVE_ENABLED is false" };
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
        const { stdout } = await execFileAsync(this.cliPath, args, {
          timeout: this.timeoutMs,
          windowsHide: true,
          maxBuffer: 5 * 1024 * 1024,
        });
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
          const { stdout } = await execFileAsync(this.cliPath, args, {
            timeout: this.timeoutMs,
            windowsHide: true,
            maxBuffer: 5 * 1024 * 1024,
          });
          output.push(...normalizeStatsPayload(JSON.parse(stdout.trim()), chain, period));
          completed = true;
        } catch {
          if (attempt === this.maxRetries) return output;
        }
      }
    }
    return output;
  }
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
