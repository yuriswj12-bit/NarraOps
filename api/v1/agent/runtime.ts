// @ts-nocheck
import { createClient } from "@supabase/supabase-js";
import { createAgentRuntime } from "../../../backend/agents/agent-runtime.ts";
import { SupabaseWalletGroupRepository } from "../../../backend/api/src/repositories/supabase-wallet-group-repository.ts";
import {
  formatTelegramReply,
  parseTelegramUpdate,
  sendTelegramMessage,
} from "../../../backend/agents/channels/telegram.ts";

let runtimeSingleton = null;
const telegramConversationByChat = new Map();

function serverSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function getRuntime() {
  if (!runtimeSingleton) {
    const supabase = serverSupabase();
    runtimeSingleton = createAgentRuntime({
      stepDelayMs: 5,
      supabase,
      walletGroupRepository: supabase ? new SupabaseWalletGroupRepository(supabase) : undefined,
      config: {
        gmgnLiveEnabled: process.env.GMGN_LIVE_ENABLED !== "false",
        gmgnExecutionEnabled: process.env.GMGN_TRADE_ENABLED === "true",
        gmgnAuthorizedWallets: String(process.env.GMGN_AUTHORIZED_WALLETS || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        realExecutionEnabled: process.env.REAL_EXECUTION_ENABLED !== "false",
        gmgnCliPath: process.env.GMGN_CLI_PATH || undefined,
        externalTimeoutMs: Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS || 15_000),
        externalMaxRetries: Number(process.env.EXTERNAL_REQUEST_MAX_RETRIES || 1),
        hertzflowLiveEnabled: process.env.HERTZFLOW_LIVE_ENABLED !== "false",
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
    timeoutMs: Number(body.timeoutMs || 20_000),
  });
}

export async function updateAgentLaunchDraft(draftId, body = {}) {
  return getRuntime().updateLaunchDraft(draftId, body);
}

export async function createAgentTask(body = {}) {
  const runtime = getRuntime();
  const result = await runtime.handleMessage({
    channel: "api",
    message: body.message || body.input || body.command || "",
    command: body.command || null,
    context: body.context || body.parameters?.context || {},
    wait: body.wait === true,
    timeoutMs: Number(body.timeoutMs || 20_000),
  });
  return {
    task_id: result.task_id,
    conversation_id: result.conversation_id,
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
    ...(result.cards ? { cards: result.cards } : {}),
    ...(result.agent ? { agent: result.agent } : {}),
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
  updateAgentLaunchDraft,
  createAgentTask,
  handleTelegramWebhook,
};
