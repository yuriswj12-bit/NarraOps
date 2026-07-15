const PLATFORM_ALIASES = new Map([
  ["x", "x"],
  ["twitter", "x"],
  ["tiktok", "tiktok"],
  ["instagram", "instagram"],
  ["telegram", "telegram"],
  ["gmgn", "gmgn"],
  ["solana", "solana"],
  ["bsc", "bsc"],
]);

class MockAdapter {
  constructor(name, kind) {
    this.name = name;
    this.kind = kind;
  }

  async preview(source, context) {
    return {
      adapter: this.name,
      kind: this.kind,
      mode: "mock",
      source: source.handle || source.focus || this.name,
      summary: `${this.name} mock signal for ${source.handle || source.focus || "configured source"}`,
      requestId: context.requestId,
    };
  }
}

export function createIntegrationRegistry() {
  const adapters = new Map([
    ["x", new MockAdapter("X/Twitter", "social")],
    ["tiktok", new MockAdapter("TikTok", "social")],
    ["instagram", new MockAdapter("Instagram", "social")],
    ["telegram", new MockAdapter("Telegram", "community")],
    ["gmgn", new MockAdapter("GMGN", "market-data")],
    ["solana", new MockAdapter("Solana", "chain-data")],
    ["bsc", new MockAdapter("BSC", "chain-data")],
    ["custom", new MockAdapter("Custom", "custom")],
  ]);

  return {
    get(platform = "custom") {
      const normalized = String(platform).toLowerCase();
      return adapters.get(PLATFORM_ALIASES.get(normalized) || normalized) || adapters.get("custom");
    },
    list() {
      return [...adapters.values()].filter((adapter) => adapter.name !== "Custom").map(({ name, kind }) => ({ name, kind, mode: "mock" }));
    },
  };
}
