import type { JsonObject } from "./common.ts";

export type ApprovalShadowStatus =
  | "requested"
  | "approved"
  | "rejected"
  | "consumed"
  | "expired";

export type ApprovalStatus = ApprovalShadowStatus;

export interface ExecutionIntent {
  schemaVersion: "agent.execution_intent.v1";
  intentId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  parameters: JsonObject;
  intentDigest: string;
  risk: "financial_irreversible";
  status: ApprovalShadowStatus;
  createdAt: string;
  expiresAt: string;
}

export interface ApprovalShadowRecord {
  schemaVersion: "agent.approval_shadow.v1";
  approvalId: string;
  intent: ExecutionIntent;
  actorId: string;
  status: ApprovalShadowStatus;
  legacyConfirmationKind: string;
  legacyRequestId?: string;
  recordedAt: string;
}

export interface ApprovalRecord {
  schemaVersion: "agent.approval.v1";
  approvalId: string;
  intent: ExecutionIntent;
  actorId: string;
  taskId: string;
  toolCallId: string;
  status: ApprovalStatus;
  policy: "explicit" | "explicit_and_recent_auth";
  idempotencyKey: string;
  stateVersion: number;
  requestedAt: string;
  decidedAt?: string;
  consumedAt?: string;
  recentAuthAt?: string;
  expiresAt: string;
}
