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
