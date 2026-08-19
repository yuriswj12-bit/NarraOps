// @ts-nocheck
import { randomUUID } from "node:crypto";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function withRepoTimeout(promise, timeoutMs = 5_000, label = "supabase") {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), {
          status: 504,
          code: "SUPABASE_TIMEOUT",
        }));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
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
    const { error } = await withRepoTimeout(
      this.#supabase.from("agent_conversations").insert(conversation),
      5_000,
      "agent_conversations.insert",
    );
    if (error) throw error;
    return this.#publicConversation(conversation, []);
  }

  async get(conversationId) {
    const { data: conversation, error } = await withRepoTimeout(
      this.#supabase
        .from("agent_conversations")
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle(),
      5_000,
      "agent_conversations.get",
    );
    if (error) throw error;
    if (!conversation) return null;
    const { data: messages, error: messageError } = await withRepoTimeout(
      this.#supabase
        .from("agent_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true }),
      5_000,
      "agent_messages.list",
    );
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
    const { error } = await withRepoTimeout(
      this.#supabase.from("agent_messages").insert(row),
      5_000,
      "agent_messages.insert",
    );
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

  async updateContext(conversationId, patch = {}) {
    const conversation = await this.get(conversationId);
    if (!conversation) return null;
    const merged = {
      ...(conversation.context || {}),
      ...(patch || {}),
    };
    const { error } = await withRepoTimeout(
      this.#supabase
        .from("agent_conversations")
        .update({ context: merged, updated_at: new Date().toISOString() })
        .eq("conversation_id", conversationId),
      5_000,
      "agent_conversations.update_context",
    );
    if (error) throw error;
    return { ...conversation, context: merged, updatedAt: new Date().toISOString() };
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
  #durabilityAvailable = null;

  constructor(supabase) {
    this.#supabase = supabase;
  }

  async create(task) {
    const row = this.#toRow(task);
    let { error } = await withRepoTimeout(
      this.#supabase.from("agent_tasks").upsert(row, { onConflict: "task_id" }),
      5_000,
      "agent_tasks.upsert",
    );
    if (error && ["PGRST204", "42703"].includes(error.code)) {
      ({ error } = await withRepoTimeout(
        this.#supabase.from("agent_tasks").upsert(this.#legacyRow(row), { onConflict: "task_id" }),
        5_000,
        "agent_tasks.upsert_legacy",
      ));
    }
    if (error) throw error;
    return structuredClone(task);
  }

  async get(taskId) {
    const { data, error } = await withRepoTimeout(
      this.#supabase
        .from("agent_tasks")
        .select("*")
        .eq("task_id", taskId)
        .maybeSingle(),
      5_000,
      "agent_tasks.get",
    );
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
    let { error } = await this.#supabase
      .from("agent_tasks")
      .upsert(this.#toRow(next), { onConflict: "task_id" });
    if (error && ["PGRST204", "42703"].includes(error.code)) {
      ({ error } = await this.#supabase
        .from("agent_tasks")
        .upsert(this.#legacyRow(this.#toRow(next)), { onConflict: "task_id" }));
    }
    if (error) throw error;
    return structuredClone(next);
  }

  async transition(taskId, { expectedStatuses, expectedVersion, patch, event }) {
    const current = await this.get(taskId);
    if (!current) return null;
    if (expectedStatuses?.length && !expectedStatuses.includes(current.status)) return null;
    if (expectedVersion != null && current.stateVersion !== expectedVersion) return null;
    const next = {
      ...current,
      ...patch,
      updatedAt: patch.updatedAt || new Date().toISOString(),
    };
    if (this.#durabilityAvailable === false) {
      const task = await this.update(taskId, patch);
      return { task, event: event || null, durable: false };
    }
    const { data, error } = await withRepoTimeout(
      this.#supabase.rpc("agent_transition_task_v2", {
        p_task_id: taskId,
        p_expected_statuses: expectedStatuses || [current.status],
        p_expected_version: expectedVersion ?? current.stateVersion ?? 1,
        p_patch: this.#toRow(next),
        p_event: event || null,
      }),
      5_000,
      "agent_transition_task_v2",
    );
    if (error && !["PGRST202", "42883"].includes(error.code)) throw error;
    if (error) {
      this.#durabilityAvailable = false;
      const task = await this.update(taskId, patch);
      return { task, event: event || null, durable: false };
    }
    this.#durabilityAvailable = true;
    if (!data) return null;
    return {
      task: this.#fromRow(data.task),
      event: data.event ? this.#fromEventRow(data.event) : null,
      durable: true,
    };
  }

  async appendEvent(event) {
    const taskId = event.taskId || event.data?.task_id || event.task?.taskId;
    if (!taskId) throw new Error("Durable Agent events require a taskId");
    if (this.#durabilityAvailable === false) return { ...event, taskId, durable: false };
    const { data, error } = await withRepoTimeout(
      this.#supabase.rpc("agent_append_task_event_v2", {
        p_task_id: taskId,
        p_event: event,
      }),
      5_000,
      "agent_append_task_event_v2",
    );
    if (error && !["PGRST202", "42883", "42P01"].includes(error.code)) throw error;
    if (error) {
      this.#durabilityAvailable = false;
      return { ...event, taskId, durable: false };
    }
    this.#durabilityAvailable = true;
    return this.#fromEventRow(data);
  }

  async listEvents(taskId, { afterSequence = 0, limit = 200 } = {}) {
    if (this.#durabilityAvailable === false) return [];
    const { data, error } = await withRepoTimeout(
      this.#supabase
        .from("agent_event_outbox")
        .select("*")
        .eq("task_id", taskId)
        .gt("task_sequence", Math.max(0, Number(afterSequence) || 0))
        .order("task_sequence", { ascending: true })
        .limit(Math.min(Math.max(Number(limit) || 200, 1), 500)),
      5_000,
      "agent_event_outbox.list",
    );
    if (error && ["PGRST205", "42P01"].includes(error.code)) {
      this.#durabilityAvailable = false;
      return [];
    }
    if (error) throw error;
    this.#durabilityAvailable = true;
    return (data || []).map((row) => this.#fromEventRow(row));
  }

  async listRecoverable({ now = new Date().toISOString(), limit = 100 } = {}) {
    const { data, error } = await withRepoTimeout(
      this.#supabase
        .from("agent_tasks")
        .select("*")
        .in("status", ["queued", "running"])
        .or(`status.eq.queued,lease_expires_at.is.null,lease_expires_at.lte.${now}`)
        .order("created_at", { ascending: true })
        .limit(Math.min(Math.max(Number(limit) || 100, 1), 500)),
      5_000,
      "agent_tasks.recoverable",
    );
    if (error && error.code === "42703") return [];
    if (error) throw error;
    return (data || []).map((row) => this.#fromRow(row));
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
      execution_mode: task.executionMode || "live",
      input: task.input || {},
      result: task.result ?? null,
      failure: task.failure ?? null,
      request_id: task.requestId || null,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      completed_at: task.completedAt || null,
      actor_id: task.actorId || task.parsedInput?.user_id || task.input?.context?.userId || task.input?.context?.user_id || null,
      client: task.client || task.channel || task.parsedInput?.channel || null,
      capability: task.capability || task.type,
      context_refs: task.contextRefs || task.input?.context?.contextRefs || [],
      idempotency_key: task.idempotencyKey || null,
      state_version: task.stateVersion || 1,
      lease_owner: task.leaseOwner || null,
      lease_expires_at: task.leaseExpiresAt || null,
      attempt_count: task.attemptCount || 0,
      max_attempts: task.maxAttempts || 3,
      expires_at: task.expiresAt || null,
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
      executionMode: row.execution_mode || "live",
      result: row.result,
      failure: row.failure,
      conversationId: row.conversation_id,
      channel: row.channel,
      parsedInput: {
        conversation_id: row.conversation_id,
        channel: row.channel,
        user_id: row.actor_id,
      },
      actorId: row.actor_id,
      client: row.client,
      capability: row.capability || row.type,
      contextRefs: row.context_refs || [],
      idempotencyKey: row.idempotency_key,
      stateVersion: row.state_version || 1,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      attemptCount: row.attempt_count || 0,
      maxAttempts: row.max_attempts || 3,
      expiresAt: row.expires_at,
    };
  }

  #fromEventRow(row) {
    return {
      ...(row.payload || {}),
      eventId: row.event_id || row.payload?.eventId,
      taskId: row.task_id || row.payload?.taskId,
      sequence: row.task_sequence || row.payload?.sequence,
      cursor: String(row.outbox_sequence || row.payload?.cursor || ""),
      createdAt: row.created_at || row.payload?.createdAt,
      durable: true,
    };
  }

  #legacyRow(row) {
    const {
      actor_id: _actorId,
      client: _client,
      capability: _capability,
      context_refs: _contextRefs,
      idempotency_key: _idempotencyKey,
      state_version: _stateVersion,
      lease_owner: _leaseOwner,
      lease_expires_at: _leaseExpiresAt,
      attempt_count: _attemptCount,
      max_attempts: _maxAttempts,
      expires_at: _expiresAt,
      ...legacy
    } = row;
    return legacy;
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
      execution_mode: "live",
      signing_status: "awaiting_confirmation",
      broadcasting_status: "awaiting_confirmation",
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
