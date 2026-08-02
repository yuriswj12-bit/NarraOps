// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { createAgentRuntime } from "../../agents/agent-runtime.ts";
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
    timeoutMs: 4000,
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
    },
  });
  assert.equal(updated.card.type, "launch_draft");
  assert.equal(updated.draft.token.symbol, "RACC");
  assert.equal(updated.draft.preparation_status, "ready_for_user_review");
  assert.deepEqual(updated.draft.missing_fields, []);

  const reviewed = await runtime.updateLaunchDraft(draftId, { action: "mark_reviewed" });
  assert.equal(reviewed.draft.metadata.review_status, "reviewed");
  assert.equal(reviewed.draft.metadata.content_provider, "template");
  await assert.rejects(
    () => runtime.updateLaunchDraft(draftId, { token: { private_key: "never-store-this" } }),
    (error) => error.code === "SENSITIVE_INPUT_REJECTED",
  );
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
