// @ts-nocheck
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { VersionedTransaction } from "@solana/web3.js";
import { createAgentRuntime } from "../../../backend/agents/agent-runtime.ts";
import { SupabaseWalletGroupRepository } from "../../../backend/api/src/repositories/supabase-wallet-group-repository.ts";
import {
  AssetsWalletGroupContextProvider,
  ApprovalLifecycle,
  ApprovalShadowRecorder,
  ExecutionSemanticShadowRecorder,
  ExecutionReservationService,
  ExecutionReconciler,
  ExecutionSemanticEnvelopeService,
  ExecutionTransitionService,
  FinancialToolStarter,
  ContextResolver,
  PulseSnapshotContextProvider,
  SupabasePulseSnapshotRepository,
  SupabaseApprovalShadowRepository,
  SupabaseApprovalLifecycleRepository,
  SupabaseFinancialToolStartRepository,
  SupabaseSemanticShadowRepository,
  SupabaseExecutionReservationRepository,
  AgentMemoryService,
  LegacyNarraOpsModelProvider,
  ModelGateway,
  ModelPolicyRouter,
  RuntimeKnowledgeResolver,
  SupabaseAgentCatalogRepository,
  SupabaseAgentMemoryRepository,
  ToolRegistry,
  buildApprovedPumpLaunchEnvelope,
  createAssetTransferBroadcastTool,
  createPumpLaunchBroadcastTool,
  createSolanaSwapBroadcastTool,
  executionIntentDigest,
  inspectPreparedPumpLaunch,
} from "../../../backend/agent-runtime/index.ts";
import {
  formatTelegramReply,
  parseTelegramUpdate,
  sendTelegramMessage,
} from "../../../backend/agents/channels/telegram.ts";

let runtimeSingleton = null;
let approvalShadowSingleton = null;
let approvalLifecycleSingleton = null;
let semanticShadowSingleton = null;
let financialToolStarterSingleton = null;
let executionRepositorySingleton = null;
let executionReservationSingleton = null;
let executionSemanticsSingleton = null;
let executionTransitionSingleton = null;
let agentMemoryServiceSingleton = null;
const telegramConversationByChat = new Map();

function serverSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function getRuntime() {
  if (!runtimeSingleton) {
    const supabase = serverSupabase();
    const walletGroupRepository = supabase ? new SupabaseWalletGroupRepository(supabase) : undefined;
    const contextResolver = supabase
      ? new ContextResolver([
          new PulseSnapshotContextProvider(new SupabasePulseSnapshotRepository(supabase)),
          new AssetsWalletGroupContextProvider(walletGroupRepository),
        ])
      : undefined;
    const runtimeKnowledgeResolver = supabase
      && process.env.AGENT_KNOWLEDGE_ENABLED === "true"
      ? new RuntimeKnowledgeResolver(
          new SupabaseAgentCatalogRepository(supabase),
          new AgentMemoryService(new SupabaseAgentMemoryRepository(supabase)),
          process.env.AGENT_DEFINITION_SLUG || "narraops-agent",
        )
      : undefined;
    const modelPolicyRouter = runtimeKnowledgeResolver
      ? new ModelPolicyRouter(
          new ModelGateway().register(new LegacyNarraOpsModelProvider()),
        )
      : undefined;
    runtimeSingleton = createAgentRuntime({
      stepDelayMs: 5,
      supabase,
      walletGroupRepository,
      contextResolver,
      runtimeKnowledgeResolver,
      modelPolicyRouter,
      recoverOnStart: process.env.AGENT_RECOVERY_ENABLED === "true",
      config: {
        gmgnLiveEnabled: process.env.GMGN_LIVE_ENABLED !== "false",
        realExecutionEnabled: process.env.REAL_EXECUTION_ENABLED !== "false",
        gmgnCliPath: process.env.GMGN_CLI_PATH || undefined,
        externalTimeoutMs: Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS || 15_000),
        externalMaxRetries: Number(process.env.EXTERNAL_REQUEST_MAX_RETRIES || 1),
        jupiterApiBaseUrl: process.env.JUPITER_API_BASE_URL || undefined,
        jupiterApiKey: process.env.JUPITER_API_KEY || undefined,
        solanaRpcUrl: process.env.SOLANA_RPC_URL || undefined,
      },
    });
  }
  return runtimeSingleton;
}

export function getSharedAgentRuntime() {
  return getRuntime();
}

export function projectAgentCapabilities(manifest) {
  if (
    !manifest?.agent
    || manifest.agent.status !== "published"
    || !Array.isArray(manifest.agent.capabilityManifest)
    || !Array.isArray(manifest.agent.modelPolicy?.allowedProviders)
    || !Array.isArray(manifest.skills)
  ) {
    throw Object.assign(new Error("Published Agent capabilities are unavailable"), {
      status: 503,
      code: "AGENT_CAPABILITIES_UNAVAILABLE",
    });
  }

  const skills = manifest.skills
    .filter(({ binding, skill }) => binding?.enabled !== false && skill?.status === "published")
    .map(({ skill }) => ({
      slug: skill.slug,
      version: skill.version,
      name: skill.name,
      ...(skill.description ? { description: skill.description } : {}),
      risk: skill.risk,
      side_effect: skill.sideEffect,
      approval_policy: skill.approvalPolicy,
      required_permissions: [...skill.requiredPermissions],
      required_tools: skill.requiredTools.map(({ name, version }) => ({ name, version })),
    }));

  const publishedFinancialTools = [];
  const publishedFinancialToolKeys = new Set();
  for (const skill of skills) {
    if (skill.risk !== "financial_irreversible" && skill.side_effect !== "funds") continue;
    for (const tool of skill.required_tools) {
      const key = `${tool.name}@${tool.version}`;
      if (publishedFinancialToolKeys.has(key)) continue;
      publishedFinancialToolKeys.add(key);
      publishedFinancialTools.push(tool);
    }
  }

  return {
    schema_version: "agent.capabilities.v1",
    agent: {
      slug: manifest.agent.slug,
      version: manifest.agent.version,
      name: manifest.agent.name,
      ...(manifest.agent.description
        ? { description: manifest.agent.description }
        : {}),
      capabilities: [...manifest.agent.capabilityManifest],
      model_providers: [...manifest.agent.modelPolicy.allowedProviders],
      memory_enabled: manifest.agent.memoryPolicy?.enabled === true,
    },
    skills,
    published_financial_tools: publishedFinancialTools,
  };
}

export async function getAgentCapabilities() {
  const supabase = serverSupabase();
  if (!supabase) {
    throw Object.assign(new Error("Agent catalog persistence is unavailable"), {
      status: 503,
      code: "AGENT_CATALOG_PERSISTENCE_UNAVAILABLE",
    });
  }
  try {
    const manifest = await new SupabaseAgentCatalogRepository(supabase).getManifest(
      process.env.AGENT_DEFINITION_SLUG || "narraops-agent",
    );
    if (!manifest) {
      throw Object.assign(new Error("Published Agent was not found"), {
        status: 404,
        code: "AGENT_DEFINITION_NOT_FOUND",
      });
    }
    return projectAgentCapabilities(manifest);
  } catch (error) {
    if (error?.status === 404 || error?.status === 503) throw error;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      status: 503,
      code: error?.code || "AGENT_CAPABILITIES_UNAVAILABLE",
    });
  }
}

function getAgentMemoryService() {
  if (!agentMemoryServiceSingleton) {
    const supabase = serverSupabase();
    if (!supabase) {
      throw Object.assign(new Error("Agent memory persistence is unavailable"), {
        code: "AGENT_MEMORY_PERSISTENCE_UNAVAILABLE",
      });
    }
    agentMemoryServiceSingleton = new AgentMemoryService(
      new SupabaseAgentMemoryRepository(supabase),
    );
  }
  return agentMemoryServiceSingleton;
}

export function proposeAgentMemory(actorId, input) {
  return getAgentMemoryService().propose({ actorId, ...input });
}

export function decideAgentMemory(actorId, input) {
  return getAgentMemoryService().decide({ actorId, ...input });
}

export function forgetAgentMemory(actorId, input) {
  return getAgentMemoryService().forget({ actorId, ...input });
}

export function listAgentMemories(actorId, input = {}) {
  return input.statuses
    ? getAgentMemoryService().listForReview({ actorId, ...input })
    : getAgentMemoryService().retrieve({ actorId, ...input });
}

function getExecutionServices() {
  if (!executionRepositorySingleton) {
    const supabase = serverSupabase();
    if (!supabase) {
      throw Object.assign(new Error("Execution persistence is unavailable"), {
        code: "EXECUTION_PERSISTENCE_UNAVAILABLE",
      });
    }
    executionRepositorySingleton = new SupabaseExecutionReservationRepository(supabase);
    executionReservationSingleton = new ExecutionReservationService(
      executionRepositorySingleton,
    );
    executionSemanticsSingleton = new ExecutionSemanticEnvelopeService(
      executionRepositorySingleton,
    );
    executionTransitionSingleton = new ExecutionTransitionService(
      executionRepositorySingleton,
    );
  }
  return {
    repository: executionRepositorySingleton,
    reservations: executionReservationSingleton,
    semantics: executionSemanticsSingleton,
    transitions: executionTransitionSingleton,
  };
}

export async function recordAgentApprovalShadow(input = {}) {
  if (process.env.AGENT_APPROVAL_SHADOW_ENABLED !== "true") {
    return { recorded: false, reason: "shadow_disabled" };
  }
  try {
    if (!approvalShadowSingleton) {
      const supabase = serverSupabase();
      if (!supabase) return { recorded: false, reason: "persistence_unavailable" };
      approvalShadowSingleton = new ApprovalShadowRecorder(
        new SupabaseApprovalShadowRepository(supabase),
      );
    }
    let timer;
    const record = await Promise.race([
      approvalShadowSingleton.record(input),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error("Approval shadow write timed out"),
          { code: "APPROVAL_SHADOW_TIMEOUT" },
        )), 1_500);
      }),
    ]).finally(() => clearTimeout(timer));
    return {
      recorded: true,
      approvalId: record.approvalId,
      intentId: record.intent.intentId,
      intentDigest: record.intent.intentDigest,
      status: record.status,
    };
  } catch (error) {
    console.error("agent_approval_shadow_failed", {
      code: error?.code || "APPROVAL_SHADOW_FAILED",
      message: error?.message || String(error),
      action: input.action || null,
      resourceType: input.resourceType || null,
    });
    return {
      recorded: false,
      reason: "shadow_write_failed",
      code: error?.code || "APPROVAL_SHADOW_FAILED",
    };
  }
}

export async function recordPumpLaunchSemanticShadow(input = {}) {
  if (process.env.AGENT_PUMP_SEMANTIC_SHADOW_ENABLED !== "true") {
    return { recorded: false, reason: "semantic_shadow_disabled" };
  }
  try {
    if (!semanticShadowSingleton) {
      const supabase = serverSupabase();
      if (!supabase) return { recorded: false, reason: "persistence_unavailable" };
      semanticShadowSingleton = new ExecutionSemanticShadowRecorder(
        new SupabaseSemanticShadowRepository(supabase),
      );
    }
    const now = new Date();
    const executionId = randomUUID();
    const inspection = inspectPreparedPumpLaunch({
      executionId,
      transactionId: "pump-launch-1",
      transactionBase64: input.transactionBase64,
      feePayer: input.feePayer,
      mintAddress: input.mintAddress,
      name: input.name,
      symbol: input.symbol,
      metadataUri: input.metadataUri,
      creator: input.creator || input.feePayer,
      developerBuyLamports: input.developerBuyLamports || "0",
      estimatedFeeAtomic: String(input.estimatedFeeAtomic),
      currentBlockHeight: Number(input.currentBlockHeight),
      observedAt: now.toISOString(),
    });
    const maxFeeAtomic = (
      BigInt(inspection.estimatedFeeAtomic) * 2n
    ).toString();
    const parameters = {
      message_hash: inspection.messageHash,
      mint_address: input.mintAddress,
      fee_payer: input.feePayer,
      name: input.name,
      symbol: input.symbol,
      metadata_uri: input.metadataUri,
      developer_buy_lamports: String(input.developerBuyLamports || "0"),
      max_fee_lamports: maxFeeAtomic,
      last_valid_block_height: Number(input.lastValidBlockHeight),
    };
    const intentDigest = executionIntentDigest({
      actorId: input.actorId,
      action: "launch.broadcast",
      resourceType: "go_launch_draft",
      resourceId: input.draftId,
      parameters,
    });
    const envelope = buildApprovedPumpLaunchEnvelope({
      inspection,
      actorId: input.actorId,
      intentDigest,
      maxFeeAtomic,
      lastValidBlockHeight: Number(input.lastValidBlockHeight),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    });
    let timer;
    const record = await Promise.race([
      semanticShadowSingleton.record({
        actorId: input.actorId,
        action: "launch.broadcast",
        resourceType: "go_launch_draft",
        resourceId: input.draftId,
        envelope,
        inspections: [inspection],
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error("Pump semantic shadow write timed out"),
          { code: "PUMP_SEMANTIC_SHADOW_TIMEOUT" },
        )), 1_500);
      }),
    ]).finally(() => clearTimeout(timer));
    let approvalDualRun = {
      requested: false,
      reason: "approval_dual_run_disabled",
    };
    if (process.env.AGENT_PUMP_APPROVAL_DUAL_RUN_ENABLED === "true") {
      try {
        if (!financialToolStarterSingleton) {
          const supabase = serverSupabase();
          if (!supabase) {
            throw Object.assign(new Error("Financial tool persistence is unavailable"), {
              code: "FINANCIAL_TOOL_PERSISTENCE_UNAVAILABLE",
            });
          }
          financialToolStarterSingleton = new FinancialToolStarter(
            new SupabaseFinancialToolStartRepository(supabase),
          );
        }
        let approvalTimer;
        const started = await Promise.race([
          financialToolStarterSingleton.begin({
            actorId: input.actorId,
            client: "go",
            capability: "launch.execute",
            taskType: "launch.execute",
            toolName: "launch.pump.broadcast",
            toolVersion: "1.0.0",
            action: "launch.broadcast",
            resourceType: "go_launch_draft",
            resourceId: input.draftId,
            safeInput: { envelope, inspection },
            approvalParameters: parameters,
            contextRefs: [],
            policy: "explicit",
            idempotencyKey: `pump:${input.draftId}:${inspection.messageHash}`,
            traceId: executionId,
            ttlMs: 10 * 60_000,
          }),
          new Promise((_, reject) => {
            approvalTimer = setTimeout(() => reject(Object.assign(
              new Error("Pump approval dual-run write timed out"),
              { code: "PUMP_APPROVAL_DUAL_RUN_TIMEOUT" },
            )), 1_500);
          }),
        ]).finally(() => clearTimeout(approvalTimer));
        if (started.approval.intent.intentDigest !== envelope.intentDigest) {
          throw Object.assign(new Error("Pump approval and envelope digests diverged"), {
            code: "PUMP_APPROVAL_ENVELOPE_DIGEST_MISMATCH",
          });
        }
        approvalDualRun = {
          requested: true,
          taskId: started.taskId,
          toolCallId: started.toolCallId,
          approvalId: started.approval.approvalId,
          intentId: started.approval.intent.intentId,
          stateVersion: started.approval.stateVersion,
          idempotentReplay: started.idempotentReplay,
        };
      } catch (error) {
        console.error("agent_pump_approval_dual_run_failed", {
          code: error?.code || "PUMP_APPROVAL_DUAL_RUN_FAILED",
          message: error?.message || String(error),
          draftId: input.draftId || null,
        });
        approvalDualRun = {
          requested: false,
          reason: "approval_dual_run_failed",
          code: error?.code || "PUMP_APPROVAL_DUAL_RUN_FAILED",
        };
      }
    }
    return {
      recorded: true,
      shadowId: record.shadowId,
      executionId,
      intentDigest,
      envelopeDigest: envelope.envelopeDigest,
      messageHash: inspection.messageHash,
      maxFeeAtomic,
      approvalDualRun,
    };
  } catch (error) {
    console.error("agent_pump_semantic_shadow_failed", {
      code: error?.code || "PUMP_SEMANTIC_SHADOW_FAILED",
      message: error?.message || String(error),
      draftId: input.draftId || null,
    });
    return {
      recorded: false,
      reason: "semantic_shadow_failed",
      code: error?.code || "PUMP_SEMANTIC_SHADOW_FAILED",
      errorName: error?.name || "Error",
    };
  }
}

export async function recordSolanaSwapSemanticShadow(input = {}) {
  if (process.env.AGENT_SWAP_SEMANTIC_SHADOW_ENABLED !== "true") {
    return { recorded: false, reason: "swap_semantic_shadow_disabled" };
  }
  try {
    if (!semanticShadowSingleton) {
      const supabase = serverSupabase();
      if (!supabase) return { recorded: false, reason: "persistence_unavailable" };
      semanticShadowSingleton = new ExecutionSemanticShadowRecorder(
        new SupabaseSemanticShadowRepository(supabase),
      );
    }
    const encoded = String(input.signedTransactionBase64 || "").trim();
    const transaction = VersionedTransaction.deserialize(
      Buffer.from(encoded, "base64"),
    );
    const message = transaction.message;
    const staticKeys = message.staticAccountKeys || [];
    const payer = staticKeys[0]?.toBase58?.() || "";
    const signer = String(input.signer || payer);
    const serializedMessage = message.serialize();
    const messageHash = createHash("sha256")
      .update(serializedMessage)
      .digest("hex");
    const programIds = message.compiledInstructions
      ? [...new Set(message.compiledInstructions.map(
        (instruction) => staticKeys[instruction.programIdIndex]?.toBase58(),
      ))].filter(Boolean)
      : [];
    const now = new Date();
    const executionId = randomUUID();
    const inspection = {
      schemaVersion: "agent.transaction_inspection.v1",
      executionId,
      transactionId: "swap-1",
      chain: { kind: "solana", network: input.network || "mainnet-beta" },
      signer,
      messageHash,
      valueAtomic: String(input.valueAtomic || "0"),
      programIds,
      recipients: [],
      slippageBps: Number(input.slippageBps || 300),
      estimatedFeeAtomic: String(input.estimatedFeeAtomic || "0"),
      currentBlockHeight: Number(input.currentBlockHeight),
      observedAt: now.toISOString(),
    };
    const parameters = {
      message_hash: messageHash,
      signer,
      program_ids: programIds,
      slippage_bps: Number(input.slippageBps || 300),
      max_fee_lamports: String(input.maxFeeLamports || inspection.estimatedFeeAtomic),
    };
    const intentDigest = executionIntentDigest({
      actorId: input.actorId,
      action: "swap.broadcast",
      resourceType: "asset_wallet_group",
      resourceId: input.walletGroupId,
      parameters,
    });
    const unsigned: Omit<
      import("../../../backend/agent-runtime/index.ts").ApprovedExecutionEnvelope,
      "envelopeDigest"
    > = {
      schemaVersion: "agent.execution_envelope.v1",
      executionId,
      actorId: input.actorId,
      intentDigest,
      action: "swap.broadcast",
      chain: { kind: "solana", network: input.network || "mainnet-beta" },
      transactions: [{
        transactionId: "swap-1",
        signer,
        messageHash,
        valueAtomic: String(input.valueAtomic || "0"),
        programIds,
        recipients: [],
        maxSlippageBps: Number(input.slippageBps || 300),
        maxFeeAtomic: String(input.maxFeeLamports || inspection.estimatedFeeAtomic),
        lastValidBlockHeight: Number(input.lastValidBlockHeight),
      }],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    };
    const { executionEnvelopeDigest } = await import(
      "../../../backend/agent-runtime/index.ts"
    );
    const envelope = {
      ...unsigned,
      envelopeDigest: executionEnvelopeDigest(unsigned),
    };
    let timer;
    const record = await Promise.race([
      semanticShadowSingleton.record({
        actorId: input.actorId,
        action: "swap.broadcast",
        resourceType: "asset_wallet_group",
        resourceId: input.walletGroupId,
        envelope,
        inspections: [inspection],
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error("Swap semantic shadow write timed out"),
          { code: "SWAP_SEMANTIC_SHADOW_TIMEOUT" },
        )), 1_500);
      }),
    ]).finally(() => clearTimeout(timer));
    let approvalDualRun = {
      requested: false,
      reason: "approval_dual_run_disabled",
    };
    if (process.env.AGENT_SWAP_APPROVAL_DUAL_RUN_ENABLED === "true") {
      try {
        if (!financialToolStarterSingleton) {
          const supabase = serverSupabase();
          if (!supabase) {
            throw Object.assign(new Error("Financial tool persistence is unavailable"), {
              code: "FINANCIAL_TOOL_PERSISTENCE_UNAVAILABLE",
            });
          }
          financialToolStarterSingleton = new FinancialToolStarter(
            new SupabaseFinancialToolStartRepository(supabase),
          );
        }
        let approvalTimer;
        const started = await Promise.race([
          financialToolStarterSingleton.begin({
            actorId: input.actorId,
            client: "go",
            capability: "swap.execute",
            taskType: "swap.execute",
            toolName: "swap.solana.broadcast",
            toolVersion: "1.0.0",
            action: "swap.broadcast",
            resourceType: "asset_wallet_group",
            resourceId: input.walletGroupId,
            safeInput: { envelope, inspection },
            approvalParameters: parameters,
            contextRefs: [],
            policy: "explicit",
            idempotencyKey: `swap:${input.walletGroupId}:${messageHash}`,
            traceId: executionId,
            ttlMs: 10 * 60_000,
          }),
          new Promise((_, reject) => {
            approvalTimer = setTimeout(() => reject(Object.assign(
              new Error("Swap approval dual-run write timed out"),
              { code: "SWAP_APPROVAL_DUAL_RUN_TIMEOUT" },
            )), 1_500);
          }),
        ]).finally(() => clearTimeout(approvalTimer));
        if (started.approval.intent.intentDigest !== envelope.intentDigest) {
          throw Object.assign(new Error("Swap approval and envelope digests diverged"), {
            code: "SWAP_APPROVAL_ENVELOPE_DIGEST_MISMATCH",
          });
        }
        approvalDualRun = {
          requested: true,
          taskId: started.taskId,
          toolCallId: started.toolCallId,
          approvalId: started.approval.approvalId,
          intentId: started.approval.intent.intentId,
          stateVersion: started.approval.stateVersion,
          idempotentReplay: started.idempotentReplay,
        };
      } catch (error) {
        console.error("agent_swap_approval_dual_run_failed", {
          code: error?.code || "SWAP_APPROVAL_DUAL_RUN_FAILED",
          message: error?.message || String(error),
          walletGroupId: input.walletGroupId || null,
        });
        approvalDualRun = {
          requested: false,
          reason: "approval_dual_run_failed",
          code: error?.code || "SWAP_APPROVAL_DUAL_RUN_FAILED",
        };
      }
    }
    return {
      recorded: true,
      shadowId: record.shadowId,
      executionId,
      intentDigest,
      envelopeDigest: envelope.envelopeDigest,
      messageHash,
      maxFeeAtomic: String(input.maxFeeLamports || inspection.estimatedFeeAtomic),
      approvalDualRun,
    };
  } catch (error) {
    console.error("agent_swap_semantic_shadow_failed", {
      code: error?.code || "SWAP_SEMANTIC_SHADOW_FAILED",
      message: error?.message || String(error),
      walletGroupId: input.walletGroupId || null,
    });
    return {
      recorded: false,
      reason: "semantic_shadow_failed",
      code: error?.code || "SWAP_SEMANTIC_SHADOW_FAILED",
      errorName: error?.name || "Error",
    };
  }
}

export async function recordAssetTransferSemanticShadow(input = {}) {
  if (process.env.AGENT_TRANSFER_SEMANTIC_SHADOW_ENABLED !== "true") {
    return { recorded: false, reason: "transfer_semantic_shadow_disabled" };
  }
  try {
    if (!semanticShadowSingleton) {
      const supabase = serverSupabase();
      if (!supabase) return { recorded: false, reason: "persistence_unavailable" };
      semanticShadowSingleton = new ExecutionSemanticShadowRecorder(
        new SupabaseSemanticShadowRepository(supabase),
      );
    }
    const systemProgram = "11111111111111111111111111111111";
    const now = new Date();
    const executionId = randomUUID();
    const messageHash = createHash("sha256")
      .update(`${input.signer}:${input.to}:${String(input.amountLamports)}`)
      .digest("hex");
    const inspection = {
      schemaVersion: "agent.transaction_inspection.v1",
      executionId,
      transactionId: "transfer-1",
      chain: { kind: "solana", network: input.network || "mainnet-beta" },
      signer: input.signer,
      messageHash,
      valueAtomic: String(input.amountLamports || "0"),
      programIds: [systemProgram],
      recipients: [{
        address: input.to,
        assetId: "SOL",
        amountAtomic: String(input.amountLamports || "0"),
      }],
      slippageBps: 0,
      estimatedFeeAtomic: String(input.estimatedFeeAtomic || "0"),
      currentBlockHeight: Number(input.currentBlockHeight),
      observedAt: now.toISOString(),
    };
    const parameters = {
      message_hash: messageHash,
      signer: input.signer,
      to: input.to,
      amount_lamports: String(input.amountLamports || "0"),
      max_fee_lamports: String(input.maxFeeLamports || inspection.estimatedFeeAtomic),
    };
    const intentDigest = executionIntentDigest({
      actorId: input.actorId,
      action: "transfer.broadcast",
      resourceType: "asset_wallet_group",
      resourceId: input.walletGroupId,
      parameters,
    });
    const unsigned: Omit<
      import("../../../backend/agent-runtime/index.ts").ApprovedExecutionEnvelope,
      "envelopeDigest"
    > = {
      schemaVersion: "agent.execution_envelope.v1",
      executionId,
      actorId: input.actorId,
      intentDigest,
      action: "transfer.broadcast",
      chain: { kind: "solana", network: input.network || "mainnet-beta" },
      transactions: [{
        transactionId: "transfer-1",
        signer: input.signer,
        messageHash,
        valueAtomic: String(input.amountLamports || "0"),
        programIds: [systemProgram],
        recipients: [{
          address: input.to,
          assetId: "SOL",
          amountAtomic: String(input.amountLamports || "0"),
        }],
        maxSlippageBps: 0,
        maxFeeAtomic: String(input.maxFeeLamports || inspection.estimatedFeeAtomic),
        lastValidBlockHeight: Number(input.lastValidBlockHeight),
      }],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    };
    const { executionEnvelopeDigest } = await import(
      "../../../backend/agent-runtime/index.ts"
    );
    const envelope = {
      ...unsigned,
      envelopeDigest: executionEnvelopeDigest(unsigned),
    };
    let timer;
    const record = await Promise.race([
      semanticShadowSingleton.record({
        actorId: input.actorId,
        action: "transfer.broadcast",
        resourceType: "asset_wallet_group",
        resourceId: input.walletGroupId,
        envelope,
        inspections: [inspection],
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(
          new Error("Transfer semantic shadow write timed out"),
          { code: "TRANSFER_SEMANTIC_SHADOW_TIMEOUT" },
        )), 1_500);
      }),
    ]).finally(() => clearTimeout(timer));
    let approvalDualRun = {
      requested: false,
      reason: "approval_dual_run_disabled",
    };
    if (process.env.AGENT_TRANSFER_APPROVAL_DUAL_RUN_ENABLED === "true") {
      try {
        if (!financialToolStarterSingleton) {
          const supabase = serverSupabase();
          if (!supabase) {
            throw Object.assign(new Error("Financial tool persistence is unavailable"), {
              code: "FINANCIAL_TOOL_PERSISTENCE_UNAVAILABLE",
            });
          }
          financialToolStarterSingleton = new FinancialToolStarter(
            new SupabaseFinancialToolStartRepository(supabase),
          );
        }
        let approvalTimer;
        const started = await Promise.race([
          financialToolStarterSingleton.begin({
            actorId: input.actorId,
            client: "go",
            capability: "assets.transfer",
            taskType: "assets.transfer",
            toolName: "assets.transfer.broadcast",
            toolVersion: "1.0.0",
            action: "transfer.broadcast",
            resourceType: "asset_wallet_group",
            resourceId: input.walletGroupId,
            safeInput: { envelope, inspection },
            approvalParameters: parameters,
            contextRefs: [],
            policy: "explicit",
            idempotencyKey: `transfer:${input.walletGroupId}:${messageHash}`,
            traceId: executionId,
            ttlMs: 10 * 60_000,
          }),
          new Promise((_, reject) => {
            approvalTimer = setTimeout(() => reject(Object.assign(
              new Error("Transfer approval dual-run write timed out"),
              { code: "TRANSFER_APPROVAL_DUAL_RUN_TIMEOUT" },
            )), 1_500);
          }),
        ]).finally(() => clearTimeout(approvalTimer));
        if (started.approval.intent.intentDigest !== envelope.intentDigest) {
          throw Object.assign(new Error("Transfer approval and envelope digests diverged"), {
            code: "TRANSFER_APPROVAL_ENVELOPE_DIGEST_MISMATCH",
          });
        }
        approvalDualRun = {
          requested: true,
          taskId: started.taskId,
          toolCallId: started.toolCallId,
          approvalId: started.approval.approvalId,
          intentId: started.approval.intent.intentId,
          stateVersion: started.approval.stateVersion,
          idempotentReplay: started.idempotentReplay,
        };
      } catch (error) {
        console.error("agent_transfer_approval_dual_run_failed", {
          code: error?.code || "TRANSFER_APPROVAL_DUAL_RUN_FAILED",
          message: error?.message || String(error),
          walletGroupId: input.walletGroupId || null,
        });
        approvalDualRun = {
          requested: false,
          reason: "approval_dual_run_failed",
          code: error?.code || "TRANSFER_APPROVAL_DUAL_RUN_FAILED",
        };
      }
    }
    return {
      recorded: true,
      shadowId: record.shadowId,
      executionId,
      intentDigest,
      envelopeDigest: envelope.envelopeDigest,
      messageHash,
      maxFeeAtomic: String(input.maxFeeLamports || inspection.estimatedFeeAtomic),
      approvalDualRun,
    };
  } catch (error) {
    console.error("agent_transfer_semantic_shadow_failed", {
      code: error?.code || "TRANSFER_SEMANTIC_SHADOW_FAILED",
      message: error?.message || String(error),
      walletGroupId: input.walletGroupId || null,
    });
    return {
      recorded: false,
      reason: "semantic_shadow_failed",
      code: error?.code || "TRANSFER_SEMANTIC_SHADOW_FAILED",
      errorName: error?.name || "Error",
    };
  }
}

export async function prepareSolanaSwapRuntimeExecution(input = {}) {
  if (process.env.AGENT_SWAP_ENFORCEMENT_ENABLED !== "true") {
    return { enforced: false, reason: "swap_enforcement_disabled" };
  }
  const supabase = serverSupabase();
  if (!supabase) {
    throw Object.assign(new Error("Swap enforcement persistence is unavailable"), {
      code: "SWAP_ENFORCEMENT_PERSISTENCE_UNAVAILABLE",
    });
  }
  const approval = input.approvalDualRun || {};
  if (
    !input.actorId
    || !input.walletGroupId
    || !input.shadowId
    || !approval.requested
    || !approval.taskId
    || !approval.toolCallId
    || !approval.approvalId
    || !approval.intentId
  ) {
    throw Object.assign(new Error("Swap was not prepared with Runtime approval state"), {
      code: "SWAP_RUNTIME_APPROVAL_REQUIRED",
    });
  }
  const { data: shadow, error } = await supabase
    .from("agent_semantic_shadows")
    .select("*")
    .eq("shadow_id", input.shadowId)
    .eq("actor_id", input.actorId)
    .eq("resource_type", "asset_wallet_group")
    .eq("resource_id", input.walletGroupId)
    .eq("shadow_mode", true)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Unable to load Swap semantics"), {
      code: error.code || "SWAP_SEMANTIC_SHADOW_READ_FAILED",
    });
  }
  if (!shadow?.envelope || !Array.isArray(shadow.inspections) || shadow.inspections.length !== 1) {
    throw Object.assign(new Error("Swap semantic shadow is incomplete"), {
      code: "SWAP_SEMANTIC_SHADOW_INVALID",
    });
  }
  const envelope = shadow.envelope;
  const now = new Date().toISOString();
  const inspection = {
    ...shadow.inspections[0],
    currentBlockHeight: Number(input.currentBlockHeight),
    observedAt: now,
  };
  if (
    envelope.executionId !== input.executionId
    || envelope.actorId !== input.actorId
    || envelope.intentDigest !== input.intentDigest
    || envelope.action !== "swap.broadcast"
    || inspection.messageHash !== input.messageHash
    || inspection.signer !== input.signer
    || !Number.isSafeInteger(inspection.currentBlockHeight)
  ) {
    throw Object.assign(new Error("Swap signed transaction differs from Runtime semantics"), {
      code: "SWAP_RUNTIME_SEMANTICS_MISMATCH",
    });
  }

  const services = getExecutionServices();
  const reserved = await services.reservations.reserve({
    executionId: envelope.executionId,
    approvalId: approval.approvalId,
    approvalExpectedStateVersion: Number(approval.stateVersion || 1),
    taskExpectedStateVersion: 1,
    actorId: input.actorId,
    intentId: approval.intentId,
    intentDigest: envelope.intentDigest,
    taskId: approval.taskId,
    toolCallId: approval.toolCallId,
    action: "swap.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: input.walletGroupId,
    idempotencyKey: `swap-execution:${input.walletGroupId}:${input.messageHash}`,
    provider: "jupiter",
    chain: "solana",
    walletSignatureConfirmation: {
      schemaVersion: "agent.wallet_signature_confirmation.v1",
      messageHash: input.messageHash,
      txSignature: input.txSignature,
      signer: input.signer,
      verifiedAt: now,
    },
  });
  let current = reserved.reservation;
  if (current.status === "reserved" && !current.semanticEnvelope) {
    current = await services.semantics.verifyAndBind({
      envelope,
      inspections: [inspection],
      expectedStateVersion: current.stateVersion,
    });
  }
  let broadcastClaimed = false;
  if (current.status === "reserved") {
    try {
      current = await services.transitions.transition({
        executionId: current.executionId,
        actorId: input.actorId,
        expectedStatus: "reserved",
        expectedStateVersion: current.stateVersion,
        status: "submission_pending",
        txHash: input.txSignature,
      });
      broadcastClaimed = true;
    } catch (error) {
      if (error?.code !== "EXECUTION_STATE_CONFLICT") throw error;
      current = await services.repository.get(current.executionId);
    }
  }
  if (
    !current
    || !["submission_pending", "submitted", "reconciliation_required", "confirmed"].includes(current.status)
    || current.txHash !== input.txSignature
  ) {
    throw Object.assign(new Error("Swap Runtime execution cannot be submitted"), {
      code: "SWAP_RUNTIME_EXECUTION_STATE_CONFLICT",
    });
  }
  return {
    enforced: true,
    executionId: current.executionId,
    status: current.status,
    stateVersion: current.stateVersion,
    txHash: current.txHash,
    idempotentReplay: reserved.idempotentReplay,
    broadcastClaimed,
  };
}

export async function prepareAssetTransferRuntimeExecution(input = {}) {
  if (process.env.AGENT_TRANSFER_ENFORCEMENT_ENABLED !== "true") {
    return { enforced: false, reason: "transfer_enforcement_disabled" };
  }
  const supabase = serverSupabase();
  if (!supabase) {
    throw Object.assign(new Error("Transfer enforcement persistence is unavailable"), {
      code: "TRANSFER_ENFORCEMENT_PERSISTENCE_UNAVAILABLE",
    });
  }
  const approval = input.approvalDualRun || {};
  if (
    !input.actorId
    || !input.walletGroupId
    || !input.shadowId
    || !approval.requested
    || !approval.taskId
    || !approval.toolCallId
    || !approval.approvalId
    || !approval.intentId
  ) {
    throw Object.assign(new Error("Transfer was not prepared with Runtime approval state"), {
      code: "TRANSFER_RUNTIME_APPROVAL_REQUIRED",
    });
  }
  const { data: shadow, error } = await supabase
    .from("agent_semantic_shadows")
    .select("*")
    .eq("shadow_id", input.shadowId)
    .eq("actor_id", input.actorId)
    .eq("resource_type", "asset_wallet_group")
    .eq("resource_id", input.walletGroupId)
    .eq("shadow_mode", true)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Unable to load Transfer semantics"), {
      code: error.code || "TRANSFER_SEMANTIC_SHADOW_READ_FAILED",
    });
  }
  if (!shadow?.envelope || !Array.isArray(shadow.inspections) || shadow.inspections.length !== 1) {
    throw Object.assign(new Error("Transfer semantic shadow is incomplete"), {
      code: "TRANSFER_SEMANTIC_SHADOW_INVALID",
    });
  }
  const envelope = shadow.envelope;
  const now = new Date().toISOString();
  const inspection = {
    ...shadow.inspections[0],
    currentBlockHeight: Number(input.currentBlockHeight),
    observedAt: now,
  };
  if (
    envelope.executionId !== input.executionId
    || envelope.actorId !== input.actorId
    || envelope.intentDigest !== input.intentDigest
    || envelope.action !== "transfer.broadcast"
    || inspection.messageHash !== input.messageHash
    || inspection.signer !== input.signer
    || !Number.isSafeInteger(inspection.currentBlockHeight)
  ) {
    throw Object.assign(new Error("Transfer execution differs from Runtime semantics"), {
      code: "TRANSFER_RUNTIME_SEMANTICS_MISMATCH",
    });
  }

  const services = getExecutionServices();
  const reserved = await services.reservations.reserve({
    executionId: envelope.executionId,
    approvalId: approval.approvalId,
    approvalExpectedStateVersion: Number(approval.stateVersion || 1),
    taskExpectedStateVersion: 1,
    actorId: input.actorId,
    intentId: approval.intentId,
    intentDigest: envelope.intentDigest,
    taskId: approval.taskId,
    toolCallId: approval.toolCallId,
    action: "transfer.broadcast",
    resourceType: "asset_wallet_group",
    resourceId: input.walletGroupId,
    idempotencyKey: `transfer-execution:${input.walletGroupId}:${input.messageHash}`,
    provider: "solana-native",
    chain: "solana",
  });
  let current = reserved.reservation;
  if (current.status === "reserved" && !current.semanticEnvelope) {
    current = await services.semantics.verifyAndBind({
      envelope,
      inspections: [inspection],
      expectedStateVersion: current.stateVersion,
    });
  }
  let broadcastClaimed = false;
  if (current.status === "reserved") {
    try {
      current = await services.transitions.transition({
        executionId: current.executionId,
        actorId: input.actorId,
        expectedStatus: "reserved",
        expectedStateVersion: current.stateVersion,
        status: "submission_pending",
        txHash: input.placeholderTxHash,
      });
      broadcastClaimed = true;
    } catch (error) {
      if (error?.code !== "EXECUTION_STATE_CONFLICT") throw error;
      current = await services.repository.get(current.executionId);
    }
  }
  if (
    !current
    || !["submission_pending", "submitted", "reconciliation_required", "confirmed"].includes(current.status)
    || current.txHash !== input.placeholderTxHash
  ) {
    throw Object.assign(new Error("Transfer Runtime execution cannot be submitted"), {
      code: "TRANSFER_RUNTIME_EXECUTION_STATE_CONFLICT",
    });
  }
  return {
    enforced: true,
    executionId: current.executionId,
    status: current.status,
    stateVersion: current.stateVersion,
    txHash: current.txHash,
    idempotentReplay: reserved.idempotentReplay,
    broadcastClaimed,
  };
}

export async function preparePumpLaunchRuntimeExecution(input = {}) {
  if (process.env.AGENT_PUMP_ENFORCEMENT_ENABLED !== "true") {
    return { enforced: false, reason: "pump_enforcement_disabled" };
  }
  const supabase = serverSupabase();
  if (!supabase) {
    throw Object.assign(new Error("Pump enforcement persistence is unavailable"), {
      code: "PUMP_ENFORCEMENT_PERSISTENCE_UNAVAILABLE",
    });
  }
  const approval = input.approvalDualRun || {};
  if (
    !input.actorId
    || !input.draftId
    || !input.shadowId
    || !approval.requested
    || !approval.taskId
    || !approval.toolCallId
    || !approval.approvalId
    || !approval.intentId
  ) {
    throw Object.assign(new Error("Pump launch was not prepared with Runtime approval state"), {
      code: "PUMP_RUNTIME_APPROVAL_REQUIRED",
    });
  }
  const { data: shadow, error } = await supabase
    .from("agent_semantic_shadows")
    .select("*")
    .eq("shadow_id", input.shadowId)
    .eq("actor_id", input.actorId)
    .eq("resource_type", "go_launch_draft")
    .eq("resource_id", input.draftId)
    .eq("shadow_mode", true)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error(error.message || "Unable to load Pump semantics"), {
      code: error.code || "PUMP_SEMANTIC_SHADOW_READ_FAILED",
    });
  }
  if (!shadow?.envelope || !Array.isArray(shadow.inspections) || shadow.inspections.length !== 1) {
    throw Object.assign(new Error("Pump semantic shadow is incomplete"), {
      code: "PUMP_SEMANTIC_SHADOW_INVALID",
    });
  }
  const envelope = shadow.envelope;
  const now = new Date().toISOString();
  const inspection = {
    ...shadow.inspections[0],
    currentBlockHeight: Number(input.currentBlockHeight),
    observedAt: now,
  };
  if (
    envelope.executionId !== input.executionId
    || envelope.actorId !== input.actorId
    || envelope.intentDigest !== input.intentDigest
    || envelope.action !== "launch.broadcast"
    || inspection.messageHash !== input.messageHash
    || inspection.signer !== input.signer
    || !Number.isSafeInteger(inspection.currentBlockHeight)
  ) {
    throw Object.assign(new Error("Pump signed transaction differs from Runtime semantics"), {
      code: "PUMP_RUNTIME_SEMANTICS_MISMATCH",
    });
  }

  const services = getExecutionServices();
  const reserved = await services.reservations.reserve({
    executionId: envelope.executionId,
    approvalId: approval.approvalId,
    approvalExpectedStateVersion: Number(approval.stateVersion || 1),
    taskExpectedStateVersion: 1,
    actorId: input.actorId,
    intentId: approval.intentId,
    intentDigest: envelope.intentDigest,
    taskId: approval.taskId,
    toolCallId: approval.toolCallId,
    action: "launch.broadcast",
    resourceType: "go_launch_draft",
    resourceId: input.draftId,
    idempotencyKey: `pump-execution:${input.draftId}:${input.messageHash}`,
    provider: "pump.fun",
    chain: "solana",
    walletSignatureConfirmation: {
      schemaVersion: "agent.wallet_signature_confirmation.v1",
      messageHash: input.messageHash,
      txSignature: input.txSignature,
      signer: input.signer,
      verifiedAt: now,
    },
  });
  let current = reserved.reservation;
  if (current.status === "reserved" && !current.semanticEnvelope) {
    current = await services.semantics.verifyAndBind({
      envelope,
      inspections: [inspection],
      expectedStateVersion: current.stateVersion,
    });
  }
  let broadcastClaimed = false;
  if (current.status === "reserved") {
    try {
      current = await services.transitions.transition({
        executionId: current.executionId,
        actorId: input.actorId,
        expectedStatus: "reserved",
        expectedStateVersion: current.stateVersion,
        status: "submission_pending",
        txHash: input.txSignature,
      });
      broadcastClaimed = true;
    } catch (error) {
      if (error?.code !== "EXECUTION_STATE_CONFLICT") throw error;
      current = await services.repository.get(current.executionId);
    }
  }
  if (
    !current
    || !["submission_pending", "submitted", "reconciliation_required", "confirmed"].includes(current.status)
    || current.txHash !== input.txSignature
  ) {
    throw Object.assign(new Error("Pump Runtime execution cannot be submitted"), {
      code: "PUMP_RUNTIME_EXECUTION_STATE_CONFLICT",
    });
  }
  return {
    enforced: true,
    executionId: current.executionId,
    status: current.status,
    stateVersion: current.stateVersion,
    txHash: current.txHash,
    idempotentReplay: reserved.idempotentReplay,
    broadcastClaimed,
  };
}

export async function transitionPumpLaunchRuntimeExecution(input = {}) {
  if (process.env.AGENT_PUMP_ENFORCEMENT_ENABLED !== "true") {
    return { enforced: false, reason: "pump_enforcement_disabled" };
  }
  const services = getExecutionServices();
  const current = await services.repository.get(input.executionId);
  if (!current || current.actorId !== input.actorId) {
    throw Object.assign(new Error("Pump Runtime execution was not found"), {
      code: "PUMP_RUNTIME_EXECUTION_NOT_FOUND",
    });
  }
  if (current.status === input.status) return current;
  if (["confirmed", "failed", "cancelled"].includes(current.status)) {
    throw Object.assign(new Error("Pump Runtime execution is already terminal"), {
      code: "PUMP_RUNTIME_EXECUTION_TERMINAL",
    });
  }
  return services.transitions.transition({
    executionId: current.executionId,
    actorId: input.actorId,
    expectedStatus: current.status,
    expectedStateVersion: current.stateVersion,
    status: input.status,
    ...(input.txHash ? { txHash: input.txHash } : {}),
    ...(input.failure ? { failure: input.failure } : {}),
  });
}

export async function reconcilePumpLaunchRuntimeExecution(input = {}) {
  if (process.env.AGENT_PUMP_ENFORCEMENT_ENABLED !== "true") {
    return { enforced: false, reason: "pump_enforcement_disabled" };
  }
  const observation = input.observation || {};
  if (
    !input.executionId
    || !input.actorId
    || !input.txHash
    || !["not_found", "pending", "confirmed", "failed", "unknown"].includes(
      observation.status,
    )
  ) {
    throw Object.assign(new Error("Pump reconciliation input is invalid"), {
      code: "PUMP_RECONCILIATION_INPUT_INVALID",
    });
  }
  const services = getExecutionServices();
  const reconciler = new ExecutionReconciler(services.repository, [{
    name: "pump.fun",
    async observe() {
      return {
        txHash: input.txHash,
        status: observation.status,
        observedAt: observation.observedAt || new Date().toISOString(),
        ...(observation.failure ? { failure: observation.failure } : {}),
      };
    },
  }]);
  const result = await reconciler.reconcile({
    executionId: input.executionId,
    actorId: input.actorId,
  });
  return {
    enforced: true,
    executionId: result.execution.executionId,
    status: result.execution.status,
    stateVersion: result.execution.stateVersion,
    txHash: result.execution.txHash,
    observation: result.observation,
    changed: result.changed,
  };
}

function getApprovalLifecycle() {
  if (!approvalLifecycleSingleton) {
    const supabase = serverSupabase();
    if (!supabase) {
      throw Object.assign(new Error("Approval persistence is unavailable"), {
        status: 503,
        code: "APPROVAL_PERSISTENCE_UNAVAILABLE",
      });
    }
    approvalLifecycleSingleton = new ApprovalLifecycle(
      new SupabaseApprovalLifecycleRepository(supabase),
    );
  }
  return approvalLifecycleSingleton;
}

export async function getAgentApproval(approvalId, actorId) {
  return getApprovalLifecycle().read(approvalId, actorId);
}

export async function decideAgentApproval(input = {}) {
  return getApprovalLifecycle().decide(input);
}

export async function createAgentConversation(body = {}) {
  const runtime = getRuntime();
  return runtime.createConversation(body.context || {}, body.channel || "web");
}

export async function getAgentConversation(conversationId) {
  return getRuntime().getConversation(conversationId);
}

export async function getAgentTask(taskId, actorId) {
  return actorId
    ? getRuntime().getTaskForActor(taskId, actorId)
    : getRuntime().getTask(taskId);
}

export async function listAgentTaskEvents(taskId, actorId, options = {}) {
  return getRuntime().listTaskEvents(taskId, actorId, options);
}

export async function cancelAgentTask(taskId, actorId, reason) {
  return getRuntime().cancelTask(taskId, actorId, reason);
}

export async function postAgentConversationMessage(conversationId, body = {}) {
  const wait = body.wait !== false;
  return getRuntime().handleMessage({
    channel: body.channel || "web",
    conversationId,
    message: body.message,
    command: body.command || null,
    context: body.context || {},
    wait,
    timeoutMs: Number(body.timeoutMs || body.timeout_ms || 20_000),
  });
}

export async function updateAgentLaunchDraft(draftId, body = {}) {
  return getRuntime().updateLaunchDraft(draftId, body);
}

export async function createAgentTask(body = {}) {
  const runtime = getRuntime();
  const result = await runtime.handleMessage({
    channel: "api",
    message: body.message || body.input || body.command || "",
    command: body.command || null,
    context: body.context || body.parameters?.context || {},
    wait: body.wait === true,
    timeoutMs: Number(body.timeoutMs || body.timeout_ms || 20_000),
  });
  return {
    task_id: result.task_id,
    conversation_id: result.conversation_id,
    status: result.status,
    ...(result.message ? { message: result.message } : {}),
    ...(result.cards ? { cards: result.cards } : {}),
    ...(result.agent ? { agent: result.agent } : {}),
    ...(result.task || {}),
  };
}

export async function submitPumpBroadcastViaGateway(input = {}) {
  if (process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED !== "true") {
    return { enabled: false, reason: "pump_gateway_authority_disabled" };
  }
  const {
    executionId,
    approvalId,
    expectedStateVersion,
    envelopeDigest,
    intentDigest,
    txHash,
    signedTransactionBase64,
    actorId,
    taskId,
    traceId,
    requestId,
    broadcast,
  } = input;
  if (
    !executionId
    || !approvalId
    || !Number.isInteger(expectedStateVersion)
    || expectedStateVersion < 1
    || !envelopeDigest
    || !intentDigest
    || !txHash
    || !signedTransactionBase64
    || !actorId
    || typeof broadcast !== "function"
  ) {
    throw Object.assign(
      new Error("Pump gateway broadcast input is incomplete"),
      { code: "PUMP_GATEWAY_INPUT_INVALID" },
    );
  }
  const tool = createPumpLaunchBroadcastTool({
    async submitReservedLaunch(context, toolInput) {
      const result = await broadcast({
        signedTransactionBase64: input.signedTransactionBase64,
        txHash: toolInput.txHash,
        actorId,
      });
      return {
        executionId: toolInput.executionId,
        status: result.status,
        txHash: toolInput.txHash,
        providerAccepted: result.providerAccepted,
        observedAt: new Date().toISOString(),
      };
    },
  });
  const registry = new ToolRegistry().register(tool);
  const context = {
    requestId: requestId || randomUUID(),
    traceId: traceId || randomUUID(),
    taskId: taskId || randomUUID(),
    actor: { actorId, permissions: ["launch:execute"] },
    policy: { profile: "launch", permissions: ["launch:execute"] },
    approval: {
      approvalId,
      actorId,
      intentDigest,
      status: "consumed",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recentAuthAt: new Date().toISOString(),
    },
    intentDigest,
    idempotencyKey: `pump-gateway:${executionId}`,
    signal: new AbortController().signal,
    emit: async () => {},
  };
  const result = await registry.execute(
    "launch.pump.broadcast",
    "1.0.0",
    context,
    { executionId, approvalId, expectedStateVersion, envelopeDigest, txHash },
  );
  if (result.status !== "succeeded") {
    throw Object.assign(
      new Error(`Pump gateway broadcast did not succeed: ${result.reason || result.code}`),
      { code: result.code || "PUMP_GATEWAY_BROADCAST_FAILED" },
    );
  }
  return { enabled: true, ...result.data };
}

export async function submitSolanaSwapViaGateway(input = {}) {
  if (process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED !== "true") {
    return { enabled: false, reason: "swap_gateway_authority_disabled" };
  }
  const {
    executionId,
    approvalId,
    expectedStateVersion,
    envelopeDigest,
    intentDigest,
    txHash,
    signedTransactionBase64,
    actorId,
    taskId,
    traceId,
    requestId,
    broadcast,
  } = input;
  if (
    !executionId
    || !approvalId
    || !Number.isInteger(expectedStateVersion)
    || expectedStateVersion < 1
    || !envelopeDigest
    || !intentDigest
    || !txHash
    || !signedTransactionBase64
    || !actorId
    || typeof broadcast !== "function"
  ) {
    throw Object.assign(
      new Error("Swap gateway broadcast input is incomplete"),
      { code: "SWAP_GATEWAY_INPUT_INVALID" },
    );
  }
  const tool = createSolanaSwapBroadcastTool({
    async submitReservedSwap(context, toolInput) {
      const result = await broadcast({
        signedTransactionBase64: input.signedTransactionBase64,
        txHash: toolInput.txHash,
        actorId,
      });
      return {
        executionId: toolInput.executionId,
        status: result.status,
        txHash: toolInput.txHash,
        providerAccepted: result.providerAccepted,
        observedAt: new Date().toISOString(),
      };
    },
  });
  const registry = new ToolRegistry().register(tool);
  const context = {
    requestId: requestId || randomUUID(),
    traceId: traceId || randomUUID(),
    taskId: taskId || randomUUID(),
    actor: { actorId, permissions: ["swap:execute"] },
    policy: { profile: "swap", permissions: ["swap:execute"] },
    approval: {
      approvalId,
      actorId,
      intentDigest,
      status: "consumed",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recentAuthAt: new Date().toISOString(),
    },
    intentDigest,
    idempotencyKey: `swap-gateway:${executionId}`,
    signal: new AbortController().signal,
    emit: async () => {},
  };
  const result = await registry.execute(
    "swap.solana.broadcast",
    "1.0.0",
    context,
    { executionId, approvalId, expectedStateVersion, envelopeDigest, txHash },
  );
  if (result.status !== "succeeded") {
    throw Object.assign(
      new Error(`Swap gateway broadcast did not succeed: ${result.reason || result.code}`),
      { code: result.code || "SWAP_GATEWAY_BROADCAST_FAILED" },
    );
  }
  return { enabled: true, ...result.data };
}

export async function submitAssetTransferViaGateway(input = {}) {
  if (process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED !== "true") {
    return { enabled: false, reason: "transfer_gateway_authority_disabled" };
  }
  const {
    executionId,
    approvalId,
    expectedStateVersion,
    envelopeDigest,
    intentDigest,
    actorId,
    taskId,
    traceId,
    requestId,
    broadcast,
  } = input;
  if (
    !executionId
    || !approvalId
    || !Number.isInteger(expectedStateVersion)
    || expectedStateVersion < 1
    || !envelopeDigest
    || !intentDigest
    || !actorId
    || typeof broadcast !== "function"
  ) {
    throw Object.assign(
      new Error("Transfer gateway broadcast input is incomplete"),
      { code: "TRANSFER_GATEWAY_INPUT_INVALID" },
    );
  }
  // Transfer executes server-side custody signing; the tx hash is only known
  // after the broadcast returns. Run the broadcast first, then route the
  // resulting identity through the Tool so approval/intent checks still hold.
  const broadcastResult = await broadcast({ actorId });
  if (!broadcastResult?.txHash || !broadcastResult?.providerAccepted) {
    throw Object.assign(
      new Error("Transfer broadcast did not produce a provider-accepted identity"),
      { code: "TRANSFER_GATEWAY_BROADCAST_INVALID" },
    );
  }
  const tool = createAssetTransferBroadcastTool({
    async submitReservedTransfer() {
      return {
        executionId,
        status: broadcastResult.status || "submitted",
        txHash: broadcastResult.txHash,
        providerAccepted: broadcastResult.providerAccepted,
        observedAt: new Date().toISOString(),
      };
    },
  });
  const registry = new ToolRegistry().register(tool);
  const context = {
    requestId: requestId || randomUUID(),
    traceId: traceId || randomUUID(),
    taskId: taskId || randomUUID(),
    actor: { actorId, permissions: ["assets:transfer"] },
    policy: { profile: "transfer", permissions: ["assets:transfer"] },
    approval: {
      approvalId,
      actorId,
      intentDigest,
      status: "consumed",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      recentAuthAt: new Date().toISOString(),
    },
    intentDigest,
    idempotencyKey: `transfer-gateway:${executionId}`,
    signal: new AbortController().signal,
    emit: async () => {},
  };
  const result = await registry.execute(
    "assets.transfer.broadcast",
    "1.0.0",
    context,
    {
      executionId,
      approvalId,
      expectedStateVersion,
      envelopeDigest,
      txHash: broadcastResult.txHash,
    },
  );
  if (result.status !== "succeeded") {
    throw Object.assign(
      new Error(`Transfer gateway broadcast did not succeed: ${result.reason || result.code}`),
      { code: result.code || "TRANSFER_GATEWAY_BROADCAST_FAILED" },
    );
  }
  return { enabled: true, ...result.data };
}

export async function handleTelegramWebhook(update = {}) {
  const parsed = parseTelegramUpdate(update);
  if (!parsed.handled) {
    return {
      ok: true,
      ignored: true,
      reason: parsed.reason,
    };
  }

  const runtime = getRuntime();
  const existingConversationId = telegramConversationByChat.get(parsed.conversationKey) || null;
  const result = await runtime.handleMessage({
    channel: "telegram",
    conversationId: existingConversationId,
    message: parsed.message,
    command: parsed.command,
    context: parsed.context,
    wait: true,
    timeoutMs: 10_000,
  });
  telegramConversationByChat.set(parsed.conversationKey, result.conversation_id);

  const reply = formatTelegramReply(result, parsed.context.language || "en");
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  let delivery = { status: "formatted_only" };
  if (token && parsed.context.telegram?.chat_id != null) {
    const sent = await sendTelegramMessage({
      token,
      chatId: parsed.context.telegram.chat_id,
      text: reply.text,
      replyToMessageId: parsed.context.telegram.message_id,
    });
    delivery = { status: "sent", telegram: sent?.result?.message_id || null };
  }

  return {
    ok: true,
    ignored: false,
    conversation_id: result.conversation_id,
    task_id: result.task_id,
    status: result.status,
    reply,
    delivery,
  };
}

export default {
  getSharedAgentRuntime,
  getAgentCapabilities,
  createAgentConversation,
  getAgentConversation,
  getAgentTask,
  listAgentTaskEvents,
  cancelAgentTask,
  postAgentConversationMessage,
  updateAgentLaunchDraft,
  createAgentTask,
  handleTelegramWebhook,
  recordAgentApprovalShadow,
  recordPumpLaunchSemanticShadow,
  preparePumpLaunchRuntimeExecution,
  transitionPumpLaunchRuntimeExecution,
  reconcilePumpLaunchRuntimeExecution,
  submitPumpBroadcastViaGateway,
  recordSolanaSwapSemanticShadow,
  prepareSolanaSwapRuntimeExecution,
  submitSolanaSwapViaGateway,
  recordAssetTransferSemanticShadow,
  prepareAssetTransferRuntimeExecution,
  submitAssetTransferViaGateway,
  getAgentApproval,
  decideAgentApproval,
};
