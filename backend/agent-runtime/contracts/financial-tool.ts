import type { ApprovalRecord } from "./approval.ts";
import type { AgentClient } from "./context.ts";
import type { JsonObject, ResourceVersionRef } from "./common.ts";

export interface FinancialToolStartRecord {
  schemaVersion: "agent.financial_tool_start.v1";
  taskId: string;
  toolCallId: string;
  eventId: string;
  actorId: string;
  client: AgentClient;
  capability: string;
  taskType: string;
  taskStatus: "waiting_approval";
  toolName: string;
  toolVersion: string;
  toolStatus: "waiting_approval";
  risk: "financial_irreversible";
  resourceType: string;
  resourceId: string;
  safeInput: JsonObject;
  inputDigest: string;
  contextRefs: ResourceVersionRef[];
  idempotencyKey: string;
  toolIdempotencyKey: string;
  traceId: string;
  createdAt: string;
  approval: ApprovalRecord;
}

export interface FinancialToolStartResult {
  taskId: string;
  toolCallId: string;
  approval: ApprovalRecord;
  taskStateVersion: number;
  idempotentReplay: boolean;
}
