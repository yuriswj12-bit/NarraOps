import {
  createHash,
  randomUUID,
} from "node:crypto";
import type {
  AgentMemoryItem,
  JsonObject,
  MemoryKind,
  MemoryScope,
  MemorySensitivity,
  MemorySource,
} from "../contracts/index.ts";

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;
const SECRET_KEY_PATTERN =
  /(private[_-]?key|secret|seed|mnemonic|authorization|cookie|password|signed[_-]?transaction|raw[_-]?transaction)/i;
const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function assertSafeStructuredValue(value: unknown, path = "structuredValue"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeStructuredValue(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_SECRET_REJECTED",
        `Secret-shaped memory field rejected: ${path}.${key}`,
      );
    }
    assertSafeStructuredValue(item, `${path}.${key}`);
  }
}

export class AgentMemoryError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentMemoryError";
  }
}

export interface AgentMemoryRepository {
  propose(item: AgentMemoryItem): Promise<{ item: AgentMemoryItem; idempotentReplay: boolean }>;
  get(memoryId: string, actorId: string): Promise<AgentMemoryItem | null>;
  transition(input: {
    memoryId: string;
    actorId: string;
    expectedStateVersion: number;
    status: "active" | "rejected" | "deleted";
    transitionedAt: string;
    confirmation?: "user_explicit" | "runtime_policy";
  }): Promise<AgentMemoryItem | null>;
  listActive(input: {
    actorId: string;
    agentId?: string;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit: number;
    now: string;
  }): Promise<AgentMemoryItem[]>;
  listForReview?(input: {
    actorId: string;
    statuses: Array<"proposed" | "active">;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit: number;
    now: string;
  }): Promise<AgentMemoryItem[]>;
}

export class AgentMemoryService {
  constructor(
    private readonly repository: AgentMemoryRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async propose(input: {
    actorId: string;
    agentId?: string;
    conversationId?: string;
    taskId?: string;
    scope: MemoryScope;
    kind: MemoryKind;
    content: string;
    structuredValue?: JsonObject;
    sensitivity?: MemorySensitivity;
    source: MemorySource;
    confidence: number;
    idempotencyKey: string;
    expiresAt?: string;
  }): Promise<{ item: AgentMemoryItem; idempotentReplay: boolean }> {
    const content = input.content.trim();
    if (!input.actorId || !content || Buffer.byteLength(content, "utf8") > 8192) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_CONTENT_INVALID",
        "Memory actor or content is invalid",
      );
    }
    if (PRIVATE_KEY_BLOCK_PATTERN.test(content)) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_SECRET_REJECTED",
        "Private key material cannot be stored as Agent memory",
      );
    }
    if (!KEY_PATTERN.test(input.idempotencyKey)) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_IDEMPOTENCY_KEY_INVALID",
        "Memory idempotency key is invalid",
      );
    }
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_CONFIDENCE_INVALID",
        "Memory confidence must be between zero and one",
      );
    }
    if (
      (input.scope === "conversation" && !input.conversationId)
      || (input.scope === "task" && !input.taskId)
    ) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_SCOPE_INVALID",
        "Memory scope is missing its bound conversation or task",
      );
    }
    if (
      !input.source?.id
      || !["user_message", "conversation", "task", "artifact", "runtime"]
        .includes(input.source.type)
    ) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_SOURCE_INVALID",
        "Memory provenance is required",
      );
    }
    assertSafeStructuredValue(input.structuredValue);
    const now = this.now().toISOString();
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.parse(now)) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_EXPIRY_INVALID",
        "Memory expiry must be in the future",
      );
    }
    const semantic = {
      actorId: input.actorId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      taskId: input.taskId,
      scope: input.scope,
      kind: input.kind,
      content,
      structuredValue: input.structuredValue
        ? structuredClone(input.structuredValue)
        : undefined,
      sensitivity: input.sensitivity || "private",
      source: structuredClone(input.source),
      confidence: input.confidence,
      expiresAt: input.expiresAt,
    };
    return this.repository.propose({
      schemaVersion: "agent.memory_item.v1",
      memoryId: randomUUID(),
      ...semantic,
      status: "proposed",
      checksum: checksum(semantic),
      stateVersion: 1,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  async decide(input: {
    memoryId: string;
    actorId: string;
    decision: "active" | "rejected";
    expectedStateVersion: number;
    confirmation: "user_explicit" | "runtime_policy";
  }): Promise<AgentMemoryItem> {
    const current = await this.repository.get(input.memoryId, input.actorId);
    if (!current) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_NOT_FOUND",
        "Memory proposal was not found for the authenticated actor",
      );
    }
    if (
      ["user_preference", "user_fact"].includes(current.kind)
      && input.decision === "active"
      && input.confirmation !== "user_explicit"
    ) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_USER_CONFIRMATION_REQUIRED",
        "User facts and preferences require explicit user confirmation",
      );
    }
    const item = await this.repository.transition({
      memoryId: input.memoryId,
      actorId: input.actorId,
      expectedStateVersion: input.expectedStateVersion,
      status: input.decision,
      transitionedAt: this.now().toISOString(),
      confirmation: input.confirmation,
    });
    if (!item) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_STATE_CONFLICT",
        "Memory proposal changed before the decision",
      );
    }
    return item;
  }

  async forget(input: {
    memoryId: string;
    actorId: string;
    expectedStateVersion: number;
  }): Promise<AgentMemoryItem> {
    const item = await this.repository.transition({
      ...input,
      status: "deleted",
      transitionedAt: this.now().toISOString(),
    });
    if (!item) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_STATE_CONFLICT",
        "Memory changed before it could be deleted",
      );
    }
    return item;
  }

  retrieve(input: {
    actorId: string;
    agentId?: string;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit?: number;
  }): Promise<AgentMemoryItem[]> {
    if (!input.actorId) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_ACTOR_REQUIRED",
        "Authenticated actor is required to retrieve memory",
      );
    }
    return this.repository.listActive({
      ...input,
      limit: Math.min(50, Math.max(1, input.limit || 10)),
      now: this.now().toISOString(),
    });
  }

  listForReview(input: {
    actorId: string;
    statuses?: Array<"proposed" | "active">;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit?: number;
  }): Promise<AgentMemoryItem[]> {
    if (!input.actorId) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_ACTOR_REQUIRED",
        "Authenticated actor is required to review memory",
      );
    }
    if (!this.repository.listForReview) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_REVIEW_UNAVAILABLE",
        "Memory review persistence is unavailable",
      );
    }
    const statuses = input.statuses?.length
      ? [...new Set(input.statuses)]
      : ["proposed", "active"] as Array<"proposed" | "active">;
    if (statuses.some((status) => !["proposed", "active"].includes(status))) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_STATUS_INVALID",
        "Only proposed and active Memory may be reviewed",
      );
    }
    return this.repository.listForReview({
      ...input,
      statuses,
      limit: Math.min(50, Math.max(1, input.limit || 20)),
      now: this.now().toISOString(),
    });
  }
}

export class InMemoryAgentMemoryRepository implements AgentMemoryRepository {
  readonly #items = new Map<string, AgentMemoryItem>();
  readonly #keys = new Map<string, string>();

  async propose(item: AgentMemoryItem): Promise<{
    item: AgentMemoryItem;
    idempotentReplay: boolean;
  }> {
    const scope = `${item.actorId}:${item.idempotencyKey}`;
    const existingId = this.#keys.get(scope);
    if (existingId) {
      const existing = this.#items.get(existingId)!;
      if (existing.checksum !== item.checksum) {
        throw new AgentMemoryError(
          "AGENT_MEMORY_IDEMPOTENCY_CONFLICT",
          "Memory key was reused with different content",
        );
      }
      return { item: structuredClone(existing), idempotentReplay: true };
    }
    this.#items.set(item.memoryId, structuredClone(item));
    this.#keys.set(scope, item.memoryId);
    return { item: structuredClone(item), idempotentReplay: false };
  }

  async get(memoryId: string, actorId: string): Promise<AgentMemoryItem | null> {
    const item = this.#items.get(memoryId);
    return item?.actorId === actorId ? structuredClone(item) : null;
  }

  async transition(input: {
    memoryId: string;
    actorId: string;
    expectedStateVersion: number;
    status: "active" | "rejected" | "deleted";
    transitionedAt: string;
    confirmation?: "user_explicit" | "runtime_policy";
  }): Promise<AgentMemoryItem | null> {
    const item = this.#items.get(input.memoryId);
    if (
      !item
      || item.actorId !== input.actorId
      || item.stateVersion !== input.expectedStateVersion
      || (
        input.status !== "deleted"
        && item.status !== "proposed"
      )
      || (
        input.status === "deleted"
        && !["proposed", "active", "rejected"].includes(item.status)
      )
    ) {
      return null;
    }
    const next: AgentMemoryItem = {
      ...item,
      status: input.status,
      stateVersion: item.stateVersion + 1,
      updatedAt: input.transitionedAt,
      ...(input.status === "active" ? { activatedAt: input.transitionedAt } : {}),
    };
    this.#items.set(next.memoryId, structuredClone(next));
    return structuredClone(next);
  }

  async listActive(input: {
    actorId: string;
    agentId?: string;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit: number;
    now: string;
  }): Promise<AgentMemoryItem[]> {
    return [...this.#items.values()]
      .filter((item) =>
        item.actorId === input.actorId
        && item.status === "active"
        && (!item.expiresAt || item.expiresAt > input.now)
        && (!input.agentId || !item.agentId || item.agentId === input.agentId)
        && (!input.scopes?.length || input.scopes.includes(item.scope))
        && (!input.kinds?.length || input.kinds.includes(item.kind)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit)
      .map((item) => structuredClone(item));
  }

  async listForReview(input: {
    actorId: string;
    statuses: Array<"proposed" | "active">;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit: number;
    now: string;
  }): Promise<AgentMemoryItem[]> {
    return [...this.#items.values()]
      .filter((item) =>
        item.actorId === input.actorId
        && input.statuses.includes(item.status as "proposed" | "active")
        && (!item.expiresAt || item.expiresAt > input.now)
        && (!input.scopes?.length || input.scopes.includes(item.scope))
        && (!input.kinds?.length || input.kinds.includes(item.kind)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, input.limit)
      .map((item) => structuredClone(item));
  }
}
