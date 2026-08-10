import type {
  AgentDefinitionVersion,
  AgentManifest,
  AgentSkillBinding,
  SkillDefinitionVersion,
} from "../contracts/index.ts";
import {
  AgentCatalogError,
  type AgentCatalogRepository,
} from "./catalog-service.ts";

type SupabaseLike = {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{
    data: unknown;
    error: { message?: string; code?: string } | null;
  }>;
};

export class SupabaseAgentCatalogRepository implements AgentCatalogRepository {
  constructor(private readonly supabase: SupabaseLike) {}

  async publishAgent(record: AgentDefinitionVersion): Promise<AgentDefinitionVersion> {
    const { data, error } = await this.supabase.rpc("agent_publish_definition_v1", {
      p_record: record,
    });
    if (error) throw catalogPersistenceError(error, "AGENT_DEFINITION_PERSISTENCE_FAILED");
    return assertRecord<AgentDefinitionVersion>(data, "Agent definition");
  }

  async publishSkill(record: SkillDefinitionVersion): Promise<SkillDefinitionVersion> {
    const { data, error } = await this.supabase.rpc("agent_publish_skill_v1", {
      p_record: record,
    });
    if (error) throw catalogPersistenceError(error, "AGENT_SKILL_PERSISTENCE_FAILED");
    return assertRecord<SkillDefinitionVersion>(data, "Skill definition");
  }

  async bindSkill(binding: AgentSkillBinding): Promise<AgentSkillBinding> {
    const { data, error } = await this.supabase.rpc("agent_bind_skill_v1", {
      p_record: binding,
    });
    if (error) throw catalogPersistenceError(error, "AGENT_SKILL_BINDING_FAILED");
    return assertRecord<AgentSkillBinding>(data, "Agent Skill binding");
  }

  async getManifest(slug: string): Promise<AgentManifest | null> {
    const { data, error } = await this.supabase.rpc("agent_get_manifest_v1", {
      p_slug: slug,
    });
    if (error) throw catalogPersistenceError(error, "AGENT_MANIFEST_READ_FAILED");
    return data ? assertRecord<AgentManifest>(data, "Agent manifest") : null;
  }
}

function assertRecord<T>(value: unknown, label: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentCatalogError(
      "AGENT_CATALOG_PERSISTENCE_INVALID",
      `${label} persistence returned an invalid record`,
    );
  }
  return value as T;
}

function catalogPersistenceError(
  error: { message?: string; code?: string },
  fallbackCode: string,
): AgentCatalogError {
  const known = [
    "AGENT_DEFINITION_VERSION_CONFLICT",
    "AGENT_SKILL_VERSION_CONFLICT",
    "AGENT_SKILL_FINANCIAL_POLICY_INVALID",
  ].find((code) => error.message?.includes(code));
  return new AgentCatalogError(
    known || error.code || fallbackCode,
    error.message || "Agent catalog persistence failed",
  );
}
