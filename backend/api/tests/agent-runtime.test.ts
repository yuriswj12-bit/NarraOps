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
