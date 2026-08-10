import type { ActorRef, JsonSchema, ResourceVersionRef, TraceContext } from "./common.ts";

export type ToolRisk = "read" | "write_reversible" | "financial_irreversible";
export type ToolSideEffect = "none" | "internal_write" | "external_write" | "funds";
export type ToolApprovalPolicy = "none" | "explicit" | "explicit_and_recent_auth";
export type ToolRetryPolicy = "none" | "safe_read" | "idempotent_write";

export interface ToolDefinition {
  name: string;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  risk: ToolRisk;
  sideEffect: ToolSideEffect;
  requiredPermissions: string[];
  approvalPolicy: ToolApprovalPolicy;
  timeoutMs: number;
  retryPolicy: ToolRetryPolicy;
}

export interface EvaluatedPolicy {
  profile: string;
  permissions: string[];
  resourceScopes?: ResourceVersionRef[];
}

export interface ConsumedApproval {
  approvalId: string;
  actorId: string;
  intentDigest: string;
  status: "approved" | "consumed";
  expiresAt: string;
  recentAuthAt?: string;
}

export interface ToolExecutionContext extends TraceContext {
  taskId: string;
  actor: ActorRef;
  policy: EvaluatedPolicy;
  approval?: ConsumedApproval;
  intentDigest?: string;
  idempotencyKey: string;
  signal: AbortSignal;
  emit(event: { type: string; payload: unknown }): Promise<void>;
}

export type ToolResult<T> =
  | { status: "succeeded"; data: T; evidence?: ResourceVersionRef[] }
  | { status: "needs_input"; missing: string[] }
  | { status: "waiting_approval"; intent: unknown }
  | { status: "blocked"; code: string; reason: string }
  | { status: "failed"; code: string; retryable: boolean; reason?: string };

export interface AgentTool<I = unknown, O = unknown> {
  readonly definition: ToolDefinition;
  execute(context: ToolExecutionContext, input: I): Promise<ToolResult<O>>;
}
