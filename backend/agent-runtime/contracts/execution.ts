export type ExecutionStatus =
  | "reserved"
  | "submission_pending"
  | "submitted"
  | "reconciliation_required"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface ExecutionReservation {
  schemaVersion: "agent.execution.v1";
  executionId: string;
  taskId: string;
  toolCallId: string;
  approvalId: string;
  intentId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  intentDigest: string;
  idempotencyKey: string;
  requestFingerprint: string;
  provider?: string;
  chain?: string;
  status: ExecutionStatus;
  stateVersion: number;
  txHash?: string;
  failure?: { code: string; message?: string };
  semanticEnvelope?: import("./semantic.ts").ApprovedExecutionEnvelope;
  semanticsVerifiedAt?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  completedAt?: string;
}

export interface ExecutionTransition {
  executionId: string;
  actorId: string;
  expectedStatus: ExecutionStatus;
  expectedStateVersion: number;
  status: ExecutionStatus;
  txHash?: string;
  failure?: { code: string; message?: string };
}

export interface WalletSignatureConfirmation {
  schemaVersion: "agent.wallet_signature_confirmation.v1";
  messageHash: string;
  txSignature: string;
  signer: string;
  verifiedAt: string;
}
