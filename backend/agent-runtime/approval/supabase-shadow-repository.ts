import type { ApprovalShadowRecord } from "../contracts/index.ts";
import type { ApprovalShadowRepository } from "./shadow-recorder.ts";

export class SupabaseApprovalShadowRepository implements ApprovalShadowRepository {
  constructor(private readonly supabase: any) {}

  async create(record: ApprovalShadowRecord): Promise<ApprovalShadowRecord> {
    const { data, error } = await this.supabase.rpc("agent_record_approval_shadow_v1", {
      p_record: record,
    });
    if (error) throw error;
    return data?.record || record;
  }
}
