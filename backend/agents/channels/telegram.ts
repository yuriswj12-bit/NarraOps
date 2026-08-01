// @ts-nocheck
/**
 * Telegram Bot channel adapter.
 * Parses Bot API updates and formats Agent Runtime results for chat replies.
 */
function textFromUpdate(update = {}) {
  const message =
    update.message ||
    update.edited_message ||
    update.channel_post ||
    update.edited_channel_post ||
    null;
  if (!message) return null;
  const text = String(message.text || message.caption || "").trim();
  if (!text) return null;
  return {
    chatId: message.chat?.id,
    messageId: message.message_id,
    userId: message.from?.id ? String(message.from.id) : null,
    username: message.from?.username || null,
    language: String(message.from?.language_code || "").toLowerCase().startsWith("zh")
      ? "zh"
      : "en",
    text,
  };
}

export function parseTelegramUpdate(update = {}) {
  const inbound = textFromUpdate(update);
  if (!inbound) {
    return {
      handled: false,
      reason: "unsupported_update",
    };
  }

  const isCommand = inbound.text.startsWith("/");
  return {
    handled: true,
    channel: "telegram",
    conversationKey: `telegram:${inbound.chatId}`,
    message: inbound.text,
    command: isCommand ? inbound.text.split(/\s+/).slice(0, 1).join(" ") : null,
    context: {
      language: inbound.language,
      currentView: "telegram",
      channelUserId: inbound.userId,
      telegram: {
        chat_id: inbound.chatId,
        message_id: inbound.messageId,
        username: inbound.username,
      },
    },
  };
}

export function formatTelegramReply(runtimeResult, language = "en") {
  const zh = language === "zh";
  if (!runtimeResult) {
    return {
      text: zh ? "Agent temporarily unavailable." : "The Agent is temporarily unavailable.",
    };
  }

  const lines = [];
  if (runtimeResult.message?.content) lines.push(runtimeResult.message.content);
  else if (runtimeResult.status === "queued" || runtimeResult.status === "running") {
    lines.push(zh ? "Task accepted and processing." : "Task accepted and processing.");
  } else {
    lines.push(zh ? "Task completed." : "Task completed.");
  }

  const card = runtimeResult.cards?.[0];
  if (card?.type) {
    lines.push("");
    lines.push(`${zh ? "Card" : "Card"}: ${card.type}`);
  }
  if (card?.data && typeof card.data === "object") {
    const entries = Object.entries(card.data)
      .filter(([, value]) => value == null || ["string", "number", "boolean"].includes(typeof value))
      .slice(0, 6);
    for (const [key, value] of entries) {
      lines.push(`- ${key}: ${value}`);
    }
  }
  if (runtimeResult.message?.suggestion) {
    lines.push("");
    lines.push(runtimeResult.message.suggestion);
  }
  if (runtimeResult.task_id) {
    lines.push("");
    lines.push(`Task ID: ${runtimeResult.task_id}`);
  }

  return {
    text: lines.join("\n").slice(0, 3500),
    disable_web_page_preview: true,
  };
}

export async function sendTelegramMessage({
  token,
  chatId,
  text,
  replyToMessageId = null,
}) {
  if (!token) {
    throw Object.assign(new Error("TELEGRAM_BOT_TOKEN is not configured"), {
      status: 503,
      code: "TELEGRAM_BOT_NOT_CONFIGURED",
    });
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(payload?.description || "Telegram sendMessage failed"), {
      status: 502,
      code: "TELEGRAM_SEND_FAILED",
    });
  }
  return payload;
}

export default {
  parseTelegramUpdate,
  formatTelegramReply,
  sendTelegramMessage,
};
