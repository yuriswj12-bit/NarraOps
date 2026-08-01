// @ts-nocheck
import { createAgentRuntime } from "../../../backend/agents/agent-runtime.ts";
import {
  formatTelegramReply,
  parseTelegramUpdate,
  sendTelegramMessage,
} from "../../../backend/agents/channels/telegram.ts";

let runtimeSingleton = null;
const telegramConversationByChat = new Map();

function getRuntime() {
  if (!runtimeSingleton) {
    runtimeSingleton = createAgentRuntime({
      stepDelayMs: 5,
      config: {
        gmgnLiveEnabled: process.env.GMGN_LIVE_ENABLED === "true",
        hertzflowLiveEnabled: process.env.HERTZFLOW_LIVE_ENABLED === "true",
      },
    });
  }
  return runtimeSingleton;
}

export function getSharedAgentRuntime() {
  return getRuntime();
}

export async function createAgentConversation(body = {}) {
  const runtime = getRuntime();
  return runtime.createConversation(body.context || {}, body.channel || "web");
}

export async function getAgentConversation(conversationId) {
  return getRuntime().getConversation(conversationId);
}

export async function postAgentConversationMessage(conversationId, body = {}) {
  const wait = body.wait !== false;
  return getRuntime().handleMessage({
    channel: body.channel || "web",
    conversationId,
    message: body.message,
    command: body.command || null,
    context: body.context || {},
    wait,
    timeoutMs: Number(body.timeoutMs || 8000),
  });
}

export async function createAgentTask(body = {}) {
  const runtime = getRuntime();
  const result = await runtime.handleMessage({
    channel: "api",
    message: body.message || body.input || body.command || "",
    command: body.command || null,
    context: body.context || body.parameters?.context || {},
    wait: body.wait === true,
    timeoutMs: Number(body.timeoutMs || 8000),
  });
  return {
    task_id: result.task_id,
    conversation_id: result.conversation_id,
    status: result.status,
    ...(result.task || {}),
  };
}

export async function handleTelegramWebhook(update = {}) {
  const parsed = parseTelegramUpdate(update);
  if (!parsed.handled) {
    return {
      ok: true,
      ignored: true,
      reason: parsed.reason,
    };
  }

  const runtime = getRuntime();
  const existingConversationId = telegramConversationByChat.get(parsed.conversationKey) || null;
  const result = await runtime.handleMessage({
    channel: "telegram",
    conversationId: existingConversationId,
    message: parsed.message,
    command: parsed.command,
    context: parsed.context,
    wait: true,
    timeoutMs: 10_000,
  });
  telegramConversationByChat.set(parsed.conversationKey, result.conversation_id);

  const reply = formatTelegramReply(result, parsed.context.language || "en");
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  let delivery = { status: "formatted_only" };
  if (token && parsed.context.telegram?.chat_id != null) {
    const sent = await sendTelegramMessage({
      token,
      chatId: parsed.context.telegram.chat_id,
      text: reply.text,
      replyToMessageId: parsed.context.telegram.message_id,
    });
    delivery = { status: "sent", telegram: sent?.result?.message_id || null };
  }

  return {
    ok: true,
    ignored: false,
    conversation_id: result.conversation_id,
    task_id: result.task_id,
    status: result.status,
    reply,
    delivery,
  };
}

export default {
  getSharedAgentRuntime,
  createAgentConversation,
  getAgentConversation,
  postAgentConversationMessage,
  createAgentTask,
  handleTelegramWebhook,
};
