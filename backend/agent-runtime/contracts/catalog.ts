import type {
  JsonObject,
  JsonSchema,
  ResourceVersionRef,
} from "./common.ts";
import type {
  ToolApprovalPolicy,
  ToolRisk,
  ToolSideEffect,
} from "./tool.ts";

export type CatalogStatus = "draft" | "published" | "retired";

export interface AgentDefinitionVersion {
  schemaVersion: "agent.definition.v1";
  agentId: string;
  agentVersionId: string;
  slug: string;
  version: number;
  name: string;
  description?: string;
  status: CatalogStatus;
  systemInstructions: string;
  capabilityManifest: string[];
  modelPolicy: {
    allowedProviders: string[];
    defaultProvider?: string;
    parameters?: JsonObject;
  };
  memoryPolicy: {
    enabled: boolean;
    allowedScopes: Array<"user" | "conversation" | "task">;
    retrievalLimit: number;
    requireUserConfirmation: boolean;
  };
  checksum: string;
  createdAt: string;
  publishedAt?: string;
}

export interface SkillDefinitionVersion {
  schemaVersion: "agent.skill.v1";
  skillId: string;
  skillVersionId: string;
  slug: string;
  version: number;
  name: string;
  description?: string;
  status: CatalogStatus;
  instructions: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  risk: ToolRisk;
  sideEffect: ToolSideEffect;
  approvalPolicy: ToolApprovalPolicy;
  requiredPermissions: string[];
  requiredTools: Array<{ name: string; version: string }>;
  resourceRefs: ResourceVersionRef[];
  checksum: string;
  createdAt: string;
  publishedAt?: string;
}

export interface AgentSkillBinding {
  agentVersionId: string;
  skillVersionId: string;
  enabled: boolean;
  priority: number;
  config: JsonObject;
  createdAt: string;
}

export interface AgentManifest {
  agent: AgentDefinitionVersion;
  skills: Array<{
    binding: AgentSkillBinding;
    skill: SkillDefinitionVersion;
  }>;
}
