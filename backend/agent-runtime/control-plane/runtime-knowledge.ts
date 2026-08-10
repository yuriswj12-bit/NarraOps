import type {
  AgentManifest,
  MemoryKind,
  MemoryScope,
} from "../contracts/index.ts";
import type { AgentCatalogRepository } from "./catalog-service.ts";
import type { AgentMemoryService } from "../memory/memory-service.ts";

export interface RuntimeKnowledge {
  manifest: AgentManifest;
  memories: Array<{
    scope: MemoryScope;
    kind: MemoryKind;
    content: string;
    confidence: number;
    sourceType: string;
  }>;
}

/**
 * Resolves trusted, versioned Agent configuration and actor-bound durable
 * memory before a Model Provider is selected. Providers receive only this
 * safe projection; they never receive database access or repository handles.
 */
export class RuntimeKnowledgeResolver {
  constructor(
    private readonly catalog: AgentCatalogRepository,
    private readonly memory: AgentMemoryService,
    private readonly agentSlug = "narraops-agent",
  ) {}

  async resolve(actorId?: string): Promise<RuntimeKnowledge | null> {
    const manifest = await this.catalog.getManifest(this.agentSlug);
    if (!manifest) return null;
    const policy = manifest.agent.memoryPolicy;
    if (!actorId || !policy.enabled || policy.retrievalLimit < 1) {
      return { manifest, memories: [] };
    }
    const items = await this.memory.retrieve({
      actorId,
      agentId: manifest.agent.agentId,
      scopes: policy.allowedScopes,
      limit: policy.retrievalLimit,
    });
    return {
      manifest,
      memories: items.map((item) => ({
        scope: item.scope,
        kind: item.kind,
        content: item.content,
        confidence: item.confidence,
        sourceType: item.source.type,
      })),
    };
  }
}
