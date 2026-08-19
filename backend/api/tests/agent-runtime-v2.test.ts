import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import BN from "bn.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import {
  AssetsWalletGroupContextProvider,
  AgentCatalogError,
  AgentCatalogService,
  AgentMemoryError,
  AgentMemoryService,
  ApprovalLifecycle,
  ApprovalLifecycleError,
  ApprovalShadowRecorder,
  ContextResolutionError,
  ContextResolver,
  ExecutionReservationError,
  ExecutionReservationService,
  ExecutionReconciler,
  ExecutionSemanticEnvelopeService,
  ExecutionSemanticShadowRecorder,
  ExecutionTransitionError,
  ExecutionTransitionService,
  FinancialToolStartError,
  FinancialToolStarter,
  LegacyRuntimeFacade,
  InMemoryApprovalLifecycleRepository,
  InMemoryApprovalShadowRepository,
  InMemoryAgentCatalogRepository,
  InMemoryAgentMemoryRepository,
  InMemoryExecutionReservationRepository,
  InMemoryFinancialToolStartRepository,
  InMemorySemanticShadowRepository,
  ModelGateway,
  ModelPolicyRouter,
  NARRAOPS_AGENT_V2,
  NARRAOPS_AGENT_V3,
  NARRAOPS_READ_SKILLS_V2,
  NARRAOPS_BUSINESS_SKILLS_V1,
  PulseSnapshotContextProvider,
  PumpLaunchInspectionError,
  RuntimeKnowledgeResolver,
  SchemaValidationError,
  ToolRegistry,
  ToolRegistryError,
  SemanticVerificationError,
  SupabaseAgentCatalogRepository,
  SupabaseAgentMemoryRepository,
  assertTaskTransition,
  buildApprovedPumpLaunchEnvelope,
  canTransitionExecution,
  createPumpLaunchBroadcastTool,
  createSolanaSwapBroadcastTool,
  createLegacyReadToolRegistry,
  executionEnvelopeDigest,
  executionIntentDigest,
  createAssetTransferBroadcastTool,
  inspectPreparedPumpLaunch,
  verifyExecutionSemantics,
  type ApprovedExecutionEnvelope,
  type AgentTool,
  type ModelProvider,
  type PumpLaunchBroadcastOutput,
  type TransactionInspection,
  type ToolExecutionContext,
} from "../../agent-runtime/index.ts";
import { createAgentRuntime } from "../../agents/agent-runtime.ts";
import { createAgentHandlers } from "../../agents/agent-handlers.ts";
import { TaskManager } from "../../agents/task-manager.ts";
import { projectAgentCapabilities, submitPumpBroadcastViaGateway, submitSolanaSwapViaGateway, submitAssetTransferViaGateway } from "../../../api/v1/agent/runtime.ts";
import { validateConversationMessage } from "../src/validation.ts";
import { InMemoryTaskRepository } from "../src/repositories/in-memory-task-repository.ts";
import { InMemoryConversationRepository } from "../src/repositories/in-memory-conversation-repository.ts";
import { InMemoryLaunchDraftRepository } from "../src/repositories/in-memory-launch-draft-repository.ts";

function toolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    requestId: randomUUID(),
    traceId: randomUUID(),
    taskId: randomUUID(),
    actor: {
      actorId: "user-1",
      permissions: ["demo:read", "market:read", "assets:read", "research:read", "pulse:read"],
    },
    policy: {
      profile: "default",
      permissions: ["demo:read", "market:read", "assets:read", "research:read", "pulse:read"],
    },
    idempotencyKey: `test:${randomUUID()}`,
    signal: new AbortController().signal,
    async emit() {},
    ...overrides,
  };
}

test("Agent catalog versions manifests and binds declarative skills without executable code", async () => {
  const repository = new InMemoryAgentCatalogRepository();
  const service = new AgentCatalogService(
    repository,
    () => new Date("2026-08-10T04:00:00.000Z"),
  );
  const admin = {
    actorId: randomUUID(),
    permissions: ["agent:admin"],
  };
  const agent = await service.publishAgent({
    actor: admin,
    slug: "narraops-agent",
    version: 1,
    name: "NarraOps Agent",
    systemInstructions: "Operate through fixed NarraOps Runtime contracts.",
    capabilityManifest: ["pulse.read", "assets.read", "launch.plan"],
    modelPolicy: {
      allowedProviders: ["glm", "gpt", "claude"],
      defaultProvider: "glm",
    },
    memoryPolicy: {
      enabled: true,
      allowedScopes: ["user", "conversation", "task"],
      retrievalLimit: 10,
      requireUserConfirmation: true,
    },
  });
  const skill = await service.publishSkill({
    actor: admin,
    slug: "pulse-research",
    version: 1,
    name: "Pulse Research",
    instructions: "Resolve evidence through the Pulse read-only tool.",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    risk: "read",
    sideEffect: "none",
    approvalPolicy: "none",
    requiredPermissions: ["pulse:read"],
    requiredTools: [{ name: "pulse.snapshot.read", version: "1.0.0" }],
  });
  await service.bindSkill({
    actor: admin,
    agentVersionId: agent.agentVersionId,
    skillVersionId: skill.skillVersionId,
    priority: 10,
  });
  const manifest = await service.getManifest("narraops-agent");
  assert.equal(manifest?.agent.checksum, agent.checksum);
  assert.equal(manifest?.skills.length, 1);
  assert.equal(manifest?.skills[0].skill.slug, "pulse-research");
  assert.equal("execute" in manifest!.skills[0].skill, false);

  const replay = await service.publishAgent({
    actor: admin,
    slug: "narraops-agent",
    version: 1,
    name: "NarraOps Agent",
    systemInstructions: "Operate through fixed NarraOps Runtime contracts.",
    capabilityManifest: ["pulse.read", "assets.read", "launch.plan"],
    modelPolicy: {
      allowedProviders: ["glm", "gpt", "claude"],
      defaultProvider: "glm",
    },
    memoryPolicy: {
      enabled: true,
      allowedScopes: ["user", "conversation", "task"],
      retrievalLimit: 10,
      requireUserConfirmation: true,
    },
  });
  assert.equal(replay.agentVersionId, agent.agentVersionId);

  await assert.rejects(
    service.publishSkill({
      actor: admin,
      slug: "unsafe-launch",
      version: 1,
      name: "Unsafe Launch",
      instructions: "Launch without approval.",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      risk: "financial_irreversible",
      sideEffect: "funds",
      approvalPolicy: "none",
      requiredPermissions: ["launch:execute"],
      requiredTools: [{ name: "launch.pump.broadcast", version: "1.0.0" }],
    }),
    (error: AgentCatalogError) =>
      error.code === "AGENT_SKILL_FINANCIAL_POLICY_INVALID",
  );
});

test("Agent capabilities expose only the safe published manifest projection", () => {
  const manifest = {
    agent: {
      ...NARRAOPS_AGENT_V2,
      schemaVersion: "agent.definition.v1",
      agentId: randomUUID(),
      agentVersionId: randomUUID(),
      status: "published",
      checksum: "secret-definition-checksum",
      createdAt: "2026-08-10T07:00:00.000Z",
      publishedAt: "2026-08-10T07:00:00.000Z",
    },
    skills: NARRAOPS_READ_SKILLS_V2.map((skill, index) => ({
      binding: {
        agentVersionId: "private-agent-version-id",
        skillVersionId: `private-skill-version-${index}`,
        enabled: true,
        priority: index,
        config: { private: true },
        createdAt: "2026-08-10T07:00:00.000Z",
      },
      skill: {
        ...skill,
        schemaVersion: "agent.skill.v1",
        skillId: `private-skill-${index}`,
        skillVersionId: `private-skill-version-${index}`,
        status: "published",
        checksum: `secret-skill-checksum-${index}`,
        createdAt: "2026-08-10T07:00:00.000Z",
        publishedAt: "2026-08-10T07:00:00.000Z",
        resourceRefs: [],
      },
    })),
  };

  const capabilities = projectAgentCapabilities(manifest);
  assert.equal(capabilities.schema_version, "agent.capabilities.v1");
  assert.equal(capabilities.agent.slug, "narraops-agent");
  assert.equal(capabilities.agent.version, 2);
  assert.equal(capabilities.agent.memory_enabled, true);
  assert.deepEqual(
    capabilities.agent.model_providers,
    ["openai-compatible", "glm", "gpt", "claude"],
  );
  assert.equal(capabilities.skills.length, 4);
  assert.deepEqual(
    capabilities.skills.find((skill) => skill.slug === "market-research")
      ?.required_tools,
    [{ name: "market.gmgn.trending", version: "2.0.0" }],
  );
  assert.deepEqual(capabilities.published_financial_tools, []);

  const serialized = JSON.stringify(capabilities);
  for (const forbidden of [
    NARRAOPS_AGENT_V2.systemInstructions,
    "secret-definition-checksum",
    "secret-skill-checksum",
    "private-agent-version-id",
    "private-skill-version",
    "\"instructions\"",
    "\"inputSchema\"",
    "\"config\"",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `leaked ${forbidden}`);
  }
});

test("Agent memory requires provenance and explicit confirmation for durable user facts", async () => {
  const repository = new InMemoryAgentMemoryRepository();
  const service = new AgentMemoryService(
    repository,
    () => new Date("2026-08-10T04:10:00.000Z"),
  );
  const actorId = randomUUID();
  const proposed = await service.propose({
    actorId,
    scope: "user",
    kind: "user_preference",
    content: "The user prefers Chinese responses.",
    source: {
      type: "user_message",
      id: "message-1",
      refs: [{ kind: "agent.message", id: "message-1" }],
    },
    confidence: 1,
    idempotencyKey: "memory:user-language:1",
  });
  assert.equal(proposed.item.status, "proposed");
  assert.deepEqual(await service.retrieve({ actorId }), []);
  assert.deepEqual(
    (await service.listForReview({ actorId })).map((item) => item.status),
    ["proposed"],
  );

  await assert.rejects(
    service.decide({
      memoryId: proposed.item.memoryId,
      actorId,
      decision: "active",
      expectedStateVersion: 1,
      confirmation: "runtime_policy",
    }),
    (error: AgentMemoryError) =>
      error.code === "AGENT_MEMORY_USER_CONFIRMATION_REQUIRED",
  );
  const active = await service.decide({
    memoryId: proposed.item.memoryId,
    actorId,
    decision: "active",
    expectedStateVersion: 1,
    confirmation: "user_explicit",
  });
  assert.equal(active.status, "active");
  assert.equal((await service.retrieve({ actorId })).length, 1);
  assert.deepEqual(
    (await service.listForReview({ actorId })).map((item) => item.status),
    ["active"],
  );
  assert.equal((await service.retrieve({ actorId: randomUUID() })).length, 0);

  await assert.rejects(
    service.propose({
      actorId,
      scope: "user",
      kind: "user_fact",
      content: "Unsafe structured memory",
      structuredValue: { privateKey: "must-never-persist" },
      source: { type: "runtime", id: "runtime-1", refs: [] },
      confidence: 0.5,
      idempotencyKey: "memory:secret-reject:1",
    }),
    (error: AgentMemoryError) =>
      error.code === "AGENT_MEMORY_SECRET_REJECTED",
  );

  const deleted = await service.forget({
    memoryId: active.memoryId,
    actorId,
    expectedStateVersion: 2,
  });
  assert.equal(deleted.status, "deleted");
  assert.deepEqual(await service.retrieve({ actorId }), []);
});

test("Supabase Agent repositories preserve confirmation and use service-only RPC contracts", async () => {
  const actorId = randomUUID();
  const memoryId = randomUUID();
  const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  const proposedMemory = {
    schemaVersion: "agent.memory_item.v1",
    memoryId,
    actorId,
    scope: "user",
    kind: "user_preference",
    content: "Use Chinese.",
    sensitivity: "private",
    source: { type: "user_message", id: "message-1", refs: [] },
    confidence: 1,
    status: "proposed",
    checksum: "a".repeat(64),
    stateVersion: 1,
    idempotencyKey: "memory:test:rpc:1",
    createdAt: "2026-08-10T04:10:00.000Z",
    updatedAt: "2026-08-10T04:10:00.000Z",
  };
  const supabase = {
    async rpc(name: string, parameters: Record<string, unknown>) {
      calls.push({ name, parameters });
      if (name === "agent_get_memory_v1") {
        return { data: proposedMemory, error: null };
      }
      if (name === "agent_decide_memory_v1") {
        return {
          data: {
            ...proposedMemory,
            status: "active",
            stateVersion: 2,
            activatedAt: "2026-08-10T04:10:00.000Z",
          },
          error: null,
        };
      }
      if (name === "agent_get_manifest_v1") {
        return {
          data: {
            agent: { schemaVersion: "agent.definition.v1", slug: "narraops-agent" },
            skills: [],
          },
          error: null,
        };
      }
      return { data: null, error: { message: `Unexpected RPC: ${name}` } };
    },
  };
  const memoryService = new AgentMemoryService(
    new SupabaseAgentMemoryRepository(supabase),
    () => new Date("2026-08-10T04:10:00.000Z"),
  );
  const active = await memoryService.decide({
    memoryId,
    actorId,
    decision: "active",
    expectedStateVersion: 1,
    confirmation: "user_explicit",
  });
  assert.equal(active.status, "active");
  assert.equal(calls[1]?.name, "agent_decide_memory_v1");
  assert.equal(
    (calls[1]?.parameters.p_record as { confirmation?: string }).confirmation,
    "user_explicit",
  );

  const catalog = new SupabaseAgentCatalogRepository(supabase);
  const manifest = await catalog.getManifest("narraops-agent");
  assert.equal(manifest?.agent.slug, "narraops-agent");
  assert.deepEqual(manifest?.skills, []);
});

test("Runtime knowledge resolves versioned Agent config before provider selection and isolates memory", async () => {
  const catalogRepository = new InMemoryAgentCatalogRepository();
  const catalog = new AgentCatalogService(catalogRepository);
  const admin = { actorId: randomUUID(), permissions: ["agent:admin"] };
  const agent = await catalog.publishAgent({
    actor: admin,
    slug: "narraops-agent",
    version: 1,
    name: "NarraOps Agent",
    systemInstructions: "Use Runtime tools and fixed approval contracts.",
    capabilityManifest: ["pulse.read"],
    modelPolicy: { allowedProviders: ["glm", "gpt"] },
    memoryPolicy: {
      enabled: true,
      allowedScopes: ["user"],
      retrievalLimit: 5,
      requireUserConfirmation: true,
    },
  });
  const actorId = randomUUID();
  const memory = new AgentMemoryService(new InMemoryAgentMemoryRepository());
  const proposed = await memory.propose({
    actorId,
    agentId: agent.agentId,
    scope: "user",
    kind: "user_preference",
    content: "Prefer Chinese output.",
    source: { type: "user_message", id: "message-knowledge-1", refs: [] },
    confidence: 1,
    idempotencyKey: "memory:runtime-knowledge:1",
  });
  await memory.decide({
    memoryId: proposed.item.memoryId,
    actorId,
    decision: "active",
    expectedStateVersion: 1,
    confirmation: "user_explicit",
  });

  const resolver = new RuntimeKnowledgeResolver(catalogRepository, memory);
  const knowledge = await resolver.resolve(actorId);
  assert.equal(knowledge?.manifest.agent.agentVersionId, agent.agentVersionId);
  assert.deepEqual(knowledge?.manifest.agent.modelPolicy.allowedProviders, ["glm", "gpt"]);
  assert.deepEqual(knowledge?.memories, [{
    scope: "user",
    kind: "user_preference",
    content: "Prefer Chinese output.",
    confidence: 1,
    sourceType: "user_message",
  }]);
  assert.deepEqual((await resolver.resolve(randomUUID()))?.memories, []);
});

function demoTool(overrides: Partial<AgentTool["definition"]> = {}): AgentTool<{ value: string }, { echoed: string }> {
  return {
    definition: {
      name: "demo.echo",
      version: "1.0.0",
      description: "Echo a schema-validated string.",
      inputSchema: {
        type: "object",
        required: ["value"],
        additionalProperties: false,
        properties: { value: { type: "string", minLength: 1 } },
      },
      outputSchema: {
        type: "object",
        required: ["echoed"],
        additionalProperties: false,
        properties: { echoed: { type: "string" } },
      },
      risk: "read",
      sideEffect: "none",
      requiredPermissions: ["demo:read"],
      approvalPolicy: "none",
      timeoutMs: 500,
      retryPolicy: "safe_read",
      ...overrides,
    },
    async execute(_context, input) {
      return { status: "succeeded", data: { echoed: input.value } };
    },
  };
}

test("ToolRegistry validates input, permissions, and duplicate versions", async () => {
  const registry = new ToolRegistry().register(demoTool());
  assert.equal(registry.list()[0].name, "demo.echo");
  assert.throws(() => registry.register(demoTool()), (error: ToolRegistryError) => error.code === "TOOL_ALREADY_REGISTERED");

  await assert.rejects(
    registry.execute("demo.echo", "1.0.0", toolContext(), { value: "", extra: true }),
    SchemaValidationError,
  );
  await assert.rejects(
    registry.execute(
      "demo.echo",
      "1.0.0",
      toolContext({ policy: { profile: "restricted", permissions: [] } }),
      { value: "hello" },
    ),
    (error: ToolRegistryError) => error.code === "TOOL_PERMISSION_DENIED",
  );
  const result = await registry.execute<{ value: string }, { echoed: string }>(
    "demo.echo",
    "1.0.0",
    toolContext(),
    { value: "hello" },
  );
  assert.deepEqual(result, { status: "succeeded", data: { echoed: "hello" } });
});

test("ToolRegistry resolves the latest Tool with numeric semantic-version ordering", () => {
  const registry = new ToolRegistry()
    .register(demoTool({ version: "2.0.0" }))
    .register(demoTool({ version: "10.0.0" }))
    .register(demoTool({ version: "3.12.4" }));
  assert.equal(registry.get("demo.echo")?.definition.version, "10.0.0");
  assert.equal(registry.get("demo.echo", "2.0.0")?.definition.version, "2.0.0");
});

test("financial tools cannot register without approval and cannot execute without actor-bound approval", async () => {
  assert.throws(
    () => new ToolRegistry().register(demoTool({
      risk: "financial_irreversible",
      sideEffect: "funds",
      approvalPolicy: "none",
    })),
    (error: ToolRegistryError) => error.code === "INVALID_TOOL_DEFINITION",
  );

  const registry = new ToolRegistry().register(demoTool({
    risk: "financial_irreversible",
    sideEffect: "funds",
    approvalPolicy: "explicit",
  }));
  await assert.rejects(
    registry.execute("demo.echo", "1.0.0", toolContext(), { value: "", extra: true }),
    SchemaValidationError,
  );
  await assert.rejects(
    registry.execute("demo.echo", "1.0.0", toolContext(), { value: "send" }),
    (error: ToolRegistryError) => error.code === "TOOL_APPROVAL_REQUIRED",
  );
  await assert.rejects(
    registry.execute(
      "demo.echo",
      "1.0.0",
      toolContext({
        approval: {
          approvalId: randomUUID(),
          actorId: "another-user",
          intentDigest: "digest",
          status: "consumed",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
      { value: "send" },
    ),
    (error: ToolRegistryError) => error.code === "TOOL_APPROVAL_ACTOR_MISMATCH",
  );
  await assert.rejects(
    registry.execute(
      "demo.echo",
      "1.0.0",
      toolContext({
        intentDigest: "current-intent",
        approval: {
          approvalId: randomUUID(),
          actorId: "user-1",
          intentDigest: "old-intent",
          status: "consumed",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
      { value: "send" },
    ),
    (error: ToolRegistryError) => error.code === "TOOL_APPROVAL_INTENT_MISMATCH",
  );
});

test("Pump financial Tool accepts only a consumed recent-auth reservation and never carries signed bytes", async () => {
  let gatewayCalls = 0;
  const executionId = randomUUID();
  const approvalId = randomUUID();
  const txHash = bs58.encode(new Uint8Array(64).fill(7));
  const input = {
    executionId,
    approvalId,
    expectedStateVersion: 2,
    envelopeDigest: "a".repeat(64),
    txHash,
  };
  const tool = createPumpLaunchBroadcastTool({
    async submitReservedLaunch(context, submitted) {
      gatewayCalls += 1;
      assert.equal(context.actor.actorId, "user-1");
      assert.deepEqual(submitted, input);
      assert.equal("signedTransactionBase64" in submitted, false);
      return {
        executionId,
        status: "reconciliation_required",
        txHash,
        providerAccepted: false,
        observedAt: new Date().toISOString(),
      };
    },
  });
  assert.equal(tool.definition.retryPolicy, "none");
  assert.equal(tool.definition.risk, "financial_irreversible");
  assert.equal(tool.definition.approvalPolicy, "explicit_and_recent_auth");
  const registry = new ToolRegistry().register(tool);
  const baseContext = toolContext({
    actor: {
      actorId: "user-1",
      permissions: ["launch:execute"],
    },
    policy: {
      profile: "financial-execution",
      permissions: ["launch:execute"],
    },
  });
  await assert.rejects(
    registry.execute("launch.pump.broadcast", "1.0.0", baseContext, input),
    (error: ToolRegistryError) => error.code === "TOOL_APPROVAL_REQUIRED",
  );
  assert.equal(gatewayCalls, 0);

  const intentDigest = "intent-digest";
  const approvedContext = {
    ...baseContext,
    intentDigest,
    approval: {
      approvalId,
      actorId: "user-1",
      intentDigest,
      status: "consumed" as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recentAuthAt: new Date().toISOString(),
    },
  };
  await assert.rejects(
    registry.execute(
      "launch.pump.broadcast",
      "1.0.0",
      approvedContext,
      { ...input, executionId: "not-a-uuid" },
    ),
    SchemaValidationError,
  );
  assert.equal(gatewayCalls, 0);

  const result = await registry.execute<typeof input, PumpLaunchBroadcastOutput>(
    "launch.pump.broadcast",
    "1.0.0",
    approvedContext,
    input,
  );
  assert.equal(gatewayCalls, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(result.data.status, "reconciliation_required");
  assert.equal(result.data.providerAccepted, false);

  const contradictory = new ToolRegistry().register(
    createPumpLaunchBroadcastTool({
      async submitReservedLaunch() {
        return {
          executionId,
          status: "submitted",
          txHash,
          providerAccepted: false,
          observedAt: new Date().toISOString(),
        };
      },
    }),
  );
  await assert.rejects(
    contradictory.execute(
      "launch.pump.broadcast",
      "1.0.0",
      approvedContext,
      input,
    ),
    (error: any) => error.code === "FINANCIAL_ADAPTER_ACCEPTANCE_MISMATCH",
  );
});

test("Solana Swap financial Tool requires consumed recent auth and preserves reserved identity", async () => {
  let gatewayCalls = 0;
  const executionId = randomUUID();
  const approvalId = randomUUID();
  const txHash = bs58.encode(new Uint8Array(64).fill(9));
  const input = {
    executionId,
    approvalId,
    expectedStateVersion: 3,
    envelopeDigest: "b".repeat(64),
    txHash,
  };
  const tool = createSolanaSwapBroadcastTool({
    async submitReservedSwap(context, submitted) {
      gatewayCalls += 1;
      assert.equal(context.actor.actorId, "user-1");
      assert.deepEqual(submitted, input);
      assert.equal("signedTransactionBase64" in submitted, false);
      assert.equal("privateKey" in submitted, false);
      return {
        executionId,
        status: "submitted",
        txHash,
        providerAccepted: true,
        observedAt: new Date().toISOString(),
      };
    },
  });
  assert.equal(tool.definition.name, "swap.solana.broadcast");
  assert.equal(tool.definition.retryPolicy, "none");
  assert.equal(tool.definition.approvalPolicy, "explicit_and_recent_auth");
  assert.deepEqual(tool.definition.requiredPermissions, ["swap:execute"]);

  const registry = new ToolRegistry().register(tool);
  const baseContext = toolContext({
    actor: { actorId: "user-1", permissions: ["swap:execute"] },
    policy: {
      profile: "financial-execution",
      permissions: ["swap:execute"],
    },
  });
  await assert.rejects(
    registry.execute("swap.solana.broadcast", "1.0.0", baseContext, input),
    (error: ToolRegistryError) => error.code === "TOOL_APPROVAL_REQUIRED",
  );
  assert.equal(gatewayCalls, 0);

  const intentDigest = "swap-intent-digest";
  const approvedContext = {
    ...baseContext,
    intentDigest,
    approval: {
      approvalId,
      actorId: "user-1",
      intentDigest,
      status: "consumed" as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recentAuthAt: new Date().toISOString(),
    },
  };
  const result = await registry.execute(
    "swap.solana.broadcast",
    "1.0.0",
    approvedContext,
    input,
  );
  assert.equal(result.status, "succeeded");
  assert.equal(gatewayCalls, 1);

  const contradictory = new ToolRegistry().register(
    createSolanaSwapBroadcastTool({
      async submitReservedSwap() {
        return {
          executionId,
          status: "reconciliation_required",
          txHash,
          providerAccepted: true,
          observedAt: new Date().toISOString(),
        };
      },
    }),
  );
  await assert.rejects(
    contradictory.execute(
      "swap.solana.broadcast",
      "1.0.0",
      approvedContext,
      input,
    ),
    (error: { code?: string }) =>
      error.code === "FINANCIAL_ADAPTER_ACCEPTANCE_MISMATCH",
  );
});

test("Asset Transfer financial Tool cannot execute before exact recent approval", async () => {
  let gatewayCalls = 0;
  const executionId = randomUUID();
  const approvalId = randomUUID();
  const txHash = bs58.encode(new Uint8Array(64).fill(11));
  const input = {
    executionId,
    approvalId,
    expectedStateVersion: 4,
    envelopeDigest: "c".repeat(64),
    txHash,
  };
  const tool = createAssetTransferBroadcastTool({
    async submitReservedTransfer(_context, submitted) {
      gatewayCalls += 1;
      assert.deepEqual(submitted, input);
      assert.equal("privateKey" in submitted, false);
      assert.equal("signedTransactionBase64" in submitted, false);
      return {
        executionId,
        status: "confirmed",
        txHash,
        providerAccepted: true,
        observedAt: new Date().toISOString(),
      };
    },
  });
  const registry = new ToolRegistry().register(tool);
  const baseContext = toolContext({
    actor: { actorId: "user-1", permissions: ["assets:transfer"] },
    policy: {
      profile: "financial-execution",
      permissions: ["assets:transfer"],
    },
  });
  await assert.rejects(
    registry.execute("assets.transfer.broadcast", "1.0.0", baseContext, input),
    (error: ToolRegistryError) => error.code === "TOOL_APPROVAL_REQUIRED",
  );
  assert.equal(gatewayCalls, 0);

  const intentDigest = "transfer-intent-digest";
  const result = await registry.execute(
    "assets.transfer.broadcast",
    "1.0.0",
    {
      ...baseContext,
      intentDigest,
      approval: {
        approvalId,
        actorId: "user-1",
        intentDigest,
        status: "consumed",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recentAuthAt: new Date().toISOString(),
      },
    },
    input,
  );
  assert.equal(result.status, "succeeded");
  assert.equal(gatewayCalls, 1);
  assert.equal(tool.definition.retryPolicy, "none");
  assert.equal(tool.definition.approvalPolicy, "explicit_and_recent_auth");
});

test("approval shadow binds actor and exact parameters without granting execution", async () => {
  const repository = new InMemoryApprovalShadowRepository();
  const recorder = new ApprovalShadowRecorder(repository);
  const base = {
    actorId: "user-1",
    action: "swap.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: "group-1",
    parameters: { amount: "1.25", side: "buy", token: "token-1" },
    status: "approved" as const,
    legacyConfirmationKind: "explicit_boolean",
  };
  const first = await recorder.record(base);
  const reordered = await recorder.record({
    ...base,
    parameters: { token: "token-1", side: "buy", amount: "1.25" },
  });
  assert.equal(first.intent.intentDigest, reordered.intent.intentDigest);
  assert.equal(repository.records.length, 1);
  const changed = await recorder.record({
    ...base,
    parameters: { amount: "1.26", side: "buy", token: "token-1" },
  });
  assert.notEqual(first.intent.intentDigest, changed.intent.intentDigest);
  assert.notEqual(
    first.intent.intentDigest,
    executionIntentDigest({ ...base, actorId: "user-2" }),
  );
  assert.equal(first.intent.risk, "financial_irreversible");
  assert.equal(first.schemaVersion, "agent.approval_shadow.v1");
  assert.equal("execute" in first, false);
  await assert.rejects(
    recorder.record({
      ...base,
      parameters: { privateKey: "must-not-be-recorded" },
    }),
    /secret-shaped field/,
  );
});

test("approval lifecycle binds actor, intent, expiry, recent auth, and single consumption", async () => {
  let currentTime = new Date("2026-08-09T12:00:00.000Z");
  const repository = new InMemoryApprovalLifecycleRepository();
  const lifecycle = new ApprovalLifecycle(repository, () => currentTime);
  const taskId = randomUUID();
  const toolCallId = randomUUID();
  const requested = await lifecycle.request({
    actorId: "user-1",
    taskId,
    toolCallId,
    action: "swap.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: "group-1",
    parameters: { amount: "1.25", side: "buy", token: "token-1" },
    policy: "explicit_and_recent_auth",
    idempotencyKey: "swap:test-request-1",
    ttlMs: 120_000,
  });
  assert.equal(requested.status, "requested");
  assert.equal(requested.stateVersion, 1);
  const replayed = await lifecycle.request({
    actorId: "user-1",
    taskId,
    toolCallId,
    action: "swap.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: "group-1",
    parameters: { token: "token-1", side: "buy", amount: "1.25" },
    policy: "explicit_and_recent_auth",
    idempotencyKey: "swap:test-request-1",
    ttlMs: 120_000,
  });
  assert.equal(replayed.approvalId, requested.approvalId);
  await assert.rejects(
    lifecycle.request({
      actorId: "user-1",
      taskId,
      toolCallId,
      action: "swap.broadcast",
      resourceType: "asset_wallet_group",
      resourceId: "group-1",
      parameters: { amount: "1.26", side: "buy", token: "token-1" },
      policy: "explicit_and_recent_auth",
      idempotencyKey: "swap:test-request-1",
      ttlMs: 120_000,
    }),
    (error: ApprovalLifecycleError) => error.code === "APPROVAL_IDEMPOTENCY_CONFLICT",
  );

  await assert.rejects(
    lifecycle.decide({
      approvalId: requested.approvalId,
      actorId: "user-2",
      decision: "approved",
      expectedStateVersion: 1,
      recentAuthAt: currentTime.toISOString(),
    }),
    (error: ApprovalLifecycleError) => error.code === "APPROVAL_ACTOR_MISMATCH",
  );
  await assert.rejects(
    lifecycle.decide({
      approvalId: requested.approvalId,
      actorId: "user-1",
      decision: "approved",
      expectedStateVersion: 1,
      recentAuthAt: new Date(currentTime.getTime() - 6 * 60_000).toISOString(),
    }),
    (error: ApprovalLifecycleError) => error.code === "APPROVAL_RECENT_AUTH_REQUIRED",
  );

  const approved = await lifecycle.decide({
    approvalId: requested.approvalId,
    actorId: "user-1",
    decision: "approved",
    expectedStateVersion: 1,
    recentAuthAt: currentTime.toISOString(),
  });
  assert.equal(approved.status, "approved");
  assert.equal(approved.stateVersion, 2);

  await assert.rejects(
    lifecycle.consume({
      approvalId: approved.approvalId,
      actorId: "user-1",
      intentDigest: executionIntentDigest({
        actorId: "user-1",
        action: "swap.broadcast",
        resourceType: "asset_wallet_group",
        resourceId: "group-1",
        parameters: { amount: "1.26", side: "buy", token: "token-1" },
      }),
      expectedStateVersion: 2,
    }),
    (error: ApprovalLifecycleError) => error.code === "APPROVAL_INTENT_MISMATCH",
  );

  const attempts = await Promise.allSettled([
    lifecycle.consume({
      approvalId: approved.approvalId,
      actorId: "user-1",
      intentDigest: approved.intent.intentDigest,
      expectedStateVersion: 2,
    }),
    lifecycle.consume({
      approvalId: approved.approvalId,
      actorId: "user-1",
      intentDigest: approved.intent.intentDigest,
      expectedStateVersion: 2,
    }),
  ]);
  assert.equal(attempts.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(attempts.filter(({ status }) => status === "rejected").length, 1);
  const consumed = attempts.find(({ status }) => status === "fulfilled");
  assert.equal(consumed && "value" in consumed ? consumed.value.status : undefined, "consumed");

  const expiring = await lifecycle.request({
    actorId: "user-1",
    taskId: randomUUID(),
    toolCallId: randomUUID(),
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: "draft-1",
    parameters: { message_hash: "abc" },
    policy: "explicit",
    idempotencyKey: "launch:test-request-1",
    ttlMs: 60_000,
  });
  currentTime = new Date(currentTime.getTime() + 60_001);
  await assert.rejects(
    lifecycle.decide({
      approvalId: expiring.approvalId,
      actorId: "user-1",
      decision: "approved",
      expectedStateVersion: 1,
    }),
    (error: ApprovalLifecycleError) => error.code === "APPROVAL_EXPIRED",
  );
});

test("financial tool start atomically binds task, tool call, and requested approval", async () => {
  const repository = new InMemoryFinancialToolStartRepository();
  const starter = new FinancialToolStarter(repository, () => new Date("2026-08-10T00:00:00.000Z"));
  const input = {
    actorId: randomUUID(),
    client: "go",
    capability: "launch.execute",
    taskType: "launch.execute",
    toolName: "launch.pump.broadcast",
    toolVersion: "1.0.0",
    action: "launch.pump",
    resourceType: "go_launch_draft",
    resourceId: randomUUID(),
    safeInput: {
      mintAddress: Keypair.generate().publicKey.toBase58(),
      messageHash: "a".repeat(64),
    },
    approvalParameters: {
      chain: "solana",
      network: "mainnet-beta",
      messageHash: "a".repeat(64),
      maxFeeAtomic: "10000",
    },
    contextRefs: [],
    policy: "explicit" as const,
    idempotencyKey: "pump:start:test-1",
    traceId: randomUUID(),
  };

  const first = await starter.begin(input);
  const replay = await starter.begin(input);
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.taskId, first.taskId);
  assert.equal(replay.toolCallId, first.toolCallId);
  assert.equal(replay.approval.approvalId, first.approval.approvalId);
  assert.equal(replay.approval.taskId, first.taskId);
  assert.equal(replay.approval.toolCallId, first.toolCallId);
  assert.equal(replay.approval.status, "requested");
  assert.equal(repository.records.length, 1);

  await assert.rejects(
    () => starter.begin({
      ...input,
      approvalParameters: { ...input.approvalParameters, maxFeeAtomic: "10001" },
    }),
    (error: any) => error instanceof FinancialToolStartError
      && error.code === "FINANCIAL_TOOL_IDEMPOTENCY_CONFLICT",
  );
});

test("execution reservation atomically consumes one task-bound approval and replays idempotently", async () => {
  const approvalRepository = new InMemoryApprovalLifecycleRepository();
  const approvalLifecycle = new ApprovalLifecycle(approvalRepository);
  const taskId = randomUUID();
  const toolCallId = randomUUID();
  const requested = await approvalLifecycle.request({
    actorId: "user-1",
    taskId,
    toolCallId,
    action: "swap.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: "group-1",
    parameters: { amount: "1.25", token: "token-1" },
    policy: "explicit",
    idempotencyKey: "approval:reserve-test-1",
  });
  const approved = await approvalLifecycle.decide({
    approvalId: requested.approvalId,
    actorId: "user-1",
    decision: "approved",
    expectedStateVersion: 1,
  });
  const repository = new InMemoryExecutionReservationRepository();
  repository.seedApproval(approved);
  const service = new ExecutionReservationService(repository);
  const reservationInput = {
    approvalId: approved.approvalId,
    approvalExpectedStateVersion: approved.stateVersion,
    taskExpectedStateVersion: 1,
    actorId: approved.actorId,
    intentId: approved.intent.intentId,
    intentDigest: approved.intent.intentDigest,
    taskId,
    toolCallId,
    action: approved.intent.action,
    resourceType: approved.intent.resourceType,
    resourceId: approved.intent.resourceId,
    idempotencyKey: "execution:reserve-test-1",
    provider: "jupiter",
    chain: "solana",
  };
  const attempts = await Promise.all([
    service.reserve(reservationInput),
    service.reserve(reservationInput),
  ]);
  assert.equal(attempts[0].reservation.executionId, attempts[1].reservation.executionId);
  assert.deepEqual(
    attempts.map(({ idempotentReplay }) => idempotentReplay).sort(),
    [false, true],
  );
  assert.equal(repository.approval(approved.approvalId)?.status, "consumed");
  assert.equal(repository.approval(approved.approvalId)?.stateVersion, 3);
  await assert.rejects(
    new ExecutionTransitionService(repository).transition({
      executionId: attempts[0].reservation.executionId,
      actorId: approved.actorId,
      expectedStatus: "reserved",
      expectedStateVersion: 1,
      status: "submission_pending",
      txHash: "derived-signature",
    }),
    (error: ExecutionTransitionError) => error.code === "EXECUTION_SEMANTICS_REQUIRED",
  );

  await assert.rejects(
    service.reserve({
      ...reservationInput,
      resourceId: "group-2",
    }),
    (error: ExecutionReservationError) => error.code === "EXECUTION_IDEMPOTENCY_CONFLICT",
  );
  await assert.rejects(
    service.reserve({
      ...reservationInput,
      idempotencyKey: "execution:reserve-test-2",
    }),
    (error: ExecutionReservationError) => error.code === "EXECUTION_APPROVAL_CONSUME_CONFLICT",
  );
});

test("verified wallet signature atomically approves and reserves without broadcasting", async () => {
  const approvalRepository = new InMemoryApprovalLifecycleRepository();
  const lifecycle = new ApprovalLifecycle(approvalRepository);
  const actorId = randomUUID();
  const taskId = randomUUID();
  const toolCallId = randomUUID();
  const draftId = randomUUID();
  const messageHash = "b".repeat(64);
  const signer = "1".repeat(32);
  const requested = await lifecycle.request({
    actorId,
    taskId,
    toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: draftId,
    parameters: { message_hash: messageHash, fee_payer: signer },
    policy: "explicit",
    idempotencyKey: "approval:wallet-signed-1",
  });
  const repository = new InMemoryExecutionReservationRepository();
  repository.seedApproval(requested);
  const service = new ExecutionReservationService(repository);
  const executionId = randomUUID();
  const reserved = await service.reserve({
    executionId,
    approvalId: requested.approvalId,
    approvalExpectedStateVersion: requested.stateVersion,
    taskExpectedStateVersion: 1,
    actorId,
    intentId: requested.intent.intentId,
    intentDigest: requested.intent.intentDigest,
    taskId,
    toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: draftId,
    idempotencyKey: "execution:wallet-signed-1",
    provider: "pump.fun",
    chain: "solana",
    walletSignatureConfirmation: {
      schemaVersion: "agent.wallet_signature_confirmation.v1",
      messageHash,
      txSignature: "2".repeat(88),
      signer,
      verifiedAt: new Date().toISOString(),
    },
  });
  assert.equal(reserved.reservation.executionId, executionId);
  assert.equal(reserved.reservation.status, "reserved");
  assert.equal(repository.approval(requested.approvalId)?.status, "consumed");
  assert.equal(repository.approval(requested.approvalId)?.stateVersion, 3);
});

test("execution transitions preserve unknown chain outcomes and protect terminal state", async () => {
  const approvalRepository = new InMemoryApprovalLifecycleRepository();
  const approvalLifecycle = new ApprovalLifecycle(approvalRepository);
  const taskId = randomUUID();
  const toolCallId = randomUUID();
  const requested = await approvalLifecycle.request({
    actorId: "user-1",
    taskId,
    toolCallId,
    action: "swap.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: "group-1",
    parameters: { amount: "1.25", token: "token-1" },
    policy: "explicit",
    idempotencyKey: "approval:transition-test-1",
  });
  const approved = await approvalLifecycle.decide({
    approvalId: requested.approvalId,
    actorId: "user-1",
    decision: "approved",
    expectedStateVersion: 1,
  });
  const repository = new InMemoryExecutionReservationRepository();
  repository.seedApproval(approved);
  const reservation = await new ExecutionReservationService(repository).reserve({
    approvalId: approved.approvalId,
    approvalExpectedStateVersion: approved.stateVersion,
    taskExpectedStateVersion: 1,
    actorId: approved.actorId,
    intentId: approved.intent.intentId,
    intentDigest: approved.intent.intentDigest,
    taskId,
    toolCallId,
    action: approved.intent.action,
    resourceType: approved.intent.resourceType,
    resourceId: approved.intent.resourceId,
    idempotencyKey: "execution:transition-test-1",
    provider: "jupiter",
    chain: "solana",
  });
  const semanticCreatedAt = new Date();
  const semanticUnsigned: Omit<ApprovedExecutionEnvelope, "envelopeDigest"> = {
    schemaVersion: "agent.execution_envelope.v1",
    executionId: reservation.reservation.executionId,
    actorId: reservation.reservation.actorId,
    intentDigest: reservation.reservation.intentDigest,
    action: reservation.reservation.action,
    chain: { kind: "solana", network: "mainnet-beta" },
    transactions: [{
      transactionId: "swap-1",
      signer: "payer-solana",
      messageHash: "f".repeat(64),
      valueAtomic: "1",
      programIds: ["jupiter-program"],
      recipients: [{ address: "recipient", assetId: "mint", amountAtomic: "1" }],
      maxSlippageBps: 300,
      maxFeeAtomic: "10000",
      lastValidBlockHeight: 100,
    }],
    createdAt: semanticCreatedAt.toISOString(),
    expiresAt: new Date(semanticCreatedAt.getTime() + 60_000).toISOString(),
  };
  const semanticEnvelope: ApprovedExecutionEnvelope = {
    ...semanticUnsigned,
    envelopeDigest: executionEnvelopeDigest(semanticUnsigned),
  };
  const bound = await new ExecutionSemanticEnvelopeService(repository).verifyAndBind({
    envelope: semanticEnvelope,
    expectedStateVersion: 1,
    inspections: [{
      schemaVersion: "agent.transaction_inspection.v1",
      executionId: reservation.reservation.executionId,
      transactionId: "swap-1",
      chain: { kind: "solana", network: "mainnet-beta" },
      signer: "payer-solana",
      messageHash: "f".repeat(64),
      valueAtomic: "1",
      programIds: ["jupiter-program"],
      recipients: [{ address: "recipient", assetId: "mint", amountAtomic: "1" }],
      slippageBps: 300,
      estimatedFeeAtomic: "5000",
      currentBlockHeight: 99,
      observedAt: semanticCreatedAt.toISOString(),
    }],
  });
  assert.equal(bound.stateVersion, 2);
  assert.equal(bound.semanticEnvelope?.envelopeDigest, semanticEnvelope.envelopeDigest);
  const transitions = new ExecutionTransitionService(repository);

  await assert.rejects(
    transitions.transition({
      executionId: reservation.reservation.executionId,
      actorId: "user-1",
      expectedStatus: "reserved",
      expectedStateVersion: 2,
      status: "submission_pending",
    }),
    (error: ExecutionTransitionError) => error.code === "EXECUTION_TX_HASH_REQUIRED",
  );

  assert.equal(canTransitionExecution("reserved", "submitted"), false);
  assert.equal(canTransitionExecution("submission_pending", "reconciliation_required"), true);
  const submissionPending = await transitions.transition({
    executionId: reservation.reservation.executionId,
    actorId: "user-1",
    expectedStatus: "reserved",
    expectedStateVersion: 2,
    status: "submission_pending",
    txHash: "derived-signature-before-broadcast",
  });
  assert.equal(submissionPending.status, "submission_pending");
  assert.equal(submissionPending.stateVersion, 3);
  assert.equal(submissionPending.submittedAt, undefined);

  const accepted = await new ExecutionReconciler(repository, [{
    name: "jupiter",
    async observe({ execution }) {
      return {
        txHash: execution.txHash!,
        status: "pending" as const,
        observedAt: new Date().toISOString(),
      };
    },
  }]).reconcile({
    executionId: submissionPending.executionId,
    actorId: "user-1",
  });
  const submitted = accepted.execution;
  assert.equal(accepted.observation?.status, "pending");
  assert.equal(accepted.changed, true);
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.stateVersion, 4);
  assert.equal(submitted.txHash, "derived-signature-before-broadcast");
  assert.ok(submitted.submittedAt);

  await assert.rejects(
    transitions.transition({
      executionId: submitted.executionId,
      actorId: "user-1",
      expectedStatus: "submitted",
      expectedStateVersion: 3,
      status: "reconciliation_required",
    }),
    (error: ExecutionTransitionError) => error.code === "EXECUTION_STATE_CONFLICT",
  );
  await assert.rejects(
    transitions.transition({
      executionId: submitted.executionId,
      actorId: "user-1",
      expectedStatus: "submitted",
      expectedStateVersion: 4,
      status: "reconciliation_required",
      txHash: "different-signature",
    }),
    (error: ExecutionTransitionError) => error.code === "EXECUTION_TX_HASH_IMMUTABLE",
  );

  const unknownResult = await new ExecutionReconciler(repository, [{
    name: "jupiter",
    async observe({ execution }) {
      return {
        txHash: execution.txHash!,
        status: "unknown" as const,
        observedAt: new Date().toISOString(),
      };
    },
  }]).reconcile({
    executionId: submitted.executionId,
    actorId: "user-1",
  });
  const unknown = unknownResult.execution;
  assert.equal(unknown.status, "reconciliation_required");
  assert.equal(unknown.stateVersion, 5);
  assert.equal(unknown.txHash, submitted.txHash);

  const confirmed = await transitions.transition({
    executionId: unknown.executionId,
    actorId: "user-1",
    expectedStatus: "reconciliation_required",
    expectedStateVersion: 5,
    status: "confirmed",
  });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.stateVersion, 6);
  assert.ok(confirmed.completedAt);

  await assert.rejects(
    transitions.transition({
      executionId: confirmed.executionId,
      actorId: "user-1",
      expectedStatus: "confirmed",
      expectedStateVersion: 6,
      status: "failed",
      failure: { code: "CHAIN_REJECTED" },
    }),
    (error: ExecutionTransitionError) => error.code === "EXECUTION_TERMINAL_STATE",
  );
});

test("failed execution requires a stable failure code", async () => {
  const repository = new InMemoryExecutionReservationRepository();
  const transitions = new ExecutionTransitionService(repository);
  await assert.rejects(
    transitions.transition({
      executionId: randomUUID(),
      actorId: "user-1",
      expectedStatus: "reserved",
      expectedStateVersion: 1,
      status: "failed",
    }),
    (error: ExecutionTransitionError) => error.code === "EXECUTION_FAILURE_REQUIRED",
  );
});

test("semantic verifier binds complete Solana transaction meaning and limits", () => {
  const executionId = randomUUID();
  const actorId = randomUUID();
  const intentDigest = "a".repeat(64);
  const messageHash = "b".repeat(64);
  const createdAt = "2026-08-09T12:00:00.000Z";
  const unsignedEnvelope: Omit<ApprovedExecutionEnvelope, "envelopeDigest"> = {
    schemaVersion: "agent.execution_envelope.v1",
    executionId,
    actorId,
    intentDigest,
    action: "swap.broadcast",
    chain: { kind: "solana", network: "mainnet-beta" },
    transactions: [{
      transactionId: "swap-1",
      signer: "payer-solana",
      messageHash,
      valueAtomic: "1250000000",
      programIds: ["jupiter-program", "token-program"],
      recipients: [{
        address: "recipient-solana",
        assetId: "mint-solana",
        amountAtomic: "5000000",
      }],
      maxSlippageBps: 300,
      maxFeeAtomic: "10000",
      lastValidBlockHeight: 12345,
    }],
    createdAt,
    expiresAt: "2026-08-09T12:05:00.000Z",
  };
  const envelope: ApprovedExecutionEnvelope = {
    ...unsignedEnvelope,
    envelopeDigest: executionEnvelopeDigest(unsignedEnvelope),
  };
  const inspection: TransactionInspection = {
    schemaVersion: "agent.transaction_inspection.v1",
    executionId,
    transactionId: "swap-1",
    chain: { kind: "solana", network: "mainnet-beta" },
    signer: "payer-solana",
    messageHash,
    valueAtomic: "1250000000",
    programIds: ["token-program", "jupiter-program"],
    recipients: [{
      address: "recipient-solana",
      assetId: "mint-solana",
      amountAtomic: "5000000",
    }],
    slippageBps: 250,
    estimatedFeeAtomic: "5000",
    currentBlockHeight: 12340,
    observedAt: "2026-08-09T12:01:00.000Z",
  };
  const verify = (actual: TransactionInspection = inspection) =>
    verifyExecutionSemantics({
      envelope,
      inspections: [actual],
      binding: { executionId, actorId, intentDigest, action: "swap.broadcast" },
      now: new Date("2026-08-09T12:01:00.000Z"),
    });

  assert.doesNotThrow(() => verify());
  const failures: Array<[Partial<TransactionInspection>, string]> = [
    [{ signer: "attacker" }, "EXECUTION_SIGNER_MISMATCH"],
    [{ programIds: [...inspection.programIds, "attacker-program"] }, "EXECUTION_PROGRAM_MISMATCH"],
    [{
      recipients: [{
        ...inspection.recipients[0],
        amountAtomic: "5000001",
      }],
    }, "EXECUTION_RECIPIENT_MISMATCH"],
    [{ slippageBps: 301 }, "EXECUTION_SLIPPAGE_EXCEEDED"],
    [{ estimatedFeeAtomic: "10001" }, "EXECUTION_FEE_EXCEEDED"],
    [{ currentBlockHeight: 12346 }, "EXECUTION_TRANSACTION_EXPIRED"],
  ];
  for (const [patch, code] of failures) {
    assert.throws(
      () => verify({ ...inspection, ...patch }),
      (error: SemanticVerificationError) => error.code === code,
    );
  }
});

test("semantic verifier rejects EVM call drift, binding drift, and expired envelopes", async () => {
  const executionId = randomUUID();
  const actorId = randomUUID();
  const intentDigest = "c".repeat(64);
  const unsignedEnvelope: Omit<ApprovedExecutionEnvelope, "envelopeDigest"> = {
    schemaVersion: "agent.execution_envelope.v1",
    executionId,
    actorId,
    intentDigest,
    action: "launch.broadcast",
    chain: { kind: "evm", network: "bsc", chainId: 56 },
    transactions: [{
      transactionId: "launch-1",
      signer: "0x1111111111111111111111111111111111111111",
      messageHash: "d".repeat(64),
      destination: "0x2222222222222222222222222222222222222222",
      valueAtomic: "100000000000000000",
      dataHash: "e".repeat(64),
      nonce: "7",
      programIds: [],
      recipients: [{
        address: "0x3333333333333333333333333333333333333333",
        assetId: "BNB",
        amountAtomic: "100000000000000000",
      }],
      maxSlippageBps: 500,
      maxFeeAtomic: "1000000000000000",
      validUntil: "2026-08-09T12:04:00.000Z",
    }],
    createdAt: "2026-08-09T12:00:00.000Z",
    expiresAt: "2026-08-09T12:05:00.000Z",
  };
  const envelope: ApprovedExecutionEnvelope = {
    ...unsignedEnvelope,
    envelopeDigest: executionEnvelopeDigest(unsignedEnvelope),
  };
  const inspection: TransactionInspection = {
    schemaVersion: "agent.transaction_inspection.v1",
    executionId,
    transactionId: "launch-1",
    chain: { kind: "evm", network: "bsc", chainId: 56 },
    signer: "0x1111111111111111111111111111111111111111".toUpperCase(),
    messageHash: "d".repeat(64),
    destination: "0x2222222222222222222222222222222222222222",
    valueAtomic: "100000000000000000",
    dataHash: "e".repeat(64),
    nonce: "7",
    programIds: [],
    recipients: [{
      address: "0x3333333333333333333333333333333333333333",
      assetId: "BNB",
      amountAtomic: "100000000000000000",
    }],
    slippageBps: 500,
    estimatedFeeAtomic: "500000000000000",
    observedAt: "2026-08-09T12:01:00.000Z",
  };
  const binding = { executionId, actorId, intentDigest, action: "launch.broadcast" };

  assert.doesNotThrow(() =>
    verifyExecutionSemantics({
      envelope,
      inspections: [inspection],
      binding,
      now: new Date("2026-08-09T12:01:00.000Z"),
    }));
  const shadowRepository = new InMemorySemanticShadowRepository();
  const shadowRecorder = new ExecutionSemanticShadowRecorder(
    shadowRepository,
    () => new Date("2026-08-09T12:01:00.000Z"),
  );
  const shadowInput = {
    actorId: envelope.actorId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: randomUUID(),
    envelope,
    inspections: [inspection],
  };
  const shadow = await shadowRecorder.record(shadowInput);
  const replayedShadow = await shadowRecorder.record(shadowInput);
  assert.equal(shadow.shadowMode, true);
  assert.equal(replayedShadow.shadowId, shadow.shadowId);
  assert.equal(shadowRepository.records.length, 1);
  assert.equal("execute" in shadow, false);
  assert.throws(
    () => verifyExecutionSemantics({
      envelope,
      inspections: [{ ...inspection, destination: "0x4444444444444444444444444444444444444444" }],
      binding,
      now: new Date("2026-08-09T12:01:00.000Z"),
    }),
    (error: SemanticVerificationError) => error.code === "EXECUTION_CALL_MISMATCH",
  );
  assert.throws(
    () => verifyExecutionSemantics({
      envelope,
      inspections: [inspection],
      binding: { ...binding, actorId: randomUUID() },
      now: new Date("2026-08-09T12:01:00.000Z"),
    }),
    (error: SemanticVerificationError) => error.code === "EXECUTION_ENVELOPE_BINDING_MISMATCH",
  );
  assert.throws(
    () => verifyExecutionSemantics({
      envelope,
      inspections: [inspection],
      binding,
      now: new Date("2026-08-09T12:05:00.000Z"),
    }),
    (error: SemanticVerificationError) => error.code === "EXECUTION_ENVELOPE_EXPIRED",
  );
});

test("trusted Pump inspector decodes createV2 and developer-buy semantics", async () => {
  const payer = Keypair.generate();
  const mint = Keypair.generate();
  const feeRecipient = Keypair.generate().publicKey;
  const developerBuyLamports = "1000000";
  const name = "Runtime Pump";
  const symbol = "RTP";
  const metadataUri = "https://example.com/runtime-pump.json";
  const instructions = await PUMP_SDK.createV2AndBuyInstructions({
    global: { feeRecipient, feeRecipients: [] } as any,
    mint: mint.publicKey,
    name,
    symbol,
    uri: metadataUri,
    creator: payer.publicKey,
    user: payer.publicKey,
    amount: new BN("500000"),
    solAmount: new BN(developerBuyLamports),
    mayhemMode: false,
    cashback: false,
  });
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(...instructions);
  transaction.partialSign(mint);
  const executionId = randomUUID();
  const observedAt = "2026-08-09T12:00:30.000Z";
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString("base64");
  const inspection = inspectPreparedPumpLaunch({
    executionId,
    transactionId: "pump-launch-1",
    transactionBase64: serialized,
    feePayer: payer.publicKey.toBase58(),
    mintAddress: mint.publicKey.toBase58(),
    name,
    symbol,
    metadataUri,
    creator: payer.publicKey.toBase58(),
    developerBuyLamports,
    estimatedFeeAtomic: "5000",
    currentBlockHeight: 90,
    observedAt,
  });
  assert.equal(inspection.operation?.kind, "pump.launch");
  assert.equal(inspection.operation?.developerBuyLamports, developerBuyLamports);
  assert.equal(inspection.valueAtomic, "1010000");
  assert.equal(inspection.slippageBps, 100);
  assert.deepEqual(
    new Set(inspection.programIds),
    new Set([
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    ]),
  );

  const intentDigest = "7".repeat(64);
  const envelope = buildApprovedPumpLaunchEnvelope({
    inspection,
    actorId: randomUUID(),
    intentDigest,
    maxFeeAtomic: "10000",
    lastValidBlockHeight: 100,
    createdAt: "2026-08-09T12:00:00.000Z",
    expiresAt: "2026-08-09T12:05:00.000Z",
  });
  const binding = {
    executionId,
    actorId: envelope.actorId,
    intentDigest,
    action: "launch.broadcast",
  };
  assert.doesNotThrow(() =>
    verifyExecutionSemantics({
      envelope,
      inspections: [inspection],
      binding,
      now: new Date("2026-08-09T12:01:00.000Z"),
    }));
  assert.throws(
    () => verifyExecutionSemantics({
      envelope,
      inspections: [{
        ...inspection,
        operation: {
          ...inspection.operation!,
          developerBuyLamports: "1000001",
        },
      }],
      binding,
      now: new Date("2026-08-09T12:01:00.000Z"),
    }),
    (error: SemanticVerificationError) => error.code === "EXECUTION_OPERATION_MISMATCH",
  );
  assert.throws(
    () => inspectPreparedPumpLaunch({
      executionId,
      transactionId: "pump-launch-1",
      transactionBase64: serialized,
      feePayer: payer.publicKey.toBase58(),
      mintAddress: mint.publicKey.toBase58(),
      name: "Attacker Name",
      symbol,
      metadataUri,
      creator: payer.publicKey.toBase58(),
      developerBuyLamports,
      estimatedFeeAtomic: "5000",
      currentBlockHeight: 90,
      observedAt,
    }),
    (error: PumpLaunchInspectionError) =>
      error.code === "PUMP_CREATE_SEMANTICS_MISMATCH",
  );
});

test("legacy Assets read tool derives ownership from the runtime actor", async () => {
  let observedOwner = "";
  const registry = createLegacyReadToolRegistry({
    walletGroupRepository: {
      async listGroups(ownerUserId) {
        observedOwner = ownerUserId;
        return [{ groupId: "group-1", name: "Cooking", network: "solana" }];
      },
    },
  });
  const result = await registry.execute<Record<string, never>, { groups: unknown[] }>(
    "assets.wallet_groups.list",
    "1.0.0",
    toolContext(),
    {},
  );
  assert.equal(observedOwner, "user-1");
  assert.equal(result.status, "succeeded");
  if (result.status === "succeeded") assert.equal(result.data.groups.length, 1);
});

test("ModelGateway swaps providers without changing the request contract", async () => {
  const provider = (id: string, label: string): ModelProvider => ({
    id,
    capabilities: {
      structuredOutput: true,
      toolCalling: false,
      streaming: false,
      vision: false,
    },
    async generate(request) {
      return {
        provider: id,
        model: label,
        structuredOutput: { answer: `${label}:${request.operation}` },
        finishReason: "stop",
      };
    },
    async health() {
      return { ok: true, configured: true };
    },
  });
  const gateway = new ModelGateway()
    .register(provider("glm", "glm-model"))
    .register(provider("gpt", "gpt-model"));
  const request = {
    requestId: randomUUID(),
    operation: "agent.reply",
    responseSchema: {
      type: "object",
      required: ["answer"],
      additionalProperties: false,
      properties: { answer: { type: "string" } },
    },
    metadata: {
      taskId: randomUUID(),
      locale: "zh-CN",
      policyProfile: "default",
    },
  };
  const glm = await gateway.generate("glm", request);
  const gpt = await gateway.generate("gpt", request);
  assert.equal((glm.structuredOutput as { answer: string }).answer, "glm-model:agent.reply");
  assert.equal((gpt.structuredOutput as { answer: string }).answer, "gpt-model:agent.reply");
});

test("Model policy router allows only registered providers from the Agent version", async () => {
  const provider = (id: string): ModelProvider => ({
    id,
    capabilities: {
      structuredOutput: true,
      toolCalling: false,
      streaming: false,
      vision: false,
    },
    async generate() {
      return {
        provider: id,
        model: `${id}-model`,
        structuredOutput: { content: id, suggestion: "safe" },
        finishReason: "stop",
      };
    },
    async health() {
      return { ok: true, configured: true };
    },
  });
  const router = new ModelPolicyRouter(
    new ModelGateway()
      .register(provider("openai-compatible"))
      .register(provider("glm")),
  );
  const policy = {
    allowedProviders: ["openai-compatible", "glm", "claude"],
    defaultProvider: "openai-compatible",
  };
  assert.equal(router.select(policy), "openai-compatible");
  assert.equal(router.select(policy, "glm"), "glm");
  assert.throws(
    () => router.select(policy, "gpt"),
    (error: any) => error.code === "MODEL_PROVIDER_NOT_ALLOWED",
  );
  assert.throws(
    () => router.select(policy, "claude"),
    (error: any) => error.code === "MODEL_PROVIDER_NOT_REGISTERED",
  );
});

test("LegacyRuntimeFacade preserves current runtime behavior behind the v2 task contract", async () => {
  const conversationId = randomUUID();
  const taskId = randomUUID();
  const facade = new LegacyRuntimeFacade({
    async createConversation() {
      return { conversationId, channel: "web", messages: [] };
    },
    async getConversation(id) {
      return id === conversationId ? { conversationId, channel: "web", messages: [] } : null;
    },
    async handleMessage() {
      return {
        conversation_id: conversationId,
        task_id: taskId,
        status: "succeeded",
        task: {
          taskId,
          type: "market.trending",
          status: "succeeded",
          progress: 100,
          result: { card: { type: "market_trending", data: {} } },
        },
      };
    },
    async getTask(id) {
      return id === taskId ? {
        taskId,
        conversationId,
        type: "market.trending",
        status: "succeeded",
        progress: 100,
      } : null;
    },
  });
  const task = await facade.submit({
    requestId: randomUUID(),
    actor: { actorId: "user-1", permissions: ["market:read"] },
    client: "go",
    message: "/market-trending solana",
    idempotencyKey: `go:${randomUUID()}`,
    locale: "zh-CN",
  });
  assert.equal(task.schemaVersion, "agent.task.v2");
  assert.equal(task.taskId, taskId);
  assert.equal(task.capability, "market.trending");
  assert.equal(task.actorId, "user-1");
  assert.equal(await facade.getTask({ actorId: "other-user" }, taskId), null);
  assert.equal((await facade.getTask({ actorId: "user-1" }, taskId))?.status, "succeeded");
});

test("ContextResolver resolves Pulse and Assets refs with actor-scoped safe projections", async () => {
  const observedActors: string[] = [];
  const resolver = new ContextResolver([
    new PulseSnapshotContextProvider({
      async getOwnedSnapshot(snapshotId, actorId) {
        observedActors.push(actorId);
        if (actorId !== "user-1") return null;
        return {
          snapshot_id: snapshotId,
          user_id: actorId,
          narrative_id: "narrative-1",
          category: "internet_culture",
          platform: "x",
          source_type: "social",
          author_name: "Author",
          original_text: "A public narrative",
          source_url: "https://example.com/source",
          media_type: "image",
          media_urls: ["https://example.com/image.png"],
          source_published_at: "2026-08-09T00:00:00.000Z",
          source_expires_at: "2026-08-10T00:00:00.000Z",
          created_at: "2026-08-09T01:00:00.000Z",
        };
      },
    }),
    new AssetsWalletGroupContextProvider({
      async listGroups(actorId) {
        observedActors.push(actorId);
        return actorId === "user-1"
          ? [{ groupId: "group-1", name: "Cooking", purpose: "cooking", network: "solana", walletCount: 1 }]
          : [];
      },
      async listWallets(groupId, actorId) {
        observedActors.push(actorId);
        return groupId === "group-1" && actorId === "user-1"
          ? [{
              walletId: "wallet-1",
              groupId,
              publicAddress: "11111111111111111111111111111111",
              provisioningStatus: "active",
            }]
          : [];
      },
    }),
  ]);
  const envelope = await resolver.resolve({
    actor: {
      actorId: "user-1",
      permissions: ["pulse:read", "assets:read"],
    },
    client: "go",
    conversationId: randomUUID(),
    refs: [
      { kind: "pulse.narrative_snapshot", id: randomUUID() },
      { kind: "assets.wallet_group", id: "group-1" },
    ],
  });
  assert.equal(envelope.schemaVersion, "agent.context.v1");
  assert.deepEqual(resolver.kinds(), ["assets.wallet_group", "pulse.narrative_snapshot"]);
  assert.equal(envelope.refs.length, 2);
  assert.ok(envelope.refs.every((ref) => /^[a-f0-9]{64}$/.test(String(ref.digest))));
  assert.ok(observedActors.every((actorId) => actorId === "user-1"));
  assert.doesNotMatch(JSON.stringify(envelope.safeModelContext), /private.?key|seed.?phrase/i);
});

test("ContextResolver fails closed for cross-user resources, digest drift, and unsafe provider output", async () => {
  const crossUser = new ContextResolver([
    new AssetsWalletGroupContextProvider({
      async listGroups() {
        return [];
      },
      async listWallets() {
        return [];
      },
    }),
  ]);
  await assert.rejects(
    crossUser.resolve({
      actor: { actorId: "other-user", permissions: ["assets:read"] },
      client: "assets",
      conversationId: randomUUID(),
      refs: [{ kind: "assets.wallet_group", id: "group-1" }],
    }),
    (error: ContextResolutionError) => error.code === "ASSETS_WALLET_GROUP_NOT_FOUND",
  );

  const unsafe = new ContextResolver([{
    kind: "agent.artifact",
    async resolve(_actor, ref) {
      return {
        ...ref,
        digest: "a".repeat(64),
        safeData: { privateKey: "forbidden" },
        resolvedAt: new Date().toISOString(),
      };
    },
  }]);
  await assert.rejects(
    unsafe.resolve({
      actor: { actorId: "user-1", permissions: [] },
      client: "api",
      conversationId: randomUUID(),
      refs: [{ kind: "agent.artifact", id: "artifact-1" }],
    }),
    (error: ContextResolutionError) => error.code === "CONTEXT_SECRET_FIELD_REJECTED",
  );

  const drifted = new ContextResolver([{
    kind: "agent.artifact",
    async resolve(_actor, ref) {
      return {
        ...ref,
        digest: "b".repeat(64),
        safeData: { title: "safe" },
        resolvedAt: new Date().toISOString(),
      };
    },
  }]);
  await assert.rejects(
    drifted.resolve({
      actor: { actorId: "user-1", permissions: [] },
      client: "api",
      conversationId: randomUUID(),
      refs: [{ kind: "agent.artifact", id: "artifact-1", digest: "c".repeat(64) }],
    }),
    (error: ContextResolutionError) => error.code === "CONTEXT_DIGEST_MISMATCH",
  );
});

test("conversation validation accepts only fixed, unique context references", () => {
  const snapshotId = randomUUID();
  const validated = validateConversationMessage({
    message: "Analyze this source",
    context: {
      language: "en",
      currentView: "pulse",
      contextRefs: [{ kind: "pulse.narrative_snapshot", id: snapshotId }],
    },
  });
  assert.deepEqual(validated.context.contextRefs, [{
    kind: "pulse.narrative_snapshot",
    id: snapshotId,
    version: undefined,
    digest: undefined,
  }]);
  assert.throws(
    () => validateConversationMessage({
      message: "Analyze",
      context: {
        contextRefs: [
          { kind: "assets.wallet_group", id: "group-1" },
          { kind: "assets.wallet_group", id: "group-1" },
        ],
      },
    }),
    /Duplicate context ref/,
  );
  assert.throws(
    () => validateConversationMessage({
      message: "Analyze",
      context: { contextRefs: [{ kind: "database.raw", id: "row-1" }] },
    }),
    /Unsupported context ref kind/,
  );
});

test("current Agent runtime resolves private refs before exposing model-safe context", async () => {
  let resolverActor = "";
  const runtime = createAgentRuntime({
    stepDelayMs: 1,
    contextResolver: new ContextResolver([{
      kind: "agent.artifact",
      async resolve(actor, ref) {
        resolverActor = actor.actorId;
        return {
          ...ref,
          digest: "d".repeat(64),
          safeData: { title: "Safe artifact" },
          resolvedAt: new Date().toISOString(),
        };
      },
    }]),
  });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "Summarize the selected artifact",
    context: {
      language: "en",
      currentView: "go",
      userId: "user-1",
      contextRefs: [{ kind: "agent.artifact", id: "artifact-1" }],
    },
    wait: true,
    timeoutMs: 3_000,
  });
  assert.equal(resolverActor, "user-1");
  assert.equal(result.status, "succeeded");
  assert.equal(result.task.result.context.sources[0].data.title, "Safe artifact");

  await assert.rejects(
    runtime.handleMessage({
      channel: "web",
      message: "Summarize",
      context: {
        language: "en",
        currentView: "go",
        contextRefs: [{ kind: "agent.artifact", id: "artifact-1" }],
      },
      wait: true,
    }),
    (error: any) => error.code === "CONTEXT_AUTHENTICATION_REQUIRED",
  );
});

test("current Agent runtime executes Pulse reads through the fixed Tool Registry", async () => {
  let observedContext: any = null;
  const runtime = createAgentRuntime({
    stepDelayMs: 1,
    toolRegistry: {
      async execute(name: string, version: string, context: any, input: any) {
        assert.equal(name, "pulse.narratives.list");
        assert.equal(version, "1.0.0");
        assert.equal(input.limit, 12);
        observedContext = context;
        return {
          status: "succeeded",
          data: {
            narratives: [{
              narrative_id: "narrative-1",
              original_text: "Runtime-owned Pulse evidence",
              source_url: "https://example.com/evidence",
              category: "ai",
              platform: "x",
            }],
          },
        };
      },
    },
  });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "/narrative ai",
    command: "/narrative ai",
    context: {
      userId: "user-1",
      language: "en",
      currentView: "go",
    },
    wait: true,
    timeoutMs: 3_000,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(observedContext.actor.actorId, "user-1");
  assert.deepEqual(observedContext.policy.permissions, ["pulse:read"]);
  assert.deepEqual(result.task.result.tool, {
    name: "pulse.narratives.list",
    version: "1.0.0",
  });
  assert.equal(result.task.result.recommendations[0].narrative_id, "narrative-1");
});

test("current Agent runtime executes filtered GMGN reads through immutable Tool v2", async () => {
  let observedContext: any = null;
  const runtime = createAgentRuntime({
    stepDelayMs: 1,
    toolRegistry: {
      async execute(name: string, version: string, context: any, input: any) {
        assert.equal(name, "market.gmgn.trending");
        assert.equal(version, "2.0.0");
        assert.equal(input.chain, "solana");
        assert.equal(input.orderBy, "volume");
        observedContext = context;
        return {
          status: "succeeded",
          data: {
            status: "live",
            source: "gmgn",
            data: [{ symbol: "NARRA" }],
          },
        };
      },
    },
  });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "/market-trending solana",
    command: "/market-trending solana",
    context: {
      userId: "user-1",
      language: "en",
      currentView: "go",
    },
    wait: true,
    timeoutMs: 3_000,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(observedContext.actor.actorId, "user-1");
  assert.deepEqual(observedContext.policy.permissions, ["market:read"]);
  assert.deepEqual(result.task.result.tool, {
    name: "market.gmgn.trending",
    version: "2.0.0",
  });
  assert.equal(result.task.result.data_source, "gmgn");
});

test("public-link narrative reads execute through the published research Tool", async () => {
  let observedContext: any = null;
  const handlers = createAgentHandlers({}, {
    toolRegistry: {
      async execute(name: string, version: string, context: any, input: any) {
        assert.equal(name, "research.public_link.read");
        assert.equal(version, "1.0.0");
        assert.equal(input.url, "https://example.com/source");
        observedContext = context;
        return {
          status: "succeeded",
          data: {
            status: "live",
            url: input.url,
            title: "Runtime-owned public evidence",
            summary: "Bounded source summary",
          },
        };
      },
    },
  });
  const result = await handlers["narrative.scan"](
    { source_url: "https://example.com/source" },
    {
      requestId: "request-1",
      taskId: "task-1",
      userId: "user-1",
      emitEvent() {},
    },
  );
  assert.equal(observedContext.actor.actorId, "user-1");
  assert.deepEqual(observedContext.policy.permissions, ["research:read"]);
  assert.deepEqual(result.tool, {
    name: "research.public_link.read",
    version: "1.0.0",
  });
  assert.equal(result.signals[0].title, "Runtime-owned public evidence");
});

test("trade planning resolves actor-owned wallet groups through the Assets Tool", async () => {
  let observedContext: any = null;
  const handlers = createAgentHandlers({}, {
    toolRegistry: {
      async execute(name: string, version: string, context: any, input: any) {
        assert.equal(name, "assets.wallet_groups.list");
        assert.equal(version, "1.0.0");
        assert.deepEqual(input, {});
        observedContext = context;
        return {
          status: "succeeded",
          data: {
            groups: [{
              groupId: "group-1",
              name: "Alpha",
              purpose: "general",
              network: "solana",
            }],
          },
        };
      },
    },
    walletGroupRepository: {
      async listGroups() {
        throw new Error("Direct wallet-group listing should not be used");
      },
      async listWallets(groupId: string, actorId: string) {
        assert.equal(groupId, "group-1");
        assert.equal(actorId, "user-1");
        return [{
          walletId: "wallet-1",
          groupId,
          publicAddress: "11111111111111111111111111111111",
          provisioningStatus: "active",
        }];
      },
    },
  });
  const result = await handlers["trade.buy.batch"](
    {
      prompt: "/buy So11111111111111111111111111111111111111112 1 SOL wallet group Alpha",
    },
    {
      requestId: "request-1",
      taskId: "task-1",
      conversationId: "conversation-1",
      userId: "user-1",
      emitEvent() {},
    },
  );
  assert.equal(observedContext.actor.actorId, "user-1");
  assert.deepEqual(observedContext.policy.permissions, ["assets:read"]);
  assert.deepEqual(result.wallet_context_tool, {
    name: "assets.wallet_groups.list",
    version: "1.0.0",
  });
  assert.equal(result.wallet_group_id, "group-1");
  assert.equal(result.accounts, 1);
  assert.deepEqual(result.missing, []);
  assert.equal(result.status, "requires_user_confirmation");
});

test("current Agent runtime exposes only bounded knowledge metadata", async () => {
  let modelPolicyObserved = false;
  const runtime = createAgentRuntime({
    stepDelayMs: 1,
    modelPolicyRouter: {
      async generate(policy: any) {
        modelPolicyObserved = true;
        assert.equal(policy.defaultProvider, "openai-compatible");
        return {
          provider: "openai-compatible",
          model: "policy-test-model",
          structuredOutput: {
            content: "Provider-neutral response.",
            suggestion: "Continue safely.",
          },
          finishReason: "stop",
        };
      },
    },
    runtimeKnowledgeResolver: {
      async resolve(actorId: string) {
        assert.equal(actorId, "user-1");
        return {
          manifest: {
            agent: {
              agentId: "agent-1",
              agentVersionId: "agent-version-1",
              slug: "narraops-agent",
              version: 1,
              systemInstructions: "Use fixed Runtime contracts.",
              capabilityManifest: ["pulse.read"],
              modelPolicy: {
                allowedProviders: ["openai-compatible"],
                defaultProvider: "openai-compatible",
              },
            },
            skills: [],
          },
          memories: [{
            scope: "user",
            kind: "user_preference",
            content: "Sensitive canary content must not appear in metadata.",
            confidence: 1,
            sourceType: "user_message",
          }],
        };
      },
    },
  });
  const result = await runtime.handleMessage({
    channel: "web",
    message: "What can you do?",
    context: { userId: "user-1", language: "en", currentView: "go" },
    wait: true,
    timeoutMs: 3_000,
  });
  assert.deepEqual(result.agent.knowledge, {
    agent_slug: "narraops-agent",
    agent_version: 1,
    agent_version_id: "agent-version-1",
    memory_count: 1,
  });
  assert.equal(modelPolicyObserved, true);
  assert.equal(result.agent.provider, "openai-compatible");
  assert.equal(
    JSON.stringify(result.agent.knowledge).includes("Sensitive canary content"),
    false,
  );
});

test("structured launch content follows the Agent version model policy", async () => {
  const originalFetch = globalThis.fetch;
  const operations: string[] = [];
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    async text() {
      return "<html><head><title>Policy Launch</title></head><body>Public narrative source.</body></html>";
    },
  }) as any;
  try {
    const runtime = createAgentRuntime({
      stepDelayMs: 1,
      modelPolicyRouter: {
        async generate(policy: any, request: any) {
          assert.deepEqual(policy.allowedProviders, ["openai-compatible"]);
          operations.push(request.operation);
          if (request.operation === "launch.content") {
            return {
              provider: "openai-compatible",
              model: "policy-launch-model",
              structuredOutput: {
                name: "Policy Launch",
                symbol: "POLICY",
                description: "Generated through the provider-neutral policy router.",
                narrative_thesis: "Agent business logic remains provider independent.",
                risk_notes: ["Requires explicit approval before execution."],
              },
              finishReason: "stop",
            };
          }
          return {
            provider: "openai-compatible",
            model: "policy-reply-model",
            structuredOutput: {
              content: "Launch draft ready.",
              suggestion: "Review before approval.",
            },
            finishReason: "stop",
          };
        },
      },
      runtimeKnowledgeResolver: {
        async resolve(actorId: string) {
          assert.equal(actorId, "user-1");
          return {
            manifest: {
              agent: {
                agentVersionId: "agent-version-1",
                modelPolicy: {
                  allowedProviders: ["openai-compatible"],
                  defaultProvider: "openai-compatible",
                },
              },
              skills: [],
            },
            memories: [],
          };
        },
      },
    });
    const result = await runtime.handleMessage({
      channel: "web",
      message: "/launch https://example.com/story solana pump",
      command: "/launch https://example.com/story solana pump",
      context: {
        userId: "user-1",
        language: "en",
        currentView: "go",
      },
      wait: true,
      timeoutMs: 3_000,
    });
    assert.equal(result.status, "succeeded");
    assert.deepEqual(operations, ["launch.content", "agent.reply"]);
    assert.equal(result.cards[0]?.data?.token?.name, "Policy Launch");
    assert.equal(result.cards[0]?.data?.content_provider, "openai-compatible");
    assert.equal(result.cards[0]?.data?.used_llm, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("persistent runtime keeps plain chat on the direct path without durable tasks", async () => {
  const taskRepository = new InMemoryTaskRepository();
  const conversationRepository = new InMemoryConversationRepository();
  const runtime = createAgentRuntime({
    supabase: {},
    taskRepository,
    conversationRepository,
    launchDraftRepository: new InMemoryLaunchDraftRepository(),
    stepDelayMs: 1,
  });
  const result = await runtime.handleMessage({
    channel: "api",
    message: "Describe your safe capabilities briefly",
    context: { userId: "user-1", language: "en", currentView: "go" },
    wait: true,
    timeoutMs: 3_000,
  });
  assert.equal(result.status, "succeeded");
  assert.equal(result.task?.type, "agent.chat");
  assert.equal(result.task?.execution_mode, "assistant");
  assert.equal(await taskRepository.get(result.task_id), null);
  const conversation = await conversationRepository.get(result.conversation_id);
  assert.ok(conversation);
  assert.equal(conversation.messages.at(-1)?.role, "assistant");
  assert.equal(conversation.messages.at(-1)?.content, result.message?.content);
});

test("durable task state machine rejects terminal-state rewrites", () => {
  assert.doesNotThrow(() => assertTaskTransition("queued", "running"));
  assert.doesNotThrow(() => assertTaskTransition("running", "waiting_approval"));
  assert.throws(
    () => assertTaskTransition("succeeded", "running"),
    (error: any) => error.code === "INVALID_TASK_TRANSITION",
  );
});

test("task events replay from the repository after a manager restart with a cursor", async () => {
  const repository = new InMemoryTaskRepository();
  const manager = new TaskManager({
    repository,
    handlers: {
      async "demo.read"() {
        return { value: "done", card: { type: "text", text: "done" } };
      },
    },
    stepDelayMs: 1,
  });
  const created = await manager.create(
    "demo.read",
    { context: { userId: "user-1" } },
    randomUUID(),
    { user_id: "user-1", channel: "web" },
  );
  await created.done;
  const firstPage = await manager.eventsForActor(created.task.taskId, "user-1", {
    afterSequence: 0,
  });
  assert.ok(firstPage.length >= 6);
  assert.deepEqual(
    firstPage.map((event) => event.sequence),
    [...firstPage.map((event) => event.sequence)].sort((left, right) => left - right),
  );
  await repository.appendEvent(firstPage[0]);
  assert.equal(
    (await repository.listEvents(created.task.taskId)).length,
    firstPage.length,
    "re-appending the same eventId must be idempotent",
  );
  const cursor = firstPage[2].sequence;
  manager.close();

  const restarted = new TaskManager({ repository, handlers: {}, stepDelayMs: 1 });
  const replay = await restarted.eventsForActor(created.task.taskId, "user-1", {
    afterSequence: cursor,
  });
  assert.ok(replay.length > 0);
  assert.ok(replay.every((event) => event.sequence > cursor));
  assert.equal(await restarted.eventsForActor(created.task.taskId, "other-user"), null);
  restarted.close();
});

test("cancelling a running task prevents a late handler result from overwriting cancellation", async () => {
  const repository = new InMemoryTaskRepository();
  let releaseHandler: () => void;
  const blocked = new Promise<void>((resolve) => {
    releaseHandler = resolve;
  });
  const manager = new TaskManager({
    repository,
    handlers: {
      async "demo.slow"() {
        await blocked;
        return { value: "late" };
      },
    },
    stepDelayMs: 1,
  });
  const created = await manager.create(
    "demo.slow",
    { context: { userId: "user-1" } },
    randomUUID(),
    { user_id: "user-1" },
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if ((await manager.get(created.task.taskId))?.status === "running") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const cancelled = await manager.cancel(created.task.taskId, "user-1", "test cancellation");
  assert.equal(cancelled.status, "cancelled");
  releaseHandler!();
  await created.done;
  assert.equal((await manager.get(created.task.taskId))?.status, "cancelled");
  manager.close();
});

test("recovery resumes safe queued work and quarantines interrupted protected work", async () => {
  const repository = new InMemoryTaskRepository();
  const now = new Date().toISOString();
  const queuedTask = await repository.create({
    taskId: randomUUID(),
    type: "demo.read",
    status: "queued",
    progress: 0,
    input: { context: { userId: "user-1" } },
    parsedInput: { user_id: "user-1" },
    createdAt: now,
    updatedAt: now,
    requestId: randomUUID(),
  });
  const protectedTask = await repository.create({
    taskId: randomUUID(),
    type: "trade.execute",
    status: "running",
    progress: 65,
    requiresConfirmation: true,
    executionMode: "live",
    input: { context: { userId: "user-1" } },
    parsedInput: { user_id: "user-1" },
    leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    createdAt: now,
    updatedAt: now,
    requestId: randomUUID(),
  });
  const manager = new TaskManager({
    repository,
    handlers: {
      async "demo.read"() {
        return { recovered: true };
      },
    },
    stepDelayMs: 1,
  });
  const recovery = await manager.recover();
  assert.equal(recovery.resumed, 1);
  assert.equal(recovery.reconciled, 1);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await repository.get(queuedTask.taskId))?.status === "succeeded") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal((await repository.get(queuedTask.taskId))?.status, "succeeded");
  assert.equal((await repository.get(protectedTask.taskId))?.status, "reconciliation_required");
  manager.close();
});

test("no-broadcast signed Pump harness exercises the full signed execution chain with zero real broadcasts", async () => {
  const payer = Keypair.generate();
  const mint = Keypair.generate();
  const feeRecipient = Keypair.generate().publicKey;
  const developerBuyLamports = "1000000";
  const name = "Harness Pump";
  const symbol = "HRN";
  const metadataUri = "https://example.com/harness-pump.json";
  const instructions = await PUMP_SDK.createV2AndBuyInstructions({
    global: { feeRecipient, feeRecipients: [] } as any,
    mint: mint.publicKey,
    name,
    symbol,
    uri: metadataUri,
    creator: payer.publicKey,
    user: payer.publicKey,
    amount: new BN("500000"),
    solAmount: new BN(developerBuyLamports),
    mayhemMode: false,
    cashback: false,
  });
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(...instructions);
  transaction.partialSign(mint);
  const serialized = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString("base64");
  const messageBytes = transaction.serializeMessage();
  const messageHash = createHash("sha256").update(messageBytes).digest("hex");
  const txSignature = bs58.encode(nacl.sign.detached(messageBytes, payer.secretKey));

  const actorId = "harness-user";
  const taskId = randomUUID();
  const toolCallId = randomUUID();
  const draftId = randomUUID();
  const approvalRepository = new InMemoryApprovalLifecycleRepository();
  const lifecycle = new ApprovalLifecycle(approvalRepository);
  const requested = await lifecycle.request({
    actorId,
    taskId,
    toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: draftId,
    parameters: { message_hash: messageHash, fee_payer: payer.publicKey.toBase58() },
    policy: "explicit",
    idempotencyKey: "approval:harness-signed-1",
  });

  const executionId = randomUUID();
  const repository = new InMemoryExecutionReservationRepository();
  repository.seedApproval(requested);
  const reservationService = new ExecutionReservationService(repository);
  const reserved = await reservationService.reserve({
    executionId,
    approvalId: requested.approvalId,
    approvalExpectedStateVersion: requested.stateVersion,
    taskExpectedStateVersion: 1,
    actorId,
    intentId: requested.intent.intentId,
    intentDigest: requested.intent.intentDigest,
    taskId,
    toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: draftId,
    idempotencyKey: "execution:harness-signed-1",
    provider: "pump.fun",
    chain: "solana",
    walletSignatureConfirmation: {
      schemaVersion: "agent.wallet_signature_confirmation.v1",
      messageHash,
      txSignature,
      signer: payer.publicKey.toBase58(),
      verifiedAt: new Date().toISOString(),
    },
  });
  assert.equal(reserved.reservation.status, "reserved");
  assert.equal(repository.approval(requested.approvalId)?.status, "consumed");

  const inspection = inspectPreparedPumpLaunch({
    executionId,
    transactionId: "harness-pump-1",
    transactionBase64: serialized,
    feePayer: payer.publicKey.toBase58(),
    mintAddress: mint.publicKey.toBase58(),
    name,
    symbol,
    metadataUri,
    creator: payer.publicKey.toBase58(),
    developerBuyLamports,
    estimatedFeeAtomic: "5000",
    currentBlockHeight: 90,
    observedAt: new Date().toISOString(),
  });
  assert.equal(inspection.messageHash, messageHash);

  const createdAt = new Date();
  const envelope = buildApprovedPumpLaunchEnvelope({
    inspection,
    actorId,
    intentDigest: requested.intent.intentDigest,
    action: "launch.broadcast",
    maxFeeAtomic: "10000",
    lastValidBlockHeight: 100,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 60_000).toISOString(),
  });
  const bound = await new ExecutionSemanticEnvelopeService(repository).verifyAndBind({
    envelope,
    expectedStateVersion: 1,
    inspections: [inspection],
  });
  assert.equal(bound.semanticEnvelope?.envelopeDigest, envelope.envelopeDigest);

  const transitions = new ExecutionTransitionService(repository);
  const submissionPending = await transitions.transition({
    executionId,
    actorId,
    expectedStatus: "reserved",
    expectedStateVersion: 2,
    status: "submission_pending",
    txHash: txSignature,
  });
  assert.equal(submissionPending.status, "submission_pending");
  assert.equal(submissionPending.txHash, txSignature);
  assert.equal(submissionPending.submittedAt, undefined);

  let executionGatewayCalls = 0;
  const broadcastRegistry = new ToolRegistry().register(
    createPumpLaunchBroadcastTool({
      async submitReservedLaunch(_context, input) {
        executionGatewayCalls += 1;
        assert.equal("signedTransactionBase64" in input, false);
        const submitted = await transitions.transition({
          executionId: input.executionId,
          actorId,
          expectedStatus: "submission_pending",
          expectedStateVersion: input.expectedStateVersion,
          status: "submitted",
          txHash: input.txHash,
        });
        return {
          executionId: submitted.executionId,
          status: "submitted",
          txHash: submitted.txHash!,
          providerAccepted: true,
          observedAt: submitted.updatedAt,
        };
      },
    }),
  );
  const broadcastResult = await broadcastRegistry.execute<
    {
      executionId: string;
      approvalId: string;
      expectedStateVersion: number;
      envelopeDigest: string;
      txHash: string;
    },
    PumpLaunchBroadcastOutput
  >(
    "launch.pump.broadcast",
    "1.0.0",
    toolContext({
      taskId,
      actor: {
        actorId,
        permissions: ["launch:execute"],
      },
      policy: {
        profile: "no-broadcast-harness",
        permissions: ["launch:execute"],
      },
      intentDigest: requested.intent.intentDigest,
      approval: {
        approvalId: requested.approvalId,
        actorId,
        intentDigest: requested.intent.intentDigest,
        status: "consumed",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        recentAuthAt: new Date().toISOString(),
      },
    }),
    {
      executionId,
      approvalId: requested.approvalId,
      expectedStateVersion: submissionPending.stateVersion,
      envelopeDigest: envelope.envelopeDigest,
      txHash: txSignature,
    },
  );
  assert.equal(executionGatewayCalls, 1);
  assert.equal(broadcastResult.status, "succeeded");
  assert.equal(broadcastResult.data.status, "submitted");
  assert.equal(broadcastResult.data.providerAccepted, true);

  let observeCalls = 0;
  const confirmed = await new ExecutionReconciler(repository, [{
    name: "pump.fun",
    async observe({ execution }) {
      observeCalls += 1;
      return {
        txHash: execution.txHash!,
        status: "confirmed" as const,
        observedAt: new Date().toISOString(),
      };
    },
  }]).reconcile({
    executionId,
    actorId,
  });
  assert.equal(observeCalls, 1);
  assert.equal(confirmed.execution.status, "confirmed");
  assert.equal(confirmed.execution.stateVersion, 5);
  assert.ok(confirmed.execution.submittedAt);
  assert.ok(confirmed.execution.completedAt);

  const timeoutExecutionId = randomUUID();
  const timeoutApproval = await lifecycle.request({
    actorId,
    taskId,
    toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: draftId,
    parameters: { message_hash: messageHash, fee_payer: payer.publicKey.toBase58() },
    policy: "explicit",
    idempotencyKey: "approval:harness-timeout-1",
  });
  const timeoutRepository = new InMemoryExecutionReservationRepository();
  timeoutRepository.seedApproval(timeoutApproval);
  await new ExecutionReservationService(timeoutRepository).reserve({
    executionId: timeoutExecutionId,
    approvalId: timeoutApproval.approvalId,
    approvalExpectedStateVersion: timeoutApproval.stateVersion,
    taskExpectedStateVersion: 1,
    actorId,
    intentId: timeoutApproval.intent.intentId,
    intentDigest: timeoutApproval.intent.intentDigest,
    taskId,
    toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: draftId,
    idempotencyKey: "execution:harness-timeout-1",
    provider: "pump.fun",
    chain: "solana",
    walletSignatureConfirmation: {
      schemaVersion: "agent.wallet_signature_confirmation.v1",
      messageHash,
      txSignature,
      signer: payer.publicKey.toBase58(),
      verifiedAt: new Date().toISOString(),
    },
  });
  const timeoutInspection = inspectPreparedPumpLaunch({
    executionId: timeoutExecutionId,
    transactionId: "harness-pump-2",
    transactionBase64: serialized,
    feePayer: payer.publicKey.toBase58(),
    mintAddress: mint.publicKey.toBase58(),
    name,
    symbol,
    metadataUri,
    creator: payer.publicKey.toBase58(),
    developerBuyLamports,
    estimatedFeeAtomic: "5000",
    currentBlockHeight: 90,
    observedAt: new Date().toISOString(),
  });
  const timeoutCreatedAt = new Date();
  const timeoutEnvelope = buildApprovedPumpLaunchEnvelope({
    inspection: timeoutInspection,
    actorId,
    intentDigest: timeoutApproval.intent.intentDigest,
    action: "launch.broadcast",
    maxFeeAtomic: "10000",
    lastValidBlockHeight: 100,
    createdAt: timeoutCreatedAt.toISOString(),
    expiresAt: new Date(timeoutCreatedAt.getTime() + 60_000).toISOString(),
  });
  await new ExecutionSemanticEnvelopeService(timeoutRepository).verifyAndBind({
    envelope: timeoutEnvelope,
    expectedStateVersion: 1,
    inspections: [timeoutInspection],
  });
  await new ExecutionTransitionService(timeoutRepository).transition({
    executionId: timeoutExecutionId,
    actorId,
    expectedStatus: "reserved",
    expectedStateVersion: 2,
    status: "submission_pending",
    txHash: txSignature,
  });
  let timeoutObserveCalls = 0;
  const unknown = await new ExecutionReconciler(timeoutRepository, [{
    name: "pump.fun",
    async observe({ execution }) {
      timeoutObserveCalls += 1;
      throw new Error("chain timeout");
    },
  }]).reconcile({
    executionId: timeoutExecutionId,
    actorId,
  });
  assert.equal(timeoutObserveCalls, 1);
  assert.equal(unknown.execution.status, "reconciliation_required");
  assert.equal(unknown.execution.txHash, txSignature);
  assert.equal(unknown.execution.stateVersion, 4);

  assert.equal(observeCalls + timeoutObserveCalls, 2);
  assert.equal(executionGatewayCalls, 1);
});

test("submitPumpBroadcastViaGateway gates on the authority flag and routes through the Tool", async () => {
  const previous = process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED;
  delete process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED;
  const disabled = await submitPumpBroadcastViaGateway({
    executionId: randomUUID(),
    approvalId: randomUUID(),
    expectedStateVersion: 1,
    envelopeDigest: "a".repeat(64),
    intentDigest: "b".repeat(64),
    txHash: bs58.encode(new Uint8Array(64).fill(1)),
    signedTransactionBase64: "AAAA",
    actorId: "user-1",
    broadcast: async () => ({ status: "submitted", providerAccepted: true }),
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.reason, "pump_gateway_authority_disabled");

  process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED = "true";
  let broadcastCalls = 0;
  const executionId = randomUUID();
  const approvalId = randomUUID();
  const txHash = bs58.encode(new Uint8Array(64).fill(2));
  const result = await submitPumpBroadcastViaGateway({
    executionId,
    approvalId,
    expectedStateVersion: 3,
    envelopeDigest: "c".repeat(64),
    intentDigest: "d".repeat(64),
    txHash,
    signedTransactionBase64: "AAEC",
    actorId: "user-1",
    broadcast: async ({ signedTransactionBase64 }) => {
      broadcastCalls += 1;
      assert.equal(signedTransactionBase64, "AAEC");
      return { status: "submitted", providerAccepted: true };
    },
  });
  assert.equal(result.enabled, true);
  assert.equal(result.status, "submitted");
  assert.equal(result.providerAccepted, true);
  assert.equal(broadcastCalls, 1);

  await assert.rejects(
    submitPumpBroadcastViaGateway({
      executionId,
      approvalId,
      expectedStateVersion: 3,
      envelopeDigest: "c".repeat(64),
      intentDigest: "d".repeat(64),
      txHash,
      signedTransactionBase64: "AAEC",
      actorId: "user-1",
      broadcast: async () => ({ status: "submitted", providerAccepted: false }),
    }),
    (error: any) => error.code === "FINANCIAL_ADAPTER_ACCEPTANCE_MISMATCH",
  );

  if (previous === undefined) {
    delete process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED;
  } else {
    process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED = previous;
  }
});

test("submitSolanaSwapViaGateway gates on the authority flag and routes through the Tool", async () => {
  const previous = process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED;
  delete process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED;
  const disabled = await submitSolanaSwapViaGateway({
    executionId: randomUUID(),
    approvalId: randomUUID(),
    expectedStateVersion: 1,
    envelopeDigest: "a".repeat(64),
    intentDigest: "b".repeat(64),
    txHash: bs58.encode(new Uint8Array(64).fill(1)),
    signedTransactionBase64: "AAAA",
    actorId: "user-1",
    broadcast: async () => ({ status: "submitted", providerAccepted: true }),
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.reason, "swap_gateway_authority_disabled");

  process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED = "true";
  let broadcastCalls = 0;
  const executionId = randomUUID();
  const approvalId = randomUUID();
  const txHash = bs58.encode(new Uint8Array(64).fill(2));
  const result = await submitSolanaSwapViaGateway({
    executionId,
    approvalId,
    expectedStateVersion: 3,
    envelopeDigest: "c".repeat(64),
    intentDigest: "d".repeat(64),
    txHash,
    signedTransactionBase64: "AAEC",
    actorId: "user-1",
    broadcast: async ({ signedTransactionBase64 }) => {
      broadcastCalls += 1;
      assert.equal(signedTransactionBase64, "AAEC");
      return { status: "submitted", providerAccepted: true };
    },
  });
  assert.equal(result.enabled, true);
  assert.equal(result.status, "submitted");
  assert.equal(result.providerAccepted, true);
  assert.equal(broadcastCalls, 1);

  await assert.rejects(
    submitSolanaSwapViaGateway({
      executionId,
      approvalId,
      expectedStateVersion: 3,
      envelopeDigest: "c".repeat(64),
      intentDigest: "d".repeat(64),
      txHash,
      signedTransactionBase64: "AAEC",
      actorId: "user-1",
      broadcast: async () => ({ status: "submitted", providerAccepted: false }),
    }),
    (error: any) => error.code === "FINANCIAL_ADAPTER_ACCEPTANCE_MISMATCH",
  );

  if (previous === undefined) {
    delete process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED;
  } else {
    process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED = previous;
  }
});

test("submitAssetTransferViaGateway gates on the flag and routes broadcast identity through the Tool", async () => {
  const previous = process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED;
  delete process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED;
  const disabled = await submitAssetTransferViaGateway({
    executionId: randomUUID(),
    approvalId: randomUUID(),
    expectedStateVersion: 1,
    envelopeDigest: "a".repeat(64),
    intentDigest: "b".repeat(64),
    actorId: "user-1",
    broadcast: async () => ({ status: "submitted", txHash: "x", providerAccepted: true }),
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.reason, "transfer_gateway_authority_disabled");

  process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED = "true";
  let broadcastCalls = 0;
  const executionId = randomUUID();
  const approvalId = randomUUID();
  const txHash = bs58.encode(new Uint8Array(64).fill(3));
  const result = await submitAssetTransferViaGateway({
    executionId,
    approvalId,
    expectedStateVersion: 3,
    envelopeDigest: "c".repeat(64),
    intentDigest: "d".repeat(64),
    actorId: "user-1",
    broadcast: async ({ actorId }) => {
      broadcastCalls += 1;
      assert.equal(actorId, "user-1");
      return { status: "submitted", txHash, providerAccepted: true };
    },
  });
  assert.equal(result.enabled, true);
  assert.equal(result.status, "submitted");
  assert.equal(result.txHash, txHash);
  assert.equal(broadcastCalls, 1);

  await assert.rejects(
    submitAssetTransferViaGateway({
      executionId,
      approvalId,
      expectedStateVersion: 3,
      envelopeDigest: "c".repeat(64),
      intentDigest: "d".repeat(64),
      actorId: "user-1",
      broadcast: async () => ({ status: "submitted", txHash: "", providerAccepted: false }),
    }),
    (error: any) => error.code === "TRANSFER_GATEWAY_BROADCAST_INVALID",
  );

  if (previous === undefined) {
    delete process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED;
  } else {
    process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED = previous;
  }
});

test("Agent v3 publishes the meme-launch-plan business skill as declarative data", async () => {
  const repository = new InMemoryAgentCatalogRepository();
  const service = new AgentCatalogService(repository, () => new Date());
  const admin = { actorId: randomUUID(), permissions: ["agent:admin"] };
  const agent = await service.publishAgent({ actor: admin, ...NARRAOPS_AGENT_V3 });
  assert.equal(agent.version, 3);
  assert.ok(agent.capabilityManifest.includes("launch.plan"));

  const skill = NARRAOPS_BUSINESS_SKILLS_V1.find(({ slug }) => slug === "meme-launch-plan");
  assert.ok(skill, "meme-launch-plan skill must be defined");
  assert.equal(skill.risk, "write_reversible");
  assert.equal(skill.sideEffect, "internal_write");
  assert.equal(skill.approvalPolicy, "none");
  assert.equal(skill.requiredTools.length, 2);

  const published = await service.publishSkill({ actor: admin, ...skill });
  await service.bindSkill({
    actor: admin,
    agentVersionId: agent.agentVersionId,
    skillVersionId: published.skillVersionId,
  });
  const manifest = await service.getManifest("narraops-agent");
  assert.equal(manifest?.agent.version, 3);
  assert.equal(manifest?.skills.length, 1);
  assert.equal(manifest?.skills[0].skill.slug, "meme-launch-plan");
  assert.equal("execute" in manifest!.skills[0].skill, false);
});
