import test from "node:test";
import assert from "node:assert/strict";
import { GmgnMarketAdapter } from "../../integrations/gmgn-market-adapter.mjs";
import { HertzFlowAdapter } from "../../integrations/hertzflow-adapter.mjs";
import { prepareNarrativeLink } from "../../integrations/narrative-link-adapter.mjs";
import { resolveLaunchPlatform } from "../../integrations/launch-platform-registry.mjs";
import { InMemoryDevWalletRepository } from "../src/repositories/in-memory-dev-wallet-repository.mjs";

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

test("launch platform mapping is fixed to the product chain choices", () => {
  assert.equal(resolveLaunchPlatform({ chain: "solana" }).id, "pump");
  assert.equal(resolveLaunchPlatform({ chain: "bsc" }).id, "fourmeme");
  assert.equal(resolveLaunchPlatform({ chain: "robinhood" }).id, "pons");
  assert.equal(resolveLaunchPlatform({ chain: "bsc", platform: "pump" }).chain, "solana");
});

test("HertzFlow is read-only, opt-in, and currently Solana-only", async () => {
  const adapter = new HertzFlowAdapter({ enabled: false });
  const sol = await adapter.analyze({ chain: "solana", contractAddress: "So11111111111111111111111111111111111111112" });
  assert.equal(sol.status, "disabled");
  const bsc = await adapter.analyze({ chain: "bsc", contractAddress: "0x1111111111111111111111111111111111111111" });
  assert.equal(bsc.status, "unsupported_chain");
});
