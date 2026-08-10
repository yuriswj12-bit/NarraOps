import type {
  FinancialToolStartRecord,
  FinancialToolStartResult,
} from "../contracts/index.ts";
import type { FinancialToolStartRepository } from "./financial-tool-starter.ts";
import { mapApprovalRows } from "./supabase-lifecycle-repository.ts";

type SupabaseLike = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

export class SupabaseFinancialToolStartRepository
implements FinancialToolStartRepository {
  constructor(private readonly supabase: SupabaseLike) {}

  async begin(record: FinancialToolStartRecord): Promise<FinancialToolStartResult> {
    const { data, error } = await this.supabase.rpc("agent_begin_financial_tool_v1", {
      p_record: record,
    });
    if (error) {
      throw Object.assign(
        new Error(error.message || "Financial tool start persistence failed"),
        { code: error.code || "FINANCIAL_TOOL_START_PERSISTENCE_FAILED" },
      );
    }
    const result = data as any;
    if (!result?.task?.task_id || !result?.toolCall?.tool_call_id || !result?.approval) {
      throw new Error("Financial tool start RPC returned an invalid record");
    }
    return {
      taskId: result.task.task_id,
      toolCallId: result.toolCall.tool_call_id,
      approval: mapApprovalRows(
        result.approval,
        result.intent || record.approval.intent,
      ),
      taskStateVersion: Number(result.task.state_version),
      idempotentReplay: Boolean(result.idempotentReplay),
    };
  }
}
