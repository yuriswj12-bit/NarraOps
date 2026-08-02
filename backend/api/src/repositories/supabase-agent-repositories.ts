// @ts-nocheck
import { randomUUID } from "node:crypto";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export class SupabaseConversationRepository {
  #supabase;

  constructor(supabase) {
    this.#supabase = supabase;
  }

  async create(context = {}) {
    const now = new Date().toISOString();
    const conversation = {
      conversation_id: randomUUID(),
      channel: context.channel || "web",
      user_id: context.user_id || context.userId || null,
      channel_user_id: context.channel_user_id || context.channelUserId || null,
      context,
      created_at: now,
      updated_at: now,
    };
    const { error } = await this.#supabase.from("agent_conversations").insert(conversation);
    if (error) throw error;
    return this.#publicConversation(conversation, []);
  }

  async get(conversationId) {
    const { data: conversation, error } = await this.#supabase
      .from("agent_conversations")
      .select("*")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error) throw error;
    if (!conversation) return null;
    const { data: messages, error: messageError } = await this.#supabase
      .from("agent_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (messageError) throw messageError;
    return this.#publicConversation(conversation, messages || []);
  }

  async addMessage(conversationId, message) {
    const now = new Date().toISOString();
    const row = {
      message_id: message.messageId || message.message_id || randomUUID(),
      conversation_id: conversationId,
      role: message.role,
      content: message.content || null,
      command: message.command || null,
      channel: message.channel || null,
      task_id: message.taskId || message.task_id || null,
      status: message.status || null,
      blocks: asArray(message.blocks),
      created_at: message.createdAt || message.created_at || now,
    };
    const { error } = await this.#supabase.from("agent_messages").insert(row);
    if (error) throw error;
    await this.#supabase
      .from("agent_conversations")
      .update({ updated_at: now })
      .eq("conversation_id", conversationId);
    return {
      messageId: row.message_id,
      role: row.role,
      content: row.content,
      command: row.command,
      channel: row.channel,
      taskId: row.task_id,
      status: row.status,
      blocks: row.blocks,
      createdAt: row.created_at,
    };
  }

  async bindTask(conversationId, taskId) {
    // Task rows already store conversation_id on create.
    void conversationId;
    void taskId;
    return true;
  }

  async conversationIdForTask(taskId) {
    const { data, error } = await this.#supabase
      .from("agent_tasks")
      .select("conversation_id")
      .eq("task_id", taskId)
      .maybeSingle();
    if (error) throw error;
    return data?.conversation_id || null;
  }

  #publicConversation(conversation, messages) {
    return {
      conversationId: conversation.conversation_id,
      context: conversation.context || {},
      channel: conversation.channel,
      userId: conversation.user_id,
      channelUserId: conversation.channel_user_id,
      messages: (messages || []).map((message) => ({
        messageId: message.message_id,
        role: message.role,
        content: message.content,
        command: message.command,
        channel: message.channel,
        taskId: message.task_id,
        status: message.status,
        blocks: asArray(message.blocks),
        createdAt: message.created_at,
      })),
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
    };
  }
}

export class SupabaseTaskRepository {
  #supabase;

  constructor(supabase) {
    this.#supabase = supabase;
  }

  async create(task) {
    const row = this.#toRow(task);
    const { error } = await this.#supabase.from("agent_tasks").upsert(row, { onConflict: "task_id" });
    if (error) throw error;
    return structuredClone(task);
  }

  async get(taskId) {
    const { data, error } = await this.#supabase
      .from("agent_tasks")
      .select("*")
      .eq("task_id", taskId)
      .maybeSingle();
    if (error) throw error;
    return data ? this.#fromRow(data) : null;
  }

  async update(taskId, patch) {
    const current = await this.get(taskId);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };
    const { error } = await this.#supabase
      .from("agent_tasks")
      .upsert(this.#toRow(next), { onConflict: "task_id" });
    if (error) throw error;
    return structuredClone(next);
  }

  #toRow(task) {
    return {
      task_id: task.taskId,
      conversation_id: task.parsedInput?.conversation_id || task.conversationId || null,
      channel: task.parsedInput?.channel || task.channel || null,
      type: task.type,
      status: task.status,
      progress: task.progress ?? 0,
      requires_confirmation: Boolean(task.requiresConfirmation),
      execution_mode: task.executionMode || "mock",
      input: task.input || {},
      result: task.result ?? null,
      failure: task.failure ?? null,
      request_id: task.requestId || null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      completed_at: task.completedAt || null,
    };
  }

  #fromRow(row) {
    return {
      taskId: row.task_id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      requestId: row.request_id,
      input: row.input || {},
      requiresConfirmation: Boolean(row.requires_confirmation),
      executionMode: row.execution_mode || "mock",
      result: row.result,
      failure: row.failure,
      conversationId: row.conversation_id,
      channel: row.channel,
      parsedInput: {
        conversation_id: row.conversation_id,
        channel: row.channel,
      },
    };
  }
}

export class SupabaseLaunchDraftRepository {
  #supabase;

  constructor(supabase) {
    this.#supabase = supabase;
  }

  async create(input) {
    const now = new Date().toISOString();
    const draft = {
      launch_draft_id: randomUUID(),
      conversation_id: input.conversation_id || input.conversationId || null,
      user_id: input.user_id || input.userId || null,
      status: "draft",
      confirmation_status: "not_confirmed",
      execution_mode: "disabled",
      signing_status: "signing_disabled",
      broadcasting_status: "broadcasting_disabled",
      preparation_status: input.preparation_status || "requires_enrichment",
      chain: input.chain || null,
      platform: input.platform || {},
      token: input.token || {},
      narrative: input.narrative || {},
      source_prompt: input.source_prompt || null,
      missing_fields: input.missing_fields || [],
      requires_user_confirmation: input.requires_user_confirmation !== false,
      metadata: {
        ...(input.metadata || {}),
        cooking_wallet_group_id:
          input.cooking_wallet_group_id || input.metadata?.cooking_wallet_group_id || null,
        bundled_wallet_group_id:
          input.bundled_wallet_group_id || input.metadata?.bundled_wallet_group_id || null,
      },
      created_at: now,
      updated_at: now,
    };
    const { error } = await this.#supabase.from("go_launch_drafts").insert(draft);
    if (error) throw error;
    return this.#public(draft);
  }

  async get(id) {
    const { data, error } = await this.#supabase
      .from("go_launch_drafts")
      .select("*")
      .eq("launch_draft_id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? this.#public(data) : null;
  }

  async update(id, patch = {}) {
    const current = await this.get(id);
    if (!current) return null;
    const token = {
      ...(current.token || {}),
      ...(patch.token || {}),
    };
    const missing = ["name", "symbol", "description", "image_url"].filter((field) => !token[field]);
    const cookingWalletGroupId =
      patch.cooking_wallet_group_id ??
      patch.metadata?.cooking_wallet_group_id ??
      current.cooking_wallet_group_id ??
      current.metadata?.cooking_wallet_group_id ??
      null;
    const bundledWalletGroupId =
      patch.bundled_wallet_group_id ??
      patch.metadata?.bundled_wallet_group_id ??
      current.bundled_wallet_group_id ??
      current.metadata?.bundled_wallet_group_id ??
      null;
    const requiredUserSelections = [
      ...(!cookingWalletGroupId ? ["cooking_wallet_group_id"] : []),
      ...(!bundledWalletGroupId ? ["bundled_wallet_group_id"] : []),
    ];
    const next = {
      ...current,
      ...patch,
      token,
      platform: patch.platform || current.platform || {},
      narrative: patch.narrative || current.narrative || {},
      metadata: {
        ...(current.metadata || {}),
        ...(patch.metadata || {}),
        cooking_wallet_group_id: cookingWalletGroupId,
        bundled_wallet_group_id: bundledWalletGroupId,
      },
      cooking_wallet_group_id: cookingWalletGroupId,
      bundled_wallet_group_id: bundledWalletGroupId,
      missing_fields: missing,
      required_user_selections: requiredUserSelections,
      preparation_status: missing.length
        ? "requires_enrichment"
        : requiredUserSelections.length
          ? "requires_wallet_selection"
          : "ready_for_user_review",
      updated_at: new Date().toISOString(),
    };
    const row = {
      launch_draft_id: next.launch_draft_id,
      conversation_id: next.conversation_id || null,
      user_id: next.user_id || null,
      status: next.status,
      confirmation_status: next.confirmation_status,
      execution_mode: next.execution_mode,
      signing_status: next.signing_status,
      broadcasting_status: next.broadcasting_status,
      preparation_status: next.preparation_status,
      chain: next.chain,
      platform: next.platform,
      token: next.token,
      narrative: next.narrative,
      source_prompt: next.source_prompt,
      missing_fields: next.missing_fields,
      requires_user_confirmation: next.requires_user_confirmation,
      metadata: next.metadata || {},
      created_at: next.created_at,
      updated_at: next.updated_at,
    };
    const { error } = await this.#supabase
      .from("go_launch_drafts")
      .upsert(row, { onConflict: "launch_draft_id" });
    if (error) throw error;
    return this.#public(row);
  }

  async list({ conversationId = null, userId = null } = {}) {
    let query = this.#supabase
      .from("go_launch_drafts")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(100);
    if (conversationId) query = query.eq("conversation_id", conversationId);
    if (userId) query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((row) => this.#public(row));
  }

  #public(row) {
    return {
      launch_draft_id: row.launch_draft_id,
      conversation_id: row.conversation_id,
      user_id: row.user_id,
      status: row.status,
      confirmation_status: row.confirmation_status,
      execution_mode: row.execution_mode,
      signing_status: row.signing_status,
      broadcasting_status: row.broadcasting_status,
      preparation_status: row.preparation_status,
      chain: row.chain,
      platform: row.platform,
      token: row.token,
      narrative: row.narrative,
      source_prompt: row.source_prompt,
      missing_fields: row.missing_fields || [],
      requires_user_confirmation: row.requires_user_confirmation,
      metadata: row.metadata || {},
      cooking_wallet_group_id: row.metadata?.cooking_wallet_group_id || null,
      bundled_wallet_group_id: row.metadata?.bundled_wallet_group_id || null,
      required_user_selections: [
        ...(!row.metadata?.cooking_wallet_group_id ? ["cooking_wallet_group_id"] : []),
        ...(!row.metadata?.bundled_wallet_group_id ? ["bundled_wallet_group_id"] : []),
      ],
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
