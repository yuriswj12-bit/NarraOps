// @ts-nocheck
import { randomUUID } from "node:crypto";

export class InMemoryConversationRepository {
  #conversations = new Map();
  #taskToConversation = new Map();

  async create(context = {}) {
    const now = new Date().toISOString();
    const conversation = {
      conversationId: randomUUID(),
      context: structuredClone(context),
      channel: context.channel || "web",
      userId: context.user_id || context.userId || null,
      channelUserId: context.channel_user_id || context.channelUserId || null,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#conversations.set(conversation.conversationId, conversation);
    return structuredClone(conversation);
  }

  async get(conversationId) {
    const conversation = this.#conversations.get(conversationId);
    return conversation ? structuredClone(conversation) : null;
  }

  async addMessage(conversationId, message) {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return null;
    const next = {
      messageId: message.messageId || randomUUID(),
      createdAt: message.createdAt || new Date().toISOString(),
      ...structuredClone(message),
    };
    conversation.messages.push(next);
    conversation.updatedAt = new Date().toISOString();
    return structuredClone(next);
  }

  async updateContext(conversationId, patch = {}) {
    const conversation = this.#conversations.get(conversationId);
    if (!conversation) return null;
    conversation.context = {
      ...(conversation.context || {}),
      ...structuredClone(patch),
    };
    conversation.updatedAt = new Date().toISOString();
    return structuredClone(conversation);
  }

  async bindTask(conversationId, taskId) {
    if (!this.#conversations.has(conversationId)) return false;
    this.#taskToConversation.set(taskId, conversationId);
    return true;
  }

  async conversationIdForTask(taskId) {
    return this.#taskToConversation.get(taskId) || null;
  }
}
