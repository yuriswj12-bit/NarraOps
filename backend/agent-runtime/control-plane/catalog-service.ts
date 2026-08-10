import {
  createHash,
  randomUUID,
} from "node:crypto";
import type {
  ActorRef,
  AgentDefinitionVersion,
  AgentManifest,
  AgentSkillBinding,
  JsonObject,
  JsonSchema,
  ResourceVersionRef,
  SkillDefinitionVersion,
  ToolApprovalPolicy,
  ToolRisk,
  ToolSideEffect,
} from "../contracts/index.ts";

const SLUG_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const NAME_PATTERN = /^[a-z][a-z0-9_.-]{2,100}$/;
const VERSION_PATTERN = /^[1-9][0-9]*\.[0-9]+\.[0-9]+$/;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function checksum(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

export class AgentCatalogError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "AgentCatalogError";
  }
}

export interface AgentCatalogRepository {
  publishAgent(record: AgentDefinitionVersion): Promise<AgentDefinitionVersion>;
  publishSkill(record: SkillDefinitionVersion): Promise<SkillDefinitionVersion>;
  bindSkill(binding: AgentSkillBinding): Promise<AgentSkillBinding>;
  getManifest(slug: string): Promise<AgentManifest | null>;
}

export class AgentCatalogService {
  constructor(
    private readonly repository: AgentCatalogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async publishAgent(input: {
    actor: ActorRef;
    slug: string;
    version: number;
    name: string;
    description?: string;
    systemInstructions: string;
    capabilityManifest: string[];
    modelPolicy: AgentDefinitionVersion["modelPolicy"];
    memoryPolicy: AgentDefinitionVersion["memoryPolicy"];
  }): Promise<AgentDefinitionVersion> {
    this.assertAdmin(input.actor);
    if (!SLUG_PATTERN.test(input.slug) || !Number.isInteger(input.version) || input.version < 1) {
      throw new AgentCatalogError(
        "AGENT_DEFINITION_IDENTITY_INVALID",
        "Agent slug or version is invalid",
      );
    }
    const name = input.name.trim();
    const instructions = input.systemInstructions.trim();
    if (!name || name.length > 120 || !instructions || instructions.length > 50_000) {
      throw new AgentCatalogError(
        "AGENT_DEFINITION_CONTENT_INVALID",
        "Agent name or system instructions are invalid",
      );
    }
    const capabilities = uniqueStrings(input.capabilityManifest);
    if (capabilities.length > 100 || capabilities.some((value) => !NAME_PATTERN.test(value))) {
      throw new AgentCatalogError(
        "AGENT_CAPABILITY_MANIFEST_INVALID",
        "Agent capability manifest is invalid",
      );
    }
    const allowedProviders = uniqueStrings(input.modelPolicy.allowedProviders);
    if (
      allowedProviders.length < 1
      || allowedProviders.length > 20
      || allowedProviders.some((value) => !/^[a-z][a-z0-9_.-]{1,63}$/.test(value))
      || (
        input.modelPolicy.defaultProvider
        && !allowedProviders.includes(input.modelPolicy.defaultProvider)
      )
    ) {
      throw new AgentCatalogError(
        "AGENT_MODEL_POLICY_INVALID",
        "Agent model policy is invalid",
      );
    }
    const allowedScopes = [...new Set(input.memoryPolicy.allowedScopes)];
    if (
      allowedScopes.some((value) => !["user", "conversation", "task"].includes(value))
      || !Number.isInteger(input.memoryPolicy.retrievalLimit)
      || input.memoryPolicy.retrievalLimit < 0
      || input.memoryPolicy.retrievalLimit > 50
    ) {
      throw new AgentCatalogError(
        "AGENT_MEMORY_POLICY_INVALID",
        "Agent memory policy is invalid",
      );
    }
    const createdAt = this.now().toISOString();
    const semantic = {
      slug: input.slug,
      version: input.version,
      name,
      description: input.description?.trim() || undefined,
      systemInstructions: instructions,
      capabilityManifest: capabilities,
      modelPolicy: {
        allowedProviders,
        ...(input.modelPolicy.defaultProvider
          ? { defaultProvider: input.modelPolicy.defaultProvider }
          : {}),
        ...(input.modelPolicy.parameters
          ? { parameters: structuredClone(input.modelPolicy.parameters) }
          : {}),
      },
      memoryPolicy: {
        ...input.memoryPolicy,
        allowedScopes,
      },
    };
    return this.repository.publishAgent({
      schemaVersion: "agent.definition.v1",
      agentId: randomUUID(),
      agentVersionId: randomUUID(),
      ...semantic,
      status: "published",
      checksum: checksum(semantic),
      createdAt,
      publishedAt: createdAt,
    });
  }

  async publishSkill(input: {
    actor: ActorRef;
    slug: string;
    version: number;
    name: string;
    description?: string;
    instructions: string;
    inputSchema: JsonSchema;
    outputSchema: JsonSchema;
    risk: ToolRisk;
    sideEffect: ToolSideEffect;
    approvalPolicy: ToolApprovalPolicy;
    requiredPermissions: string[];
    requiredTools: Array<{ name: string; version: string }>;
    resourceRefs?: ResourceVersionRef[];
  }): Promise<SkillDefinitionVersion> {
    this.assertAdmin(input.actor);
    if (!SLUG_PATTERN.test(input.slug) || !Number.isInteger(input.version) || input.version < 1) {
      throw new AgentCatalogError(
        "AGENT_SKILL_IDENTITY_INVALID",
        "Skill slug or version is invalid",
      );
    }
    const instructions = input.instructions.trim();
    if (!input.name.trim() || !instructions || instructions.length > 50_000) {
      throw new AgentCatalogError(
        "AGENT_SKILL_CONTENT_INVALID",
        "Skill name or instructions are invalid",
      );
    }
    if (
      input.risk === "financial_irreversible"
      && (
        input.approvalPolicy === "none"
        || input.sideEffect !== "funds"
      )
    ) {
      throw new AgentCatalogError(
        "AGENT_SKILL_FINANCIAL_POLICY_INVALID",
        "Financial skills require funds side effects and explicit approval",
      );
    }
    const requiredPermissions = uniqueStrings(input.requiredPermissions);
    const requiredTools = input.requiredTools.map((tool) => ({
      name: tool.name.trim(),
      version: tool.version.trim(),
    }));
    if (
      requiredPermissions.length > 100
      || requiredTools.length > 50
      || requiredTools.some(
        (tool) => !NAME_PATTERN.test(tool.name) || !VERSION_PATTERN.test(tool.version),
      )
    ) {
      throw new AgentCatalogError(
        "AGENT_SKILL_DEPENDENCIES_INVALID",
        "Skill permissions or tool dependencies are invalid",
      );
    }
    const createdAt = this.now().toISOString();
    const semantic = {
      slug: input.slug,
      version: input.version,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      instructions,
      inputSchema: structuredClone(input.inputSchema),
      outputSchema: structuredClone(input.outputSchema),
      risk: input.risk,
      sideEffect: input.sideEffect,
      approvalPolicy: input.approvalPolicy,
      requiredPermissions,
      requiredTools,
      resourceRefs: structuredClone(input.resourceRefs || []),
    };
    return this.repository.publishSkill({
      schemaVersion: "agent.skill.v1",
      skillId: randomUUID(),
      skillVersionId: randomUUID(),
      ...semantic,
      status: "published",
      checksum: checksum(semantic),
      createdAt,
      publishedAt: createdAt,
    });
  }

  async bindSkill(input: {
    actor: ActorRef;
    agentVersionId: string;
    skillVersionId: string;
    enabled?: boolean;
    priority?: number;
    config?: JsonObject;
  }): Promise<AgentSkillBinding> {
    this.assertAdmin(input.actor);
    const priority = input.priority ?? 100;
    if (!input.agentVersionId || !input.skillVersionId || !Number.isInteger(priority)) {
      throw new AgentCatalogError(
        "AGENT_SKILL_BINDING_INVALID",
        "Agent skill binding is invalid",
      );
    }
    return this.repository.bindSkill({
      agentVersionId: input.agentVersionId,
      skillVersionId: input.skillVersionId,
      enabled: input.enabled !== false,
      priority,
      config: structuredClone(input.config || {}),
      createdAt: this.now().toISOString(),
    });
  }

  getManifest(slug: string): Promise<AgentManifest | null> {
    if (!SLUG_PATTERN.test(slug)) {
      throw new AgentCatalogError(
        "AGENT_DEFINITION_IDENTITY_INVALID",
        "Agent slug is invalid",
      );
    }
    return this.repository.getManifest(slug);
  }

  private assertAdmin(actor: ActorRef): void {
    if (!actor.actorId || !actor.permissions.includes("agent:admin")) {
      throw new AgentCatalogError(
        "AGENT_CATALOG_ADMIN_REQUIRED",
        "Publishing Agent or Skill versions requires agent:admin",
      );
    }
  }
}

export class InMemoryAgentCatalogRepository implements AgentCatalogRepository {
  readonly #agents = new Map<string, AgentDefinitionVersion>();
  readonly #skills = new Map<string, SkillDefinitionVersion>();
  readonly #bindings = new Map<string, AgentSkillBinding>();

  async publishAgent(record: AgentDefinitionVersion): Promise<AgentDefinitionVersion> {
    const key = `${record.slug}:${record.version}`;
    const existing = this.#agents.get(key);
    if (existing && existing.checksum !== record.checksum) {
      throw new AgentCatalogError(
        "AGENT_DEFINITION_VERSION_CONFLICT",
        "Agent version already exists with a different checksum",
      );
    }
    const persisted = existing || structuredClone(record);
    this.#agents.set(key, persisted);
    return structuredClone(persisted);
  }

  async publishSkill(record: SkillDefinitionVersion): Promise<SkillDefinitionVersion> {
    const key = `${record.slug}:${record.version}`;
    const existing = this.#skills.get(key);
    if (existing && existing.checksum !== record.checksum) {
      throw new AgentCatalogError(
        "AGENT_SKILL_VERSION_CONFLICT",
        "Skill version already exists with a different checksum",
      );
    }
    const persisted = existing || structuredClone(record);
    this.#skills.set(key, persisted);
    return structuredClone(persisted);
  }

  async bindSkill(binding: AgentSkillBinding): Promise<AgentSkillBinding> {
    const agent = [...this.#agents.values()]
      .find((record) => record.agentVersionId === binding.agentVersionId);
    const skill = [...this.#skills.values()]
      .find((record) => record.skillVersionId === binding.skillVersionId);
    if (!agent || !skill) {
      throw new AgentCatalogError(
        "AGENT_SKILL_BINDING_TARGET_NOT_FOUND",
        "Agent or Skill version was not found",
      );
    }
    const key = `${binding.agentVersionId}:${binding.skillVersionId}`;
    this.#bindings.set(key, structuredClone(binding));
    return structuredClone(binding);
  }

  async getManifest(slug: string): Promise<AgentManifest | null> {
    const versions = [...this.#agents.values()]
      .filter((record) => record.slug === slug && record.status === "published")
      .sort((left, right) => right.version - left.version);
    const agent = versions[0];
    if (!agent) return null;
    const skills = [...this.#bindings.values()]
      .filter((binding) => binding.agentVersionId === agent.agentVersionId && binding.enabled)
      .sort((left, right) => left.priority - right.priority)
      .map((binding) => {
        const skill = [...this.#skills.values()]
          .find((record) => record.skillVersionId === binding.skillVersionId);
        return skill ? { binding, skill } : null;
      })
      .filter((value): value is AgentManifest["skills"][number] => Boolean(value));
    return structuredClone({ agent, skills });
  }
}
