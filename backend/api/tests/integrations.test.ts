// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { GmgnMarketAdapter } from "../../integrations/gmgn-market-adapter.ts";
import { SOL, SolanaSwapAdapter } from "../../integrations/solana-swap-adapter.ts";
import { fetchNarrativeLink, prepareNarrativeLink } from "../../integrations/narrative-link-adapter.ts";
import { createAgentHandlers } from "../../agents/agent-handlers.ts";
import { parseGoInput } from "../../agents/go-command-parser.ts";
import { resolveLaunchPlatform } from "../../integrations/launch-platform-registry.ts";
import { InMemoryDevWalletRepository } from "../src/repositories/in-memory-dev-wallet-repository.ts";
import { InMemoryLaunchDraftRepository } from "../src/repositories/in-memory-launch-draft-repository.ts";

test("GMGN adapter returns explicit provider availability and unsupported states", async () => {
  const unavailable = new GmgnMarketAdapter({ enabled: false });
  const result = await unavailable.scanDevWallets({ chain: "solana", requestId: "request-test" });
  assert.equal(result.status, "unavailable");
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

test("direct Solana swap prepares a client-signable transaction without broadcasting", async () => {
  const wallet = Keypair.generate().publicKey;
  const token = Keypair.generate().publicKey;
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [],
    }).compileToV0Message(),
  );
  const encoded = Buffer.from(transaction.serialize()).toString("base64");
  const calls = [];
  const adapter = new SolanaSwapAdapter({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("/quote?")) {
        return {
          ok: true,
          async json() {
            return { outAmount: "456", priceImpactPct: "0.01", routePlan: [] };
          },
        };
      }
      return {
        ok: true,
        async json() {
          return { swapTransaction: encoded, lastValidBlockHeight: 99 };
        },
      };
    },
  });
  const result = await adapter.prepare({
    walletAddress: wallet.toBase58(),
    inputToken: SOL,
    outputToken: token.toBase58(),
    amountAtomic: "123",
    slippageBps: 300,
  });
  assert.equal(result.status, "requires_user_signature");
  assert.equal(result.input_amount_atomic, "123");
  assert.equal(result.slippage_bps, 300);
  assert.equal(result.transaction_base64, encoded);
  assert.match(calls[0].url, /amount=123/);
  assert.equal(calls[0].options.headers["x-api-key"], "test-key");
});

test("percentage sell resolves the selected Assets wallet token balance", async () => {
  const wallet = Keypair.generate().publicKey;
  const token = Keypair.generate().publicKey;
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [],
    }).compileToV0Message(),
  );
  const encoded = Buffer.from(transaction.serialize()).toString("base64");
  const requested = [];
  const adapter = new SolanaSwapAdapter({
    rpcUrl: "https://rpc.example.test",
    fetchImpl: async (url) => {
      requested.push(String(url));
      if (String(url) === "https://rpc.example.test") {
        return {
          ok: true,
          async json() {
            return { result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "1000" } } } } } }] } };
          },
        };
      }
      if (String(url).includes("/quote?")) {
        assert.match(String(url), /amount=250/);
        return { ok: true, async json() { return { outAmount: "12", routePlan: [] }; } };
      }
      return { ok: true, async json() { return { swapTransaction: encoded }; } };
    },
  });
  const result = await adapter.prepare({
    walletAddress: wallet.toBase58(),
    inputToken: token.toBase58(),
    outputToken: SOL,
    percentBps: 2500,
  });
  assert.equal(result.status, "requires_user_signature");
  assert.equal(result.input_amount_atomic, "250");
  assert.equal(requested[0], "https://rpc.example.test");
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
    const handlers = createAgentHandlers({}, { launchDraftRepository: repository });
    const result = await handlers["launch.meme"](
      { prompt: "https://x.com/coolish/status/2083800621321535680?s=20", chain: "solana" },
      { taskId: "task-link", requestId: "request-link", conversationId: "conversation-link", emitEvent() {} },
    );
    assert.equal(result.card.type, "launch_draft");
    assert.equal(result.launch_parameters.source_status, "live");
    assert.equal(result.launch_parameters.chain, "solana");
    assert.equal(result.launch_parameters.platform, "pump");
    assert.match(result.narrative.summary, /真实的公开叙事文本/);
    assert.equal(result.executable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("X links use the full public post body and media thumbnail when oEmbed is truncated", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("publish.twitter.com/oembed")) {
      return {
        status: 200,
        ok: true,
        headers: { get: () => "application/json" },
        async text() {
          return JSON.stringify({
            author_name: "Rothmus",
            html: "<blockquote><p>Short public preview… <a href=\"https://t.co/media\">pic.twitter.com/media</a></p></blockquote>",
          });
        },
      };
    }
    assert.match(String(url), /api\.fxtwitter\.com\/status\/2083629332816429240/);
    return {
      status: 200,
      ok: true,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
          tweet: {
            text: "The full public post body used by the launch draft.",
            media: { all: [{ type: "video", thumbnail_url: "https://pbs.twimg.com/video-thumb.jpg" }] },
          },
        });
      },
    };
  };
  try {
    const narrative = await fetchNarrativeLink("https://x.com/Rothmus/status/2083629332816429240?s=20");
    assert.equal(narrative.content, "The full public post body used by the launch draft.");
    assert.equal(narrative.image_url, "https://pbs.twimg.com/video-thumb.jpg");
    assert.equal(narrative.fetch_method, "twitter_oembed+fxtwitter");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a bare public link routes to the launch draft workflow", () => {
  const parsed = parseGoInput("https://x.com/coolish/status/2083800621321535680?s=20");
  assert.equal(parsed.type, "launch.meme");
  assert.equal(parsed.parsed_by, "public_link");
  assert.equal(parsed.execution_mode, "live_confirmation_required");
});

test("Chinese natural-language intents route without encoding loss", () => {
  assert.equal(parseGoInput("介绍自己").type, "agent.chat");
  assert.equal(parseGoInput("用 cooking1 买入 0.2 SOL").type, "trade.buy.batch");
  assert.equal(parseGoInput("用 kol2 卖出 50%").type, "trade.sell.batch");
  assert.equal(parseGoInput("发射这个 meme").type, "launch.meme");
  assert.equal(parseGoInput("我要发币").type, "launch.meme");
  assert.equal(parseGoInput("帮我创建代币").type, "launch.meme");
  assert.equal(parseGoInput("发行代币").type, "launch.meme");
  assert.equal(parseGoInput("帮我 launch 这个项目").type, "launch.meme");
  assert.equal(parseGoInput("发行量多少").type, "agent.chat");
  assert.equal(parseGoInput("把资金转到 cooking 钱包组").type, "funds.transfer");
});

test("user analytics intents route to actor-scoped summary handlers", () => {
  assert.equal(parseGoInput("/my-launches").type, "account.launches.summary");
  assert.equal(parseGoInput("/launch-history").type, "account.launches.summary");
  assert.equal(parseGoInput("/my-projects").type, "account.project.performance");
  assert.equal(parseGoInput("/my-pnl").type, "account.pnl.summary");
  assert.equal(parseGoInput("我发射过多少个 meme").type, "account.launches.summary");
  assert.equal(parseGoInput("我的项目表现如何").type, "account.project.performance");
  assert.equal(parseGoInput("我赚了多少").type, "account.pnl.summary");
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

test("launch.meme prefills editable amounts from confirmed Memory without overriding explicit input", async () => {
  const base = { taskId: "task-mem", requestId: "req-mem", conversationId: "conv-mem", emitEvent() {} };

  const handlers = createAgentHandlers({}, { launchDraftRepository: new InMemoryLaunchDraftRepository() });
  const prefilled = await handlers["launch.meme"](
    {
      prompt: "https://example.com/meme-story",
      chain: "solana",
      context: {
        memory_prefill: [
          { kind: "user_preference", content: "cooking 金额 2 SOL，bundled 总额 5 SOL" },
        ],
      },
    },
    base,
  );
  assert.equal(prefilled.card.type, "launch_draft");
  assert.equal(prefilled.launch_parameters.token.initial_buy, "2");
  assert.equal(prefilled.launch_parameters.token.bundle_buy_total, "5");
  assert.equal(prefilled.metadata.memory_prefill.cooking_amount, "2");
  assert.equal(prefilled.metadata.memory_prefill.bundled_total, "5");

  const explicitHandlers = createAgentHandlers({}, { launchDraftRepository: new InMemoryLaunchDraftRepository() });
  const explicitWins = await explicitHandlers["launch.meme"](
    {
      prompt: "https://example.com/meme-story",
      chain: "solana",
      token: { initial_buy: "0.1" },
      context: {
        memory_prefill: [
          { kind: "user_preference", content: "cooking 金额 2 SOL" },
        ],
      },
    },
    base,
  );
  assert.equal(explicitWins.launch_parameters.token.initial_buy, "0.1");
});

test("launch.meme prefills wallet groups and slippage from confirmed Memory", async () => {
  const handlers = createAgentHandlers({}, { launchDraftRepository: new InMemoryLaunchDraftRepository() });
  const base = { taskId: "task-mem2", requestId: "req-mem2", conversationId: "conv-mem2", emitEvent() {} };
  const result = await handlers["launch.meme"](
    {
      prompt: "https://example.com/meme-story",
      chain: "solana",
      context: {
        memory_prefill: [
          { kind: "user_preference", content: "cooking 钱包组 Alpha，bundled 钱包组 Bravo，滑点 5%" },
        ],
      },
    },
    base,
  );
  assert.equal(result.card.type, "launch_draft");
  assert.equal(result.cooking_wallet_group_id, "Alpha");
  assert.equal(result.bundled_wallet_group_id, "Bravo");
  assert.equal(result.launch_parameters.slippage_bps, 500);
  assert.equal(result.metadata.memory_prefill.cooking_group, "Alpha");
  assert.equal(result.metadata.memory_prefill.bundled_group, "Bravo");
  assert.equal(result.metadata.memory_prefill.slippage_bps, "500");

  const explicitSlippage = await handlers["launch.meme"](
    {
      prompt: "https://example.com/meme-story",
      chain: "solana",
      token: { slippage_percent: "10" },
      context: {
        memory_prefill: [
          { kind: "user_preference", content: "滑点 5%" },
        ],
      },
    },
    { ...base, conversationId: "conv-mem3" },
  );
  assert.equal(explicitSlippage.launch_parameters.slippage_bps, 1000);
});
