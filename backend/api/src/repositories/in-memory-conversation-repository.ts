// @ts-nocheck
import { randomUUID } from "node:crypto";

export class InMemoryConversationRepository {
  #conversations = new Map();
  #taskToConversation = new Map();

  create(context = {}) {
    const now = new Date().toISOString();
    const conversation = {
      conversationId: randomUUID(),
      context: structuredClone(context),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#conversations.set(conversation.conversationId, conversation);
    return structuredClone(conversation);
  }

  get(conversationId) {
    const conversation = this.#conversations.get(conversationId);
    return conversation ? structuredClone(conversation) : null;
  }

  addMessage(conversationId, message) {
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

  bindTask(conversationId, taskId) {
    if (!this.#conversations.has(conversationId)) return false;
    this.#taskToConversation.set(taskId, conversationId);
    return true;
  }

  conversationIdForTask(taskId) {
    return this.#taskToConversation.get(taskId) || null;
  }
}
