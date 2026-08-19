// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRuntime, normalizeLaunchDraftPatch } from "../../agents/agent-runtime.ts";
import {
  formatTelegramReply,
  parseTelegramUpdate,
} from "../../agents/channels/telegram.ts";

test("agent runtime turns a slash command into a structured card", async () => {
  const runtime = createAgentRuntime({ stepDelayMs: 1 });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "/dev-market solana",
    command: "/dev-market solana",
    context: { language: "en", currentView: "go" },
    wait: true,
    timeoutMs: 3000,
  });
  assert.equal(result.channel, "web");
  assert.ok(result.conversation_id);
  assert.ok(result.task_id);
  assert.equal(result.status, "succeeded");
  assert.equal(result.cards[0]?.type, "dev_market");
  assert.equal(result.persistence, "memory");
});

test("agent runtime exposes GMGN read-only market tasks", async () => {
  const runtime = createAgentRuntime({ stepDelayMs: 1 });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "/market-trending solana",
    command: "/market-trending solana",
    context: { language: "zh", currentView: "go" },
    wait: true,
    timeoutMs: 3000,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.task.type, "market.trending");
  assert.equal(result.cards[0]?.type, "market_trending");
  assert.equal(result.cards[0]?.data?.data_source, "gmgn");
  assert.equal(result.cards[0]?.data?.data_source_status, "unavailable");
});

test("agent runtime uses an OpenAI-compatible model for general conversation", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalModel = process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = "test-only-key";
  process.env.OPENAI_MODEL = "test-model";
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, "test-model");
    assert.equal(request.stream, false);
    assert.equal(request.messages[0].role, "system");
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                content: "真实模型已接入：我可以帮助你发现叙事、分析风险并生成 review-only 方案。",
                suggestion: "告诉我你想研究的叙事或贴一条公开链接。",
              }),
            },
          }],
        };
      },
    };
  };

  try {
    const runtime = createAgentRuntime({ stepDelayMs: 1 });
    const result = await runtime.handleMessage({
      channel: "web",
      message: "介绍下你可以做什么",
      context: { language: "zh", currentView: "go" },
      wait: true,
      timeoutMs: 3000,
    });
    assert.equal(result.status, "succeeded");
    assert.equal(result.task.execution_mode, "assistant");
    assert.equal(result.agent.provider, "openai_compatible");
    assert.equal(result.agent.used_llm, true);
    assert.equal(result.message.content, "真实模型已接入：我可以帮助你发现叙事、分析风险并生成 review-only 方案。");
    assert.equal(result.cards.length, 0);
    const conversation = await runtime.getConversation(result.conversation_id);
    assert.equal(conversation.messages.at(-1).content, result.message.content);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    if (originalModel === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = originalModel;
  }
});

test("launch draft can be created and patched through runtime", async () => {
  const runtime = createAgentRuntime({ stepDelayMs: 1 });
  const created = await runtime.handleMessage({
    channel: "web",
    message: "/launch https://example.com/story solana pump",
    command: "/launch https://example.com/story solana pump",
    context: { language: "en", currentView: "go" },
    wait: true,
    timeoutMs: 15000,
  });
  assert.equal(created.status, "succeeded");
  assert.equal(created.cards[0]?.type, "launch_draft");
  const draftId = created.cards[0]?.data?.launch_draft_id;
  assert.ok(draftId);

  const updated = await runtime.updateLaunchDraft(draftId, {
    token: {
      name: "Raccoon Mayor",
      symbol: "RACC",
       description: "A review-only meme draft",
       image_url: "https://example.com/racc.png",
       bundle_buy_total: "0.1",
    },
  });
  assert.equal(updated.card.type, "launch_draft");
  assert.equal(updated.draft.token.symbol, "RACC");
  assert.equal(updated.draft.token.bundle_buy_total, "0.1");
  assert.equal(updated.draft.preparation_status, "requires_wallet_selection");
  assert.deepEqual(updated.draft.missing_fields, []);
  assert.deepEqual(updated.draft.required_user_selections, [
    "cooking_wallet_group_id",
    "bundled_wallet_group_id",
  ]);

  const walletReady = await runtime.updateLaunchDraft(draftId, {
    cooking_wallet_group_id: "cook-group",
    bundled_wallet_group_id: "bundle-group",
  });
  assert.equal(walletReady.draft.cooking_wallet_group_id, "cook-group");
  assert.equal(walletReady.draft.bundled_wallet_group_id, "bundle-group");
  assert.equal(walletReady.draft.preparation_status, "ready_for_user_review");
  assert.deepEqual(walletReady.draft.required_user_selections, []);

  const reviewed = await runtime.updateLaunchDraft(draftId, { action: "mark_reviewed" });
  assert.equal(reviewed.draft.metadata.review_status, "reviewed");
  assert.equal(reviewed.draft.metadata.content_provider, "unconfigured");
  await assert.rejects(
    () => runtime.updateLaunchDraft(draftId, { token: { private_key: "never-store-this" } }),
    (error) => error.code === "SENSITIVE_INPUT_REJECTED",
  );
});

test("a follow-up launch request reuses the link-derived draft from the same conversation", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/publish\.twitter\.com\/oembed\?/);
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      async text() {
        return JSON.stringify({
          author_name: "Paul",
          author_url: "https://x.com/coolish",
          html: "<blockquote><p>Decoy alpha is the meme narrative for today.</p></blockquote>",
        });
      },
    };
  };

  try {
    const runtime = createAgentRuntime({ stepDelayMs: 1 });
    const first = await runtime.handleMessage({
      channel: "web",
      message: "https://x.com/coolish/status/2083800621321535680?s=20",
      context: { language: "zh", currentView: "go" },
      wait: true,
      timeoutMs: 3000,
    });
    assert.equal(first.status, "succeeded");
    assert.equal(first.task.type, "launch.meme");
    assert.equal(first.cards[0]?.type, "launch_draft");
    const firstDraftId = first.cards[0]?.data?.launch_draft_id;
    assert.ok(firstDraftId);

    const second = await runtime.handleMessage({
      channel: "web",
      conversationId: first.conversation_id,
      message: "给我生成发射草案",
      context: { language: "zh", currentView: "go" },
      wait: true,
      timeoutMs: 3000,
    });
    assert.equal(second.status, "succeeded");
    assert.equal(second.task.type, "launch.meme");
    assert.equal(second.cards[0]?.type, "launch_draft");
    assert.equal(second.cards[0]?.data?.launch_draft_id, firstDraftId);
    assert.equal(second.cards[0]?.data?.reused_existing_draft, true);
    assert.equal(
      second.cards[0]?.data?.launch_parameters?.source_url,
      "https://x.com/coolish/status/2083800621321535680?s=20",
    );
    assert.match(second.message.content, /发射预案/);

    const third = await runtime.handleMessage({
      channel: "web",
      conversationId: first.conversation_id,
      message: "该链接是什么内容",
      context: { language: "zh", currentView: "go" },
      wait: true,
      timeoutMs: 3000,
    });
    assert.equal(third.status, "succeeded");
    assert.equal(third.task.type, "agent.chat");
    assert.match(third.message.content, /Decoy alpha is the meme narrative for today/);
    assert.doesNotMatch(third.message.content, /我可以做叙事发现/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("conversation messages are restored after create", async () => {
  const runtime = createAgentRuntime({ stepDelayMs: 1 });
  const first = await runtime.handleMessage({
    channel: "web",
    message: "/meme raccoon mayor",
    command: "/meme raccoon mayor",
    context: { language: "en", currentView: "go" },
    wait: true,
    timeoutMs: 3000,
  });
  const conversation = await runtime.getConversation(first.conversation_id);
  assert.ok(conversation);
  assert.ok(conversation.messages.length >= 2);
  assert.equal(conversation.messages[0].role, "user");
  assert.equal(conversation.messages.at(-1).role, "assistant");
});

test("telegram adapter parses bot updates and formats replies", async () => {
  const parsed = parseTelegramUpdate({
    message: {
      message_id: 9,
      text: "/meme raccoon mayor",
      chat: { id: 12345 },
      from: { id: 99, username: "dev", language_code: "en" },
    },
  });
  assert.equal(parsed.handled, true);
  assert.equal(parsed.channel, "telegram");
  assert.equal(parsed.command, "/meme");

  const runtime = createAgentRuntime({ stepDelayMs: 1 });
  const result = await runtime.handleMessage({
    channel: "telegram",
    message: parsed.message,
    command: parsed.command,
    context: parsed.context,
    wait: true,
    timeoutMs: 3000,
  });
  const reply = formatTelegramReply(result, "en");
  assert.match(reply.text, /Card: meme_package|Meme package ready|Task completed/i);
});

test("unsupported telegram updates are ignored", () => {
  const parsed = parseTelegramUpdate({ update_id: 1 });
  assert.equal(parsed.handled, false);
});

test("launch draft patch preserves frontend token fields and rejects secrets", () => {
  const normalized = normalizeLaunchDraftPatch({
    token: {
      name: "Raccoon Mayor",
      symbol: "RACC",
      description: "A review-only meme draft",
      image_url: "https://example.com/racc.png",
      initial_buy: "0.05",
      bundle_buy_total: "0.1",
    },
    cooking_wallet_group_id: "cook-group",
    bundled_wallet_group_id: "bundle-group",
  });
  assert.equal(normalized.token.bundle_buy_total, "0.1");
  assert.equal(normalized.token.initial_buy, "0.05");
  assert.equal(normalized.cooking_wallet_group_id, "cook-group");
  assert.equal(normalized.bundled_wallet_group_id, "bundle-group");

  assert.throws(
    () => normalizeLaunchDraftPatch({ token: { name: "x", privateKey: "abc123" } }),
    (error: any) => error.code === "SENSITIVE_INPUT_REJECTED",
  );
  assert.throws(
    () => normalizeLaunchDraftPatch({ token: { name: "x", seedPhrase: "abc" } }),
    (error: any) => error.code === "SENSITIVE_INPUT_REJECTED",
  );
  assert.throws(
    () => normalizeLaunchDraftPatch("not-an-object"),
    (error: any) => error.code === "VALIDATION_ERROR",
  );
});

test("/launch routes to meme-launch-plan and produces an editable launch draft card", async () => {
  const runtime = createAgentRuntime({ stepDelayMs: 1 });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "/launch https://example.com/story",
    command: "/launch https://example.com/story",
    context: { language: "en", currentView: "go" },
    wait: true,
    timeoutMs: 12000,
  });
  assert.equal(result.status, "succeeded");
  const card = result.cards?.[0];
  assert.equal(card?.type, "launch_draft");
  assert.equal(card?.data?.skill, "meme-launch-plan");
  assert.equal(card?.data?.execution_mode, "live");
  assert.ok("launch_parameters" in (card?.data || {}));
  assert.ok(card?.data?.required_user_selections?.includes("cooking_wallet_group_id"));
});

test("memory prefill parses confirmed launch preferences as editable suggestions", async () => {
  const { memoryPrefillForLaunch } = await import("../../agents/agent-handlers.ts");
  const prefill = memoryPrefillForLaunch({
    context: {
      memory_prefill: [
        { kind: "user_preference", content: "cooking 金额 2 SOL，bundled 总额 5 SOL" },
      ],
    },
  });
  assert.equal(prefill.cooking_amount, "2");
  assert.equal(prefill.bundled_total, "5");

  const noMatch = memoryPrefillForLaunch({ context: { memory_prefill: [] } });
  assert.equal(noMatch.cooking_amount, null);
  assert.equal(noMatch.bundled_total, null);

  const chainPrefill = memoryPrefillForLaunch({
    context: { memory_prefill: [{ kind: "user_preference", content: "默认用 Solana 发射" }] },
  });
  assert.equal(chainPrefill.default_chain, "solana");

  const groupsPrefill = memoryPrefillForLaunch({
    context: {
      memory_prefill: [
        { kind: "user_preference", content: "cooking 钱包组 Alpha，bundled 钱包组 Bravo，滑点 5%" },
      ],
    },
  });
  assert.equal(groupsPrefill.default_cooking_group, "Alpha");
  assert.equal(groupsPrefill.default_bundled_group, "Bravo");
  assert.equal(groupsPrefill.default_slippage_bps, "500");
});

test("plain chat with narrative intent injects Pulse candidates into model context", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  let modelContext = "";
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    modelContext = request.messages.at(-1)?.content || "";
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                content: "这里有几个热门叙事候选：",
                suggestion: "告诉我选哪个。",
              }),
            },
          }],
        };
      },
    };
  };

  const narrativeRepository = {
    async listActive({ topic = "", limit = 12 } = {}) {
      return [{
        narrative_id: "narrative-1",
        original_text: "AI agents are becoming meme royalty",
        category: "tech",
        platform: "twitter",
        author_name: "coolish",
        source_url: "https://x.com/coolish/status/1",
        published_at: new Date().toISOString(),
      }];
    },
  };

  try {
    const runtime = createAgentRuntime({ stepDelayMs: 1, narrativeRepository });
    const result = await runtime.handleMessage({
      channel: "web",
      message: "看看有什么叙事",
      context: { language: "zh", currentView: "go" },
      wait: true,
      timeoutMs: 3000,
    });
    assert.equal(result.status, "succeeded");
    assert.match(modelContext, /pulse_narratives/);
    assert.match(modelContext, /AI agents are becoming meme royalty/);
    assert.match(modelContext, /narrative-1/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});

test("plain chat with assets intent injects wallet groups for an authenticated actor", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-only-key";
  let modelContext = "";
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    modelContext = request.messages.at(-1)?.content || "";
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [{
            message: {
              content: JSON.stringify({ content: "你的钱包组如下：", suggestion: "还要我做什么？" }),
            },
          }],
        };
      },
    };
  };
  const walletGroupRepository = {
    async listGroups(ownerUserId) {
      assert.equal(ownerUserId, "user-1");
      return [{ groupId: "group-1", name: "Alpha", purpose: "cooking", network: "solana", walletCount: 1 }];
    },
  };
  try {
    const runtime = createAgentRuntime({ stepDelayMs: 1, walletGroupRepository });
    const result = await runtime.handleMessage({
      channel: "web",
      message: "我的钱包组有哪些",
      context: { language: "zh", currentView: "go", userId: "user-1" },
      wait: true,
      timeoutMs: 3000,
    });
    assert.equal(result.status, "succeeded");
    assert.match(modelContext, /assets_groups/);
    assert.match(modelContext, /Alpha/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
