import { fetchNarrativeLink } from "../../integrations/narrative-link-adapter.ts";
import type { AgentTool, ToolExecutionContext, ToolResult } from "../contracts/tool.ts";
import { ToolRegistry } from "./registry.ts";

interface LegacyIntegrations {
  marketTrending(options: Record<string, unknown>): Promise<Record<string, unknown>>;
}

interface WalletGroupReadRepository {
  listGroups(ownerUserId: string): Promise<unknown[]> | unknown[];
}

interface NarrativeReadRepository {
  listActive(options: { topic?: string; limit?: number }): Promise<unknown[]> | unknown[];
}

export interface LegacyReadToolDependencies {
  integrations?: LegacyIntegrations;
  walletGroupRepository?: WalletGroupReadRepository;
  narrativeRepository?: NarrativeReadRepository;
}

export function createLegacyReadToolRegistry(dependencies: LegacyReadToolDependencies = {}): ToolRegistry {
  const registry = new ToolRegistry();
  if (dependencies.narrativeRepository) {
    registry.register(pulseNarrativesTool(dependencies.narrativeRepository));
  }
  if (dependencies.walletGroupRepository) {
    registry.register(assetsWalletGroupsTool(dependencies.walletGroupRepository));
  }
  if (dependencies.integrations) {
    registry.register(gmgnTrendingTool(dependencies.integrations));
    registry.register(gmgnTrendingToolV2(dependencies.integrations));
  }
  registry.register(publicLinkTool());
  return registry;
}

function pulseNarrativesTool(repository: NarrativeReadRepository): AgentTool<
  { topic?: string; limit?: number },
  { narratives: unknown[] }
> {
  return {
    definition: {
      name: "pulse.narratives.list",
      version: "1.0.0",
      description: "List active Pulse narrative candidates through an actor-scoped read model.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          topic: { type: "string", maxLength: 200 },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
      outputSchema: {
        type: "object",
        required: ["narratives"],
        properties: { narratives: { type: "array", maxItems: 50 } },
        additionalProperties: false,
      },
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["pulse:read"],
      approvalPolicy: "none",
      timeoutMs: 8_000,
      retryPolicy: "safe_read",
    },
    async execute(_context, input) {
      const narratives = await repository.listActive({
        topic: input.topic || "",
        limit: input.limit || 12,
      });
      return { status: "succeeded", data: { narratives: Array.isArray(narratives) ? narratives : [] } };
    },
  };
}

function assetsWalletGroupsTool(repository: WalletGroupReadRepository): AgentTool<
  Record<string, never>,
  { groups: unknown[] }
> {
  return {
    definition: {
      name: "assets.wallet_groups.list",
      version: "1.0.0",
      description: "List public wallet-group metadata owned by the authenticated actor.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        required: ["groups"],
        properties: { groups: { type: "array", maxItems: 200 } },
        additionalProperties: false,
      },
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["assets:read"],
      approvalPolicy: "none",
      timeoutMs: 8_000,
      retryPolicy: "safe_read",
    },
    async execute(context) {
      const groups = await repository.listGroups(context.actor.actorId);
      return { status: "succeeded", data: { groups: Array.isArray(groups) ? groups : [] } };
    },
  };
}

function gmgnTrendingTool(integrations: LegacyIntegrations): AgentTool<
  { chain?: string; interval?: string; limit?: number },
  Record<string, unknown>
> {
  return {
    definition: {
      name: "market.gmgn.trending",
      version: "1.0.0",
      description: "Read the GMGN trending-token ranking without executing a trade.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          chain: { type: "string", enum: ["solana", "bsc", "base", "eth"] },
          interval: { type: "string", enum: ["5m", "1h", "6h", "24h"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
      },
      outputSchema: { type: "object" },
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["market:read"],
      approvalPolicy: "none",
      timeoutMs: 20_000,
      retryPolicy: "safe_read",
    },
    async execute(context, input) {
      const data = await integrations.marketTrending({
        chain: input.chain || "solana",
        interval: input.interval || "1h",
        limit: input.limit || 20,
        requestId: context.requestId,
      });
      return { status: "succeeded", data };
    },
  };
}

function gmgnTrendingToolV2(integrations: LegacyIntegrations): AgentTool<
  {
    chain?: string;
    interval?: string;
    limit?: number;
    orderBy?: string;
    direction?: string;
    filters?: string[];
    platforms?: string[];
  },
  Record<string, unknown>
> {
  return {
    definition: {
      name: "market.gmgn.trending",
      version: "2.0.0",
      description: "Read a filtered GMGN trending-token ranking without executing a trade.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          chain: { type: "string", enum: ["solana", "bsc", "base", "eth"] },
          interval: { type: "string", enum: ["1m", "5m", "1h", "6h", "24h"] },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          orderBy: {
            type: "string",
            enum: ["default", "volume", "swaps", "marketcap", "holder_count", "price", "change1h"],
          },
          direction: { type: "string", enum: ["asc", "desc"] },
          filters: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 100 },
          },
          platforms: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
      outputSchema: { type: "object" },
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["market:read"],
      approvalPolicy: "none",
      timeoutMs: 20_000,
      retryPolicy: "safe_read",
    },
    async execute(context, input) {
      const data = await integrations.marketTrending({
        chain: input.chain || "solana",
        interval: input.interval || "1h",
        limit: input.limit || 20,
        orderBy: input.orderBy || "volume",
        direction: input.direction || "desc",
        filters: input.filters || [],
        platforms: input.platforms || [],
        requestId: context.requestId,
      });
      return { status: "succeeded", data };
    },
  };
}

function publicLinkTool(): AgentTool<
  { url: string; timeoutMs?: number },
  Record<string, unknown>
> {
  return {
    definition: {
      name: "research.public_link.read",
      version: "1.0.0",
      description: "Read bounded public-link metadata through the existing SSRF-protected adapter.",
      inputSchema: {
        type: "object",
        required: ["url"],
        additionalProperties: false,
        properties: {
          url: { type: "string", pattern: "^https?://", maxLength: 2_000 },
          timeoutMs: { type: "integer", minimum: 1_000, maximum: 20_000 },
        },
      },
      outputSchema: { type: "object" },
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["research:read"],
      approvalPolicy: "none",
      timeoutMs: 22_000,
      retryPolicy: "safe_read",
    },
    async execute(_context: ToolExecutionContext, input): Promise<ToolResult<Record<string, unknown>>> {
      const data = await fetchNarrativeLink(input.url, { timeoutMs: input.timeoutMs || 8_000 });
      return { status: "succeeded", data };
    },
  };
}
