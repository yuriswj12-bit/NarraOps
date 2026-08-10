import type { ExecutionSemanticShadowRecord } from "../contracts/index.ts";
import type { SemanticShadowRepository } from "./semantic-shadow-recorder.ts";

type SupabaseLike = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

export class SupabaseSemanticShadowRepository implements SemanticShadowRepository {
  constructor(private readonly supabase: SupabaseLike) {}

  async create(
    record: ExecutionSemanticShadowRecord,
  ): Promise<ExecutionSemanticShadowRecord> {
    const { data, error } = await this.supabase.rpc(
      "agent_record_semantic_shadow_v1",
      { p_record: record },
    );
    if (error) {
      throw Object.assign(
        new Error(error.message || "Semantic shadow persistence failed"),
        { code: error.code || "SEMANTIC_SHADOW_PERSISTENCE_FAILED" },
      );
    }
    const persisted = data as any;
    if (!persisted?.shadow_id) {
      throw Object.assign(
        new Error("Semantic shadow RPC returned an invalid record"),
        { code: "SEMANTIC_SHADOW_RPC_INVALID_RESPONSE" },
      );
    }
    return {
      schemaVersion: "agent.semantic_shadow.v1",
      shadowId: persisted.shadow_id,
      actorId: persisted.actor_id,
      action: persisted.action,
      resourceType: persisted.resource_type,
      resourceId: persisted.resource_id,
      envelope: persisted.semantic_envelope,
      inspections: persisted.inspections,
      shadowMode: true,
      recordedAt: persisted.recorded_at,
    };
  }
}
