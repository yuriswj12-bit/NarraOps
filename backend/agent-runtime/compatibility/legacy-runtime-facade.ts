import type {
  ActorScope,
  AgentRuntime,
  AgentTask,
  AgentTaskStatus,
  Conversation,
  CreateConversationRequest,
  EventPage,
  SubmitAgentInput,
} from "../contracts/index.ts";

interface LegacyRuntime {
  createConversation(context: Record<string, unknown>, channel: string): Promise<Record<string, unknown>>;
  getConversation(conversationId: string): Promise<Record<string, unknown> | null>;
  handleMessage(input: Record<string, unknown>): Promise<Record<string, any>>;
  getTask(taskId: string): Promise<Record<string, any> | null>;
}

/**
 * Phase 1 compatibility facade. Existing Go routes keep using the legacy
 * runtime; new callers can depend on the provider/tool-neutral v2 contract.
 * Durable ownership, cancellation and event replay are intentionally deferred
 * to the v2 repositories rather than faked here.
 */
export class LegacyRuntimeFacade implements AgentRuntime {
  readonly #conversationActors = new Map<string, string>();
  readonly #taskActors = new Map<string, string>();

  constructor(readonly legacy: LegacyRuntime) {}

  async createConversation(request: CreateConversationRequest): Promise<Conversation> {
    const legacyConversation = await this.legacy.createConversation(
      {
        ...(request.context || {}),
        language: request.locale.startsWith("zh") ? "zh" : "en",
        currentView: request.client,
        userId: request.actor.actorId,
      },
      legacyChannel(request.client),
    );
    const conversation = toConversation(legacyConversation, request.client, request.locale);
    this.#conversationActors.set(conversation.conversationId, request.actor.actorId);
    return conversation;
  }

  async submit(input: SubmitAgentInput): Promise<AgentTask> {
    const conversationId = input.conversationId || (
      await this.createConversation({
        actor: input.actor,
        client: input.client,
        locale: input.locale,
      })
    ).conversationId;
    this.assertConversationScope({ actorId: input.actor.actorId }, conversationId);
    const result = await this.legacy.handleMessage({
      channel: legacyChannel(input.client),
      conversationId,
      message: input.message || input.requestedCapability || "",
      context: {
        language: input.locale.startsWith("zh") ? "zh" : "en",
        currentView: input.client,
        userId: input.actor.actorId,
        requestId: input.requestId,
        contextRefs: input.contextRefs || [],
        compatibilityIdempotencyKey: input.idempotencyKey,
      },
      wait: true,
      timeoutMs: 20_000,
    });
    const task = toAgentTask(result, input, conversationId);
    this.#taskActors.set(task.taskId, input.actor.actorId);
    return task;
  }

  async getTask(scope: ActorScope, taskId: string): Promise<AgentTask | null> {
    if (this.#taskActors.get(taskId) !== scope.actorId) return null;
    const legacyTask = await this.legacy.getTask(taskId);
    return legacyTask ? toAgentTask({ task: legacyTask }, {
      requestId: "",
      actor: { actorId: scope.actorId, permissions: [] },
      client: "api",
      idempotencyKey: "",
      locale: "en",
    }, String(legacyTask.conversationId || "")) : null;
  }

  async cancelTask(_scope: ActorScope, _taskId: string, _reason?: string): Promise<AgentTask> {
    throw Object.assign(new Error("Legacy runtime cancellation is unavailable"), {
      code: "LEGACY_TASK_CANCELLATION_UNAVAILABLE",
      status: 501,
    });
  }

  async getConversation(scope: ActorScope, conversationId: string): Promise<Conversation | null> {
    if (this.#conversationActors.get(conversationId) !== scope.actorId) return null;
    const conversation = await this.legacy.getConversation(conversationId);
    return conversation ? toConversation(conversation, "api", undefined) : null;
  }

  async listEvents(_scope: ActorScope, _cursor?: string): Promise<EventPage> {
    return { events: [] };
  }

  private assertConversationScope(scope: ActorScope, conversationId: string): void {
    const owner = this.#conversationActors.get(conversationId);
    if (!owner || owner !== scope.actorId) {
      throw Object.assign(new Error("Conversation does not belong to the actor"), {
        code: "CONVERSATION_SCOPE_MISMATCH",
        status: 404,
      });
    }
  }
}

function toConversation(
  source: Record<string, any>,
  client: string,
  locale?: string,
): Conversation {
  return {
    conversationId: String(source.conversationId || source.conversation_id),
    actorId: source.userId || source.user_id || undefined,
    client: source.channel || client,
    locale,
    messages: Array.isArray(source.messages) ? source.messages : [],
    createdAt: source.createdAt || source.created_at,
    updatedAt: source.updatedAt || source.updated_at,
  };
}

function toAgentTask(
  result: Record<string, any>,
  input: SubmitAgentInput,
  conversationId: string,
): AgentTask {
  const source = result.task || result;
  const now = new Date().toISOString();
  const taskId = String(source.taskId || source.task_id || result.taskId || result.task_id);
  return {
    schemaVersion: "agent.task.v2",
    taskId,
    conversationId: String(
      result.conversationId ||
      result.conversation_id ||
      source.conversationId ||
      source.conversation_id ||
      conversationId,
    ),
    actorId: input.actor.actorId,
    client: input.client,
    capability: String(source.type || input.requestedCapability || "agent.chat"),
    status: mapLegacyStatus(source.status || result.status),
    progress: Number(source.progress ?? (source.status === "succeeded" ? 100 : 0)),
    contextRefs: input.contextRefs || [],
    ...(source.result !== undefined ? { result: source.result } : {}),
    ...(source.failure ? { failure: source.failure } : {}),
    createdAt: source.createdAt || source.created_at || now,
    updatedAt: source.updatedAt || source.updated_at || now,
  };
}

function mapLegacyStatus(status: unknown): AgentTaskStatus {
  if (status === "queued" || status === "running" || status === "succeeded" || status === "failed" || status === "cancelled") {
    return status;
  }
  return "running";
}

function legacyChannel(client: string): "web" | "telegram" | "api" {
  if (client === "telegram") return "telegram";
  if (client === "api") return "api";
  return "web";
}
