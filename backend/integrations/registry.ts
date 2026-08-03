// @ts-nocheck
import { GmgnMarketAdapter } from "./gmgn-market-adapter.ts";
import { GmgnExecutionAdapter } from "./gmgn-execution-adapter.ts";
import { HertzFlowAdapter } from "./hertzflow-adapter.ts";

const PLATFORM_ALIASES = new Map([
  ["x", "x"],
  ["twitter", "x"],
  ["tiktok", "tiktok"],
  ["douyin", "douyin"],
  ["抖音", "douyin"],
  ["instagram", "instagram"],
  ["telegram", "telegram"],
  ["gmgn", "gmgn"],
  ["solana", "solana"],
  ["bsc", "bsc"],
]);

class UnavailableAdapter {
  constructor(name, kind) {
    this.name = name;
    this.kind = kind;
  }

  async preview(source, context) {
    return {
      adapter: this.name,
      kind: this.kind,
      mode: "unavailable",
      source: source.handle || source.focus || this.name,
      summary: `${this.name} live collector is not configured for this source`,
      reason: "live_source_adapter_not_configured",
      requestId: context.requestId,
    };
  }
}

export function createIntegrationRegistry(config = {}) {
  const adapters = new Map([
    ["x", new UnavailableAdapter("X/Twitter", "social")],
    ["tiktok", new UnavailableAdapter("TikTok", "social")],
    ["douyin", new UnavailableAdapter("Douyin", "social")],
    ["instagram", new UnavailableAdapter("Instagram", "social")],
    ["telegram", new UnavailableAdapter("Telegram", "community")],
    ["gmgn", new UnavailableAdapter("GMGN", "market-data")],
    ["solana", new UnavailableAdapter("Solana", "chain-data")],
    ["bsc", new UnavailableAdapter("BSC", "chain-data")],
    ["custom", new UnavailableAdapter("Custom", "custom")],
  ]);
  const gmgnMarket = new GmgnMarketAdapter({
    // GMGN is the product's live market source. Missing credentials or a
    // failed command becomes an explicit data gap from the adapter; it must
    // never be converted into fabricated market data here.
    // The production server passes an explicit true from loadConfig(). Keep
    // an omitted flag unavailable for isolated app/test factories instead of
    // accidentally spawning a real GMGN CLI process.
    enabled: config.gmgnLiveEnabled === true,
    cliPath: config.gmgnCliPath,
    timeoutMs: config.externalTimeoutMs,
    maxRetries: config.externalMaxRetries,
  });
  const gmgnExecution = new GmgnExecutionAdapter({
    // Real execution is the intended product mode. The adapter still fails
    // closed when GMGN credentials or wallet binding are not available, but
    // REAL_EXECUTION_ENABLED is no longer a hidden product kill-switch.
    enabled: config.gmgnExecutionEnabled === true,
    cliPath: config.gmgnCliPath,
    timeoutMs: config.externalTimeoutMs ? Math.max(Number(config.externalTimeoutMs) * 6, 30_000) : 30_000,
  });
  const hertzflow = new HertzFlowAdapter({
    enabled: config.hertzflowLiveEnabled === true && config.gmgnLiveEnabled === true,
    marketAdapter: gmgnMarket,
    timeoutMs: config.externalTimeoutMs ? Math.max(Number(config.externalTimeoutMs) * 8, 60_000) : 120_000,
  });

  return {
    get(platform = "custom") {
      const normalized = String(platform).toLowerCase();
      return adapters.get(PLATFORM_ALIASES.get(normalized) || normalized) || adapters.get("custom");
    },
    list() {
      return [...adapters.values()].filter((adapter) => adapter.name !== "Custom").map(({ name, kind }) => ({
        name,
        kind,
        mode: name === "GMGN"
          ? (gmgnMarket.enabled ? "live_enabled" : "unavailable")
          : "unavailable",
      }));
    },
    scanDevWallets(options) {
      return gmgnMarket.scanDevWallets(options);
    },
    marketTrending(options) {
      return gmgnMarket.marketTrending(options);
    },
    marketTrenches(options) {
      return gmgnMarket.marketTrenches(options);
    },
    marketKline(options) {
      return gmgnMarket.marketKline(options);
    },
    marketSignals(options) {
      return gmgnMarket.marketSignals(options);
    },
    analyzeToken(options) {
      return gmgnMarket.analyzeToken(options);
    },
    tokenSecurity(options) {
      return gmgnExecution.tokenSecurity(options);
    },
    executeMultiSwap(options) {
      return gmgnExecution.multiSwap(options);
    },
    getTradeOrder(options) {
      return gmgnExecution.waitForOrder(options);
    },
    async analyzeMeme(options) {
      const normalizedOptions = {
        ...options,
        address: options?.address || options?.contractAddress,
      };
      const hertzflowResult = await hertzflow.analyze(normalizedOptions);
      return {
        ...hertzflowResult,
        provider: "hertzflow",
        source: "hertzflow",
        ...(hertzflowResult.status === "completed" ? { analysis_status: "completed" } : {}),
      };
    },
  };
}
