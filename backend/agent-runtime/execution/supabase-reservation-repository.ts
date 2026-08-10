import type {
  ApprovedExecutionEnvelope,
  ExecutionReservation,
  ExecutionTransition,
  WalletSignatureConfirmation,
} from "../contracts/index.ts";
import type { ExecutionReservationRepository } from "./reservation.ts";

type SupabaseLike = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
  from(table: string): any;
};

export class SupabaseExecutionReservationRepository implements ExecutionReservationRepository {
  constructor(private readonly supabase: SupabaseLike) {}

  async consumeApprovalAndReserve(input: {
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    reservation: ExecutionReservation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean } | null> {
    const { data, error } = await this.supabase.rpc("agent_reserve_execution_v1", {
      p_record: input.reservation,
      p_expected_approval_version: input.approvalExpectedStateVersion,
      p_expected_task_version: input.taskExpectedStateVersion,
    });
    if (error) {
      throw Object.assign(
        new Error(error.message || "Execution reservation persistence failed"),
        { code: error.code || "EXECUTION_RESERVATION_PERSISTENCE_FAILED" },
      );
    }
    if (!data) return null;
    const result = data as any;
    return {
      reservation: mapExecution(result.reservation),
      idempotentReplay: Boolean(result.idempotentReplay),
    };
  }

  async get(executionId: string): Promise<ExecutionReservation | null> {
    const { data, error } = await this.supabase
      .from("agent_executions")
      .select("*")
      .eq("execution_id", executionId)
      .maybeSingle();
    if (error) {
      throw Object.assign(
        new Error(error.message || "Unable to read execution reservation"),
        { code: error.code || "EXECUTION_RESERVATION_READ_FAILED" },
      );
    }
    return data ? mapExecution(data) : null;
  }

  async consumeWalletSignatureAndReserve(input: {
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    confirmation: WalletSignatureConfirmation;
    reservation: ExecutionReservation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean } | null> {
    const { data, error } = await this.supabase.rpc(
      "agent_reserve_wallet_signed_execution_v1",
      {
        p_record: input.reservation,
        p_evidence: input.confirmation,
        p_expected_approval_version: input.approvalExpectedStateVersion,
        p_expected_task_version: input.taskExpectedStateVersion,
      },
    );
    if (error) {
      throw Object.assign(
        new Error(error.message || "Wallet-signed execution reservation failed"),
        { code: error.code || "WALLET_SIGNED_EXECUTION_RESERVATION_FAILED" },
      );
    }
    if (!data) return null;
    const result = data as any;
    return {
      reservation: mapExecution(result.reservation),
      idempotentReplay: Boolean(result.idempotentReplay),
    };
  }

  async bindSemanticEnvelope(input: {
    executionId: string;
    actorId: string;
    expectedStateVersion: number;
    envelope: ApprovedExecutionEnvelope;
    verifiedAt: string;
  }): Promise<ExecutionReservation | null> {
    const { data, error } = await this.supabase.rpc("agent_bind_execution_envelope_v1", {
      p_record: {
        executionId: input.executionId,
        actorId: input.actorId,
        expectedStateVersion: input.expectedStateVersion,
        envelope: input.envelope,
        verifiedAt: input.verifiedAt,
      },
    });
    if (error) {
      throw Object.assign(
        new Error(error.message || "Execution semantic envelope persistence failed"),
        { code: error.code || "EXECUTION_SEMANTICS_PERSISTENCE_FAILED" },
      );
    }
    return data ? mapExecution(data) : null;
  }

  async transition(input: ExecutionTransition & {
    transitionedAt: string;
  }): Promise<ExecutionReservation | null> {
    const { data, error } = await this.supabase.rpc("agent_transition_execution_v1", {
      p_record: {
        executionId: input.executionId,
        actorId: input.actorId,
        expectedStatus: input.expectedStatus,
        expectedStateVersion: input.expectedStateVersion,
        status: input.status,
        ...(input.txHash ? { txHash: input.txHash } : {}),
        ...(input.failure ? { failure: input.failure } : {}),
        transitionedAt: input.transitionedAt,
      },
    });
    if (error) {
      throw Object.assign(
        new Error(error.message || "Execution transition persistence failed"),
        { code: error.code || "EXECUTION_TRANSITION_PERSISTENCE_FAILED" },
      );
    }
    return data ? mapExecution(data) : null;
  }
}

export function mapExecution(row: any): ExecutionReservation {
  if (!row?.execution_id) {
    throw new Error("Execution reservation RPC returned an invalid record");
  }
  return {
    schemaVersion: "agent.execution.v1",
    executionId: row.execution_id,
    taskId: row.task_id,
    toolCallId: row.tool_call_id,
    approvalId: row.approval_id,
    intentId: row.intent_id,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    intentDigest: row.intent_digest,
    idempotencyKey: row.idempotency_key,
    requestFingerprint: row.request_fingerprint,
    ...(row.provider ? { provider: row.provider } : {}),
    ...(row.chain ? { chain: row.chain } : {}),
    status: row.status,
    stateVersion: Number(row.state_version),
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.failure ? { failure: row.failure } : {}),
    ...(row.semantic_envelope ? { semanticEnvelope: row.semantic_envelope } : {}),
    ...(row.semantics_verified_at ? { semanticsVerifiedAt: row.semantics_verified_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.submitted_at ? { submittedAt: row.submitted_at } : {}),
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}
