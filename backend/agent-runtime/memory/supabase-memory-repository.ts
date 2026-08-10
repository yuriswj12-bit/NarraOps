import type {
  AgentMemoryItem,
  MemoryKind,
  MemoryScope,
} from "../contracts/index.ts";
import {
  AgentMemoryError,
  type AgentMemoryRepository,
} from "./memory-service.ts";

type SupabaseLike = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

export class SupabaseAgentMemoryRepository implements AgentMemoryRepository {
  constructor(private readonly supabase: SupabaseLike) {}

  async propose(item: AgentMemoryItem): Promise<{
    item: AgentMemoryItem;
    idempotentReplay: boolean;
  }> {
    const { data, error } = await this.supabase.rpc("agent_propose_memory_v1", {
      p_record: item,
    });
    if (error) throw memoryPersistenceError(error, "AGENT_MEMORY_PERSISTENCE_FAILED");
    const result = assertObject(data, "Memory proposal") as {
      item?: unknown;
      idempotentReplay?: unknown;
    };
    return {
      item: assertMemory(result.item),
      idempotentReplay: Boolean(result.idempotentReplay),
    };
  }

  async get(memoryId: string, actorId: string): Promise<AgentMemoryItem | null> {
    const { data, error } = await this.supabase.rpc("agent_get_memory_v1", {
      p_memory_id: memoryId,
      p_actor_id: actorId,
    });
    if (error) throw memoryPersistenceError(error, "AGENT_MEMORY_READ_FAILED");
    return data ? assertMemory(data) : null;
  }

  async transition(input: {
    memoryId: string;
    actorId: string;
    expectedStateVersion: number;
    status: "active" | "rejected" | "deleted";
    transitionedAt: string;
    confirmation?: "user_explicit" | "runtime_policy";
  }): Promise<AgentMemoryItem | null> {
    const rpc = input.status === "deleted"
      ? "agent_forget_memory_v1"
      : "agent_decide_memory_v1";
    const record = input.status === "deleted"
      ? {
        memoryId: input.memoryId,
        actorId: input.actorId,
        expectedStateVersion: input.expectedStateVersion,
      }
      : {
        memoryId: input.memoryId,
        actorId: input.actorId,
        decision: input.status,
        expectedStateVersion: input.expectedStateVersion,
        confirmation: input.confirmation || "runtime_policy",
      };
    const { data, error } = await this.supabase.rpc(rpc, { p_record: record });
    if (error) throw memoryPersistenceError(error, "AGENT_MEMORY_TRANSITION_FAILED");
    return data ? assertMemory(data) : null;
  }

  async listActive(input: {
    actorId: string;
    agentId?: string;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit: number;
    now: string;
  }): Promise<AgentMemoryItem[]> {
    const { data, error } = await this.supabase.rpc("agent_list_active_memories_v1", {
      p_record: {
        actorId: input.actorId,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        scopes: input.scopes || [],
        kinds: input.kinds || [],
        limit: input.limit,
      },
    });
    if (error) throw memoryPersistenceError(error, "AGENT_MEMORY_READ_FAILED");
    if (!Array.isArray(data)) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_PERSISTENCE_INVALID",
        "Memory retrieval returned an invalid collection",
      );
    }
    return data.map(assertMemory);
  }

  async listForReview(input: {
    actorId: string;
    statuses: Array<"proposed" | "active">;
    scopes?: MemoryScope[];
    kinds?: MemoryKind[];
    limit: number;
    now: string;
  }): Promise<AgentMemoryItem[]> {
    const { data, error } = await this.supabase.rpc("agent_list_memories_for_review_v1", {
      p_record: {
        actorId: input.actorId,
        statuses: input.statuses,
        scopes: input.scopes || [],
        kinds: input.kinds || [],
        limit: input.limit,
      },
    });
    if (error) throw memoryPersistenceError(error, "AGENT_MEMORY_READ_FAILED");
    if (!Array.isArray(data)) {
      throw new AgentMemoryError(
        "AGENT_MEMORY_PERSISTENCE_INVALID",
        "Memory review returned an invalid collection",
      );
    }
    return data.map(assertMemory);
  }
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentMemoryError(
      "AGENT_MEMORY_PERSISTENCE_INVALID",
      `${label} persistence returned an invalid record`,
    );
  }
  return value as Record<string, unknown>;
}

function assertMemory(value: unknown): AgentMemoryItem {
  const record = assertObject(value, "Memory");
  if (
    record.schemaVersion !== "agent.memory_item.v1"
    || typeof record.memoryId !== "string"
    || typeof record.actorId !== "string"
  ) {
    throw new AgentMemoryError(
      "AGENT_MEMORY_PERSISTENCE_INVALID",
      "Memory persistence returned an invalid item",
    );
  }
  return record as unknown as AgentMemoryItem;
}

function memoryPersistenceError(
  error: { message?: string; code?: string },
  fallbackCode: string,
): AgentMemoryError {
  const known = [
    "AGENT_MEMORY_IDEMPOTENCY_CONFLICT",
    "AGENT_MEMORY_ACTOR_SCOPE_MISMATCH",
    "AGENT_MEMORY_USER_CONFIRMATION_REQUIRED",
    "AGENT_MEMORY_SECRET_REJECTED",
  ].find((code) => error.message?.includes(code));
  return new AgentMemoryError(
    known || error.code || fallbackCode,
    error.message || "Agent memory persistence failed",
  );
}
