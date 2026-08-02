// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { GmgnMarketAdapter } from "../../integrations/gmgn-market-adapter.ts";
import { HertzFlowAdapter } from "../../integrations/hertzflow-adapter.ts";
import { fetchNarrativeLink, prepareNarrativeLink } from "../../integrations/narrative-link-adapter.ts";
import { createMockHandlers } from "../../agents/mock-handlers.ts";
import { parseGoInput } from "../../agents/go-command-parser.ts";
import { resolveLaunchPlatform } from "../../integrations/launch-platform-registry.ts";
import { InMemoryDevWalletRepository } from "../src/repositories/in-memory-dev-wallet-repository.ts";
import { InMemoryLaunchDraftRepository } from "../src/repositories/in-memory-launch-draft-repository.ts";

test("GMGN adapter returns explicit disabled and unsupported states", async () => {
  const disabled = new GmgnMarketAdapter({ enabled: false });
  const result = await disabled.scanDevWallets({ chain: "solana", requestId: "request-test" });
  assert.equal(result.status, "disabled");
  assert.equal(result.request_id, "request-test");
  assert.deepEqual(result.tokens, []);

  const enabled = new GmgnMarketAdapter({ enabled: true });
  const unsupported = await enabled.scanDevWallets({ chain: "robinhood" });
  assert.equal(unsupported.status, "unsupported_chain");
  assert.deepEqual(unsupported.tokens, []);
});

test("GMGN adapter builds bounded read-only market commands", async () => {
  const calls = [];
  const adapter = new GmgnMarketAdapter({
    enabled: true,
    cliPath: "gmgn-cli",
    execFileImpl: async (_file, args) => {
      calls.push(args);
      return { stdout: JSON.stringify({ data: [{ address: "TokenAddress" }] }) };
    },
  });

  const trending = await adapter.marketTrending({ chain: "solana", limit: 12, requestId: "trending-test" });
  assert.equal(trending.status, "live");
  assert.equal(trending.chain, "solana");
  const trendingStart = calls[0].indexOf("market");
  assert.deepEqual(calls[0].slice(trendingStart, trendingStart + 6), ["market", "trending", "--chain", "sol", "--interval", "1h"]);
  assert.ok(calls[0].includes("--raw"));

  const kline = await adapter.marketKline({
    chain: "solana",
    address: "So11111111111111111111111111111111111111112",
    resolution: "15m",
  });
  assert.equal(kline.status, "live");
  const klineResolutionIndex = calls[1].indexOf("--resolution");
  assert.ok(klineResolutionIndex >= 0);
  assert.equal(calls[1][klineResolutionIndex + 1], "15m");

  const unsupported = await adapter.marketSignals({ chain: "base" });
  assert.equal(unsupported.status, "unsupported_chain");
});

test("GMGN Solana forensic research bounds fan-out and reuses wallet tags", async () => {
  let active = 0;
  let maxActive = 0;
  const adapter = new GmgnMarketAdapter({
    enabled: true,
    cliPath: "gmgn-cli",
    maxRetries: 2,
    execFileImpl: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {
        stdout: JSON.stringify({
          list: [{
            address: "Wallet11111111111111111111111111111111111111",
            amount_percentage: 0.25,
            tags: ["smart_degen"],
          }],
        }),
      };
    },
  });
  const result = await adapter.fetchSolanaMemeResearch({
    address: "So11111111111111111111111111111111111111112",
    requestId: "hertzflow-test",
  });
  assert.equal(result.status, "live");
  assert.equal(result.tag_scans_enabled, false);
  assert.deepEqual(Object.keys(result.component_statuses), ["info", "security", "pool", "holders", "traders"]);
  assert.ok(maxActive <= 3);
});

test("Dev wallet repository registers GMGN creator evidence", () => {
  const repository = new InMemoryDevWalletRepository();
  repository.registerFromTokens([{
    chain: "solana",
    token_address: "TokenAddress",
    creator_address: "CreatorAddress",
    symbol: "MEME",
    name: "Meme",
    platform_id: "pump",
    launchpad_platform: "Pump.fun",
  }], "2026-07-12T00:00:00.000Z");
  const wallets = repository.list({ chain: "solana" });
  assert.equal(wallets.length, 1);
  assert.equal(wallets[0].address, "CreatorAddress");
  assert.equal(wallets[0].tokens[0].token_address, "TokenAddress");
  repository.applyStats([{ chain: "solana", address: "CreatorAddress", period: "7d", realized_profit_usd: "100.10" }], "2026-07-12T01:00:00.000Z");
  repository.applyStats([{ chain: "solana", address: "CreatorAddress", period: "7d", realized_profit_usd: "101.25" }], "2026-07-12T02:00:00.000Z");
  const enriched = repository.list({ chain: "solana" })[0];
  assert.equal(enriched.performance["7d"].previous_realized_profit_usd, "100.10");
  assert.equal(enriched.performance["7d"].realized_profit_change_usd, "1.15");
});

test("narrative URLs reject private network targets", () => {
  assert.equal(prepareNarrativeLink("http://127.0.0.1/admin").status, "rejected");
  assert.equal(prepareNarrativeLink("http://192.168.1.5/private").status, "rejected");
  assert.equal(prepareNarrativeLink("https://example.com/story#fragment").status, "metadata_fetch_pending");
});

test("public X links are fetched and become review-only launch parameters", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    status: 200,
    ok: true,
    headers: { get: () => "application/json" },
    async text() {
      assert.match(String(url), /publish\.twitter\.com\/oembed/);
      return JSON.stringify({
        author_name: "coolish",
        author_url: "https://x.com/coolish",
        html: "<blockquote><p lang=\"zh\">一个真实的公开叙事文本</p></blockquote>",
      });
    },
  });
  try {
    const narrative = await fetchNarrativeLink("https://x.com/coolish/status/2083800621321535680?s=20");
    assert.equal(narrative.status, "live");
    assert.equal(narrative.fetched, true);
    assert.match(narrative.content, /真实的公开叙事文本/);

    const repository = new InMemoryLaunchDraftRepository();
    const handlers = createMockHandlers({}, { launchDraftRepository: repository });
    const result = await handlers["launch.meme"](
      { prompt: "https://x.com/coolish/status/2083800621321535680?s=20", chain: "solana" },
      { taskId: "task-link", requestId: "request-link", conversationId: "conversation-link", emitEvent() {} },
    );
    assert.equal(result.card.type, "launch_draft");
    assert.equal(result.launch_parameters.source_status, "live");
    assert.equal(result.launch_parameters.chain, "solana");
    assert.equal(result.launch_parameters.platform, "pump");
    assert.match(result.narrative.summary, /真实的公开叙事文本/);
    assert.equal(result.executable, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a bare public link routes to the launch draft workflow", () => {
  const parsed = parseGoInput("https://x.com/coolish/status/2083800621321535680?s=20");
  assert.equal(parsed.type, "launch.meme");
  assert.equal(parsed.parsed_by, "public_link");
  assert.equal(parsed.execution_mode, "disabled");
});

test("launch platform mapping is fixed to the product chain choices", () => {
  assert.equal(resolveLaunchPlatform({ chain: "solana" }).id, "pump");
  assert.equal(resolveLaunchPlatform({ chain: "bsc" }).id, "fourmeme");
  const pons = resolveLaunchPlatform({ chain: "robinhood" });
  assert.equal(pons.id, "pons");
  assert.equal(pons.factory_address, "0x0c37a24f5d23a486fa692d1500881d698b1f77a4");
  assert.equal(pons.launch_fee_wei, "500000000000000");
  assert.equal(pons.browser_execution_mode, "direct_wallet_confirmation");
  assert.equal(resolveLaunchPlatform({ chain: "bsc", platform: "pump" }).chain, "solana");
});

test("HertzFlow is read-only, opt-in, and currently Solana-only", async () => {
  const adapter = new HertzFlowAdapter({ enabled: false });
  const sol = await adapter.analyze({ chain: "solana", contractAddress: "So11111111111111111111111111111111111111112" });
  assert.equal(sol.status, "disabled");
  const bsc = await adapter.analyze({ chain: "bsc", contractAddress: "0x1111111111111111111111111111111111111111" });
  assert.equal(bsc.status, "unsupported_chain");
});

test("HertzFlow builds a live Solana forensic report from GMGN research", async () => {
  const source = "Source11111111111111111111111111111111111111";
  const funder = "Funder11111111111111111111111111111111111111";
  const collector = "Collector111111111111111111111111111111111111";
  const rows = [
    {
      address: "Wallet11111111111111111111111111111111111111",
      amount_percentage: "58.66%",
      tags: ["bundler"],
      buy_volume_usd: "100000",
      sell_volume_usd: "70000",
      native_transfer: { from_address: funder },
      token_transfer_in: { address: source },
      token_transfer_out: { address: collector },
    },
    {
      address: "Wallet22222222222222222222222222222222222222",
      amount_percentage: "8%",
      tags: ["dex_bot"],
      buy_volume_usd: "50000",
      sell_volume_usd: "90000",
      native_transfer: { from_address: funder },
      token_transfer_in: { address: source },
    },
  ];
  const adapter = new HertzFlowAdapter({
    enabled: true,
    timeoutMs: 1_000,
    marketAdapter: {
      async fetchSolanaMemeResearch() {
        return {
          status: "live",
          address: "So11111111111111111111111111111111111111112",
          observed_at: "2026-08-02T00:00:00.000Z",
          limit: 100,
          component_statuses: { info: "live", pool: "live", holders: "live", traders: "live" },
          data: {
            info: { price_usd: 1.2, market_cap_usd: 1_000_000, holder_count: 100 },
            pool: { liquidity_usd: 500_000 },
            holders: rows,
            traders: rows,
          },
        };
      },
    },
  });
  const result = await adapter.analyze({ chain: "solana", contractAddress: "So11111111111111111111111111111111111111112" });
  assert.equal(result.status, "completed");
  assert.equal(result.provider, "hertzflow");
  assert.equal(result.machine_report.schema, "hertzflow_sol_meme_forensic_v1");
  assert.equal(result.machine_report.metrics.top1_hold_rate, 0.5866);
  assert.equal(result.machine_report.top_clusters.relationship[0].wallet_count, 2);
  assert.ok(result.watchlist.length >= 2);
  assert.match(result.forensic_report, /Relationship graph conclusion/);
});
