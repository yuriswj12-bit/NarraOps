import type {
  ApprovalLifecycleRepository,
} from "./lifecycle.ts";
import type {
  ApprovalRecord,
  ApprovalStatus,
  ExecutionIntent,
} from "../contracts/index.ts";

type SupabaseLike = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
  from(table: string): any;
};

export class SupabaseApprovalLifecycleRepository implements ApprovalLifecycleRepository {
  constructor(private readonly supabase: SupabaseLike) {}

  async create(record: ApprovalRecord): Promise<ApprovalRecord> {
    const { data, error } = await this.supabase.rpc("agent_request_approval_v2", {
      p_record: record,
    });
    if (error) throw repositoryError(error);
    return mapRpcRecord(data);
  }

  async get(approvalId: string): Promise<ApprovalRecord | null> {
    const { data: approval, error: approvalError } = await this.supabase
      .from("agent_authorizations")
      .select("*")
      .eq("approval_id", approvalId)
      .maybeSingle();
    if (approvalError) throw repositoryError(approvalError);
    if (!approval) return null;
    const { data: intent, error: intentError } = await this.supabase
      .from("agent_authorization_intents")
      .select("*")
      .eq("intent_id", approval.intent_id)
      .maybeSingle();
    if (intentError) throw repositoryError(intentError);
    return intent ? mapApprovalRows(approval, intent) : null;
  }

  async decide(input: {
    approvalId: string;
    actorId: string;
    decision: "approved" | "rejected";
    decidedAt: string;
    recentAuthAt?: string;
    expectedStateVersion: number;
  }): Promise<ApprovalRecord | null> {
    const { data, error } = await this.supabase.rpc("agent_decide_approval_v1", {
      p_approval_id: input.approvalId,
      p_actor_id: input.actorId,
      p_decision: input.decision,
      p_expected_version: input.expectedStateVersion,
      p_recent_auth_at: input.recentAuthAt || null,
    });
    if (error) throw repositoryError(error);
    return data ? mapRpcRecord(data) : null;
  }

  async consume(input: {
    approvalId: string;
    actorId: string;
    intentDigest: string;
    consumedAt: string;
    expectedStateVersion: number;
  }): Promise<ApprovalRecord | null> {
    void input;
    throw Object.assign(
      new Error("Durable approvals can only be consumed with an execution reservation"),
      { code: "APPROVAL_CONSUME_REQUIRES_EXECUTION_RESERVATION" },
    );
  }
}

function mapRpcRecord(value: any): ApprovalRecord {
  if (!value?.approval || !value?.intent) {
    throw new Error("Approval lifecycle RPC returned an invalid record");
  }
  return mapApprovalRows(value.approval, value.intent);
}

export function mapApprovalRows(approval: any, intent: any): ApprovalRecord {
  const mappedIntent: ExecutionIntent = {
    schemaVersion: "agent.execution_intent.v1",
    intentId: intent.intent_id,
    actorId: intent.actor_id,
    action: intent.action,
    resourceType: intent.resource_type,
    resourceId: intent.resource_id,
    parameters: intent.parameters || {},
    intentDigest: intent.intent_digest,
    risk: "financial_irreversible",
    status: intent.status as ApprovalStatus,
    createdAt: intent.created_at,
    expiresAt: intent.expires_at,
  };
  return {
    schemaVersion: "agent.approval.v1",
    approvalId: approval.approval_id,
    intent: mappedIntent,
    actorId: approval.actor_id,
    taskId: approval.task_id,
    toolCallId: approval.tool_call_id,
    status: approval.status as ApprovalStatus,
    policy: approval.approval_policy,
    idempotencyKey: approval.idempotency_key,
    stateVersion: Number(approval.state_version),
    requestedAt: approval.requested_at,
    expiresAt: approval.expires_at,
    ...(approval.decided_at ? { decidedAt: approval.decided_at } : {}),
    ...(approval.consumed_at ? { consumedAt: approval.consumed_at } : {}),
    ...(approval.recent_auth_at ? { recentAuthAt: approval.recent_auth_at } : {}),
  };
}

function repositoryError(error: { message?: string; code?: string }): Error {
  return Object.assign(
    new Error(error.message || "Approval lifecycle persistence failed"),
    { code: error.code || "APPROVAL_PERSISTENCE_FAILED" },
  );
}
