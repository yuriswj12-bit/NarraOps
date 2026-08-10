import type {
  JsonObject,
  ResourceVersionRef,
} from "./common.ts";

export type MemoryScope = "user" | "conversation" | "task";
export type MemoryKind =
  | "user_preference"
  | "user_fact"
  | "conversation_summary"
  | "task_outcome"
  | "operational_fact"
  | "failure_learning";
export type MemorySensitivity = "private" | "sensitive";
export type MemoryStatus =
  | "proposed"
  | "active"
  | "rejected"
  | "superseded"
  | "expired"
  | "deleted";

export interface MemorySource {
  type: "user_message" | "conversation" | "task" | "artifact" | "runtime";
  id: string;
  refs: ResourceVersionRef[];
}

export interface AgentMemoryItem {
  schemaVersion: "agent.memory_item.v1";
  memoryId: string;
  actorId: string;
  agentId?: string;
  conversationId?: string;
  taskId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  structuredValue?: JsonObject;
  sensitivity: MemorySensitivity;
  source: MemorySource;
  confidence: number;
  status: MemoryStatus;
  checksum: string;
  stateVersion: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  expiresAt?: string;
  supersededBy?: string;
}
