import type { ActorRef, ActorScope, JsonObject, ResourceVersionRef } from "./common.ts";
import type { AgentClient, ContextRef } from "./context.ts";

export type AgentTaskStatus =
  | "queued"
  | "running"
  | "waiting_input"
  | "waiting_approval"
  | "executing"
  | "reconciliation_required"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

export interface CreateConversationRequest {
  actor: ActorRef;
  client: AgentClient;
  locale: "zh-CN" | "en";
  context?: JsonObject;
}

export interface Conversation {
  conversationId: string;
  actorId?: string;
  client: AgentClient;
  locale?: string;
  messages?: unknown[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SubmitAgentInput {
  requestId: string;
  actor: ActorRef;
  client: AgentClient;
  conversationId?: string;
  message?: string;
  requestedCapability?: string;
  contextRefs?: ContextRef[];
  idempotencyKey: string;
  locale: "zh-CN" | "en";
}

export interface AgentTask {
  schemaVersion: "agent.task.v2";
  taskId: string;
  conversationId: string;
  actorId: string;
  client: AgentClient;
  capability: string;
  status: AgentTaskStatus;
  progress: number;
  contextRefs: ResourceVersionRef[];
  result?: unknown;
  failure?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export interface EventPage {
  events: AgentEvent[];
  nextCursor?: string;
}

export interface AgentEvent {
  eventId: string;
  sequence: number;
  type: string;
  aggregateType: "conversation" | "task" | "approval" | "execution";
  aggregateId: string;
  actorId: string;
  traceId: string;
  payload: unknown;
  createdAt: string;
}

export interface AgentRuntime {
  createConversation(request: CreateConversationRequest): Promise<Conversation>;
  submit(input: SubmitAgentInput): Promise<AgentTask>;
  getTask(scope: ActorScope, taskId: string): Promise<AgentTask | null>;
  cancelTask(scope: ActorScope, taskId: string, reason?: string): Promise<AgentTask>;
  getConversation(scope: ActorScope, conversationId: string): Promise<Conversation | null>;
  listEvents(scope: ActorScope, cursor?: string): Promise<EventPage>;
}
