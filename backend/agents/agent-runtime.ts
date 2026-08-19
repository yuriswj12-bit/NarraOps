// @ts-nocheck
/**
 * Channel-agnostic Agent Runtime.
 * Web Go and Telegram share this entrypoint so product logic stays in one place.
 */
import { randomUUID } from "node:crypto";
import { TaskManager } from "./task-manager.ts";
import { createAgentHandlers } from "./agent-handlers.ts";
import { createIntegrationRegistry } from "../integrations/registry.ts";
import { createUserAnalyticsService } from "./user-analytics.ts";
import { InMemoryConversationRepository } from "../api/src/repositories/in-memory-conversation-repository.ts";
import { InMemoryTaskRepository } from "../api/src/repositories/in-memory-task-repository.ts";
import { InMemoryLaunchDraftRepository } from "../api/src/repositories/in-memory-launch-draft-repository.ts";
import { InMemoryDevWalletRepository } from "../api/src/repositories/in-memory-dev-wallet-repository.ts";
import { containsForbiddenSecret } from "../api/src/security.ts";
import {
  SupabaseConversationRepository,
  SupabaseLaunchDraftRepository,
  SupabaseTaskRepository,
} from "../api/src/repositories/supabase-agent-repositories.ts";
import {
  validateAgentTask,
  validateConversationCreate,
  validateConversationMessage,
} from "../api/src/validation.ts";
import {
  generateAgentReply,
  generateStructuredLaunchContent,
} from "./llm-provider.ts";
import { createLegacyReadToolRegistry } from "../agent-runtime/tools/legacy-read-tools.ts";

const SUPPORTED_CHANNELS = new Set(["web", "telegram", "api"]);
export const AGENT_CAPABILITIES = Object.freeze([
  "NarraOps domain agent: narrative discovery -> analysis -> meme launch -> post-launch wallet operations",
  "Read-only GMGN market data: trending tokens, launchpad trenches, K-lines, token signals, and token due diligence",
  "Direct Pump.fun launch through the connected Cooking wallet after explicit confirmation",
  "Direct Solana Swap through the selected Assets wallet after explicit confirmation and browser signature",
  "解释 NarraOps 能力和当前工作区状态",
  "根据公开叙事生成可审阅的 narrative / meme 草案",
  "读取已接入的只读行情、开发者钱包和 Meme 分析工具结果",
  "生成可编辑的 live launch draft 和风险清单",
  "模拟交易、转账和提现计划，但不签名、不广播、不动用资金",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicTask(task) {
  if (!task) return null;
  return {
    task_id: task.taskId,
    type: task.type,
    status: task.status,
    progress: task.progress,
    requires_confirmation: Boolean(task.requiresConfirmation),
    execution_mode: task.executionMode || "live",
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    ...(task.result !== undefined ? { result: task.result } : {}),
    ...(task.failure !== undefined ? { failure: task.failure } : {}),
  };
}

function assistantBlocksFromTask(task) {
  if (!task) return [{ type: "text", text: "Task is still running." }];
  if (task.status === "failed") {
    return [{ type: "error", error: task.failure || { message: "Task failed" } }];
  }
  if (task.result?.card) return [task.result.card];
  if (task.result) return [{ type: "result", data: task.result }];
  return [{ type: "text", text: "Task completed." }];
}

function messageFromTask(task, language = "en") {
  const zh = language === "zh";
  if (!task) {
    return {
      role: "assistant",
      content: zh ? "任务仍在处理中。" : "The task is still processing.",
      suggestion: zh ? "稍后刷新查看结果。" : "Refresh shortly for the result.",
    };
  }
  if (task.status === "failed") {
    return {
      role: "assistant",
      content: zh
        ? `任务失败：${task.failure?.message || "Agent 服务当前不可用。"}`
        : `Task failed: ${task.failure?.message || "The Agent service is currently unavailable."}`,
      suggestion: zh ? "请重试，或换一种更具体的命令。" : "Retry, or try a more specific command.",
    };
  }
  const cardType = task.result?.card?.type;
  const labels = {
    narrative_snapshot: zh ? "已生成叙事快照。" : "Narrative snapshot ready.",
    meme_package: zh ? "已生成 Meme 构建包。" : "Meme package ready.",
    launch_draft: zh ? "已生成可编辑发射参数。" : "Editable launch fields are ready.",
    dev_market: zh ? "已生成链上 Dev 行情摘要。" : "On-chain Dev market summary ready.",
    narrative_trends: zh ? "已生成叙事趋势摘要。" : "Narrative trend summary ready.",
    meme_analysis: zh ? "已生成 Meme 分析报告。" : "Meme analysis report ready.",
    market_trending: zh ? "GMGN 热门代币排行已生成。" : "GMGN trending-token ranking ready.",
    market_trenches: zh ? "GMGN 新币/发射榜已生成。" : "GMGN launchpad trenches report ready.",
    market_kline: zh ? "GMGN K 线数据已生成。" : "GMGN K-line data ready.",
    market_signal: zh ? "GMGN 市场信号已生成。" : "GMGN market signals ready.",
    recent_summary: zh ? "已生成近期总结。" : "Recent summary ready.",
  };
  return {
    role: "assistant",
    content: labels[cardType] || (zh ? "任务已完成。" : "Task completed."),
    suggestion: zh
      ? "可以继续修改参数，或要求生成/更新发射预案。"
      : "You can refine parameters or ask to create/update a launch draft.",
  };
}

function publicRuntimeKnowledge(runtimeKnowledge) {
  const agent = runtimeKnowledge?.manifest?.agent;
  if (!agent) return null;
  return {
    agent_slug: agent.slug,
    agent_version: agent.version,
    agent_version_id: agent.agentVersionId,
    memory_count: Array.isArray(runtimeKnowledge.memories)
      ? runtimeKnowledge.memories.length
      : 0,
  };
}

const LAUNCH_DRAFT_TOKEN_FIELDS = Object.freeze([
  "name",
  "symbol",
  "description",
  "image_url",
  "x_url",
  "telegram_url",
  "website_url",
  "initial_buy",
  "bundle_buy_total",
  "bundle_buy_per_wallet",
  "slippage_percent",
]);
const LAUNCH_DRAFT_SELECTION_FIELDS = Object.freeze([
  "cooking_wallet_group_id",
  "bundled_wallet_group_id",
]);

export function normalizeLaunchDraftPatch(patch = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw Object.assign(new Error("Launch draft patch must be a JSON object"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  if (containsForbiddenSecret(patch)) {
    throw Object.assign(new Error("Private keys, seed phrases, tokens, cookies, and API keys are not accepted"), {
      status: 400,
      code: "SENSITIVE_INPUT_REJECTED",
    });
  }

  const normalized = {};
  if (patch.token !== undefined) {
    if (!patch.token || typeof patch.token !== "object" || Array.isArray(patch.token)) {
      throw Object.assign(new Error("token must be an object"), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const token = {};
    for (const field of LAUNCH_DRAFT_TOKEN_FIELDS) {
      if (patch.token[field] === undefined) continue;
      if (patch.token[field] !== null && typeof patch.token[field] !== "string") {
        throw Object.assign(new Error(`token.${field} must be a string or null`), {
          status: 400,
          code: "VALIDATION_ERROR",
        });
      }
      const value = patch.token[field];
      const max = field === "symbol" ? 13 : field === "name" ? 64 : field === "description" ? 2_000 : 2_000;
      token[field] = value == null ? null : value.trim().slice(0, max);
    }
    if (!Object.keys(token).length) {
      throw Object.assign(new Error("token must include at least one editable field"), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    normalized.token = token;
  }

  if (patch.action !== undefined) {
    if (patch.action !== "mark_reviewed") {
      throw Object.assign(new Error("Unsupported launch draft action"), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    normalized.metadata = {
      ...(normalized.metadata || {}),
      review_status: "reviewed",
      reviewed_at: new Date().toISOString(),
    };
  }

  for (const field of LAUNCH_DRAFT_SELECTION_FIELDS) {
    if (patch[field] === undefined) continue;
    if (patch[field] !== null && typeof patch[field] !== "string") {
      throw Object.assign(new Error(`${field} must be a string or null`), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const value = patch[field] == null ? null : patch[field].trim().slice(0, 100);
    normalized[field] = value || null;
    normalized.metadata = {
      ...(normalized.metadata || {}),
      [field]: value || null,
    };
  }

  if (!Object.keys(normalized).length) {
    throw Object.assign(new Error("Launch draft patch is empty"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  return normalized;
}


function withTimeout(promise, timeoutMs, label = "operation") {
  const ms = Math.max(250, Number(timeoutMs) || 8_000);
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), {
          status: 504,
          code: "AGENT_TIMEOUT",
        }));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}


export function createAgentRuntime(options = {}) {
  const config = options.config || {};
  const integrations = options.integrations || createIntegrationRegistry(config);
  const supabase = options.supabase || null;
  const contextResolver = options.contextResolver || null;
  const runtimeKnowledgeResolver = options.runtimeKnowledgeResolver || null;
  const modelPolicyRouter = options.modelPolicyRouter || null;

  async function generateConfiguredAgentReply(input, runtimeKnowledge, replyTimeoutMs = 3_000) {
    const timeoutMs = Math.min(Math.max(Number(replyTimeoutMs) || 3_000, 1_000), 12_000);
    const policy = runtimeKnowledge?.manifest?.agent?.modelPolicy;
    if (!modelPolicyRouter || !policy) {
      return generateAgentReply({ ...input, timeoutMs });
    }
    const response = await modelPolicyRouter.generate(policy, {
      requestId: randomUUID(),
      operation: "agent.reply",
      input: {
        message: input.message,
        history: input.history || [],
        task: input.task || null,
        capabilities: input.capabilities || [],
        runtimeInstructions: input.runtimeInstructions || "",
        durableMemories: input.durableMemories || [],
        timeoutMs,
      },
      responseSchema: {
        type: "object",
        additionalProperties: false,
        required: ["content", "suggestion"],
        properties: {
          content: { type: "string" },
          suggestion: { type: "string" },
        },
      },
      metadata: {
        taskId: input.task?.task_id || input.task?.taskId || randomUUID(),
        locale: input.language === "zh" ? "zh-CN" : "en",
        policyProfile: "agent-version",
      },
    }, {
      timeoutMs,
    });
    const structured = response.structuredOutput || {};
    return {
      provider: response.provider,
      model: response.model,
      content: structured.content || response.content || "",
      suggestion: structured.suggestion || "",
      used_llm: response.finishReason === "stop",
      configured: response.finishReason === "stop",
      ...(response.finishReason !== "stop"
        ? { fallback_reason: response.finishReason }
        : {}),
    };
  }

  async function generateConfiguredLaunchContent(input, context = {}) {
    if (!modelPolicyRouter || !runtimeKnowledgeResolver) {
      return generateStructuredLaunchContent(input);
    }
    const runtimeKnowledge = await runtimeKnowledgeResolver.resolve(
      context.userId || undefined,
    );
    const policy = runtimeKnowledge?.manifest?.agent?.modelPolicy;
    if (!policy) return generateStructuredLaunchContent(input);
    const response = await modelPolicyRouter.generate(policy, {
      requestId: context.requestId || randomUUID(),
      operation: "launch.content",
      input: {
        prompt: String(input.prompt || ""),
        sourceText: String(input.sourceText || input.source_text || ""),
        runtimeInstructions: runtimeKnowledge?.manifest?.agent?.systemInstructions || "",
        durableMemories: runtimeKnowledge?.memories || [],
      },
      responseSchema: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "symbol",
          "description",
          "narrative_thesis",
          "risk_notes",
        ],
        properties: {
          name: { type: "string" },
          symbol: { type: "string" },
          description: { type: "string" },
          narrative_thesis: { type: "string" },
          risk_notes: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      metadata: {
        taskId: context.taskId || randomUUID(),
        locale: input.language === "zh" ? "zh-CN" : "en",
        policyProfile: "agent-version",
      },
    }, {
      timeoutMs: 8_000,
    });
    return {
      provider: response.provider,
      model: response.model,
      content: response.structuredOutput || {},
      used_llm: response.finishReason === "stop",
      ...(response.finishReason !== "stop"
        ? { error: response.finishReason }
        : {}),
    };
  }

  const conversations =
    options.conversationRepository ||
    (supabase ? new SupabaseConversationRepository(supabase) : new InMemoryConversationRepository());
  const tasks =
    options.taskRepository ||
    (supabase ? new SupabaseTaskRepository(supabase) : new InMemoryTaskRepository());
  const launchDrafts =
    options.launchDraftRepository ||
    (supabase ? new SupabaseLaunchDraftRepository(supabase) : new InMemoryLaunchDraftRepository());
  const devWallets =
    options.devWalletRepository || new InMemoryDevWalletRepository();
  const narrativeRepository = options.narrativeRepository || (supabase ? {
    async listActive({ topic = "", limit = 12 } = {}) {
      let query = supabase
        .from("pulse_narrative_candidates")
        .select("narrative_id,category,platform,author_name,original_text,source_url,media_type,media_urls,published_at,expires_at")
        .gt("expires_at", new Date().toISOString())
        .order("published_at", { ascending: false })
        .limit(limit);
      const search = String(topic || "").trim();
      if (search && !/^social meme opportunities$/i.test(search)) query = query.ilike("original_text", `%${search.slice(0, 80)}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  } : undefined);
  const toolRegistry = options.toolRegistry || createLegacyReadToolRegistry({
    integrations,
    walletGroupRepository: options.walletGroupRepository,
    narrativeRepository,
  });
  const userAnalytics = options.userAnalytics || createUserAnalyticsService(supabase);

  const manager =
    options.taskManager ||
    new TaskManager({
      repository: tasks,
      handlers: createAgentHandlers(integrations, {
        devWalletRepository: devWallets,
        launchDraftRepository: launchDrafts,
        conversationRepository: conversations,
        walletGroupRepository: options.walletGroupRepository,
        narrativeRepository,
        modelContentGenerator: generateConfiguredLaunchContent,
        toolRegistry,
        userAnalytics,
      }),
      stepDelayMs: options.stepDelayMs ?? config.taskStepDelayMs ?? 20,
    });

  const waitingTaskIds = new Set();
  if (options.recoverOnStart && manager.recover) {
    void manager.recover().catch((error) => {
      options.logger?.error?.("agent_recovery_failed", {
        code: error?.code || "AGENT_RECOVERY_FAILED",
        message: error?.message || String(error),
      });
    });
  }
  manager.on("taskEvent", (event) => {
    void (async () => {
      if (event.type !== "task.completed" && event.type !== "task.failed") return;
      const task = event.task;
      if (waitingTaskIds.has(task?.taskId)) return;
      const conversationId = await conversations.conversationIdForTask(task?.taskId);
      if (!conversationId) return;
      await conversations.addMessage(conversationId, {
        role: "assistant",
        taskId: task.taskId,
        status: event.type === "task.completed" ? "completed" : "failed",
        blocks: assistantBlocksFromTask(task),
      });
    })();
  });

  async function waitForTask(taskId, { timeoutMs = 8_000, pollMs = 40 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const task = await manager.get(taskId);
      if (!task) return null;
      if (["succeeded", "failed", "cancelled"].includes(task.status)) return task;
      await sleep(pollMs);
    }
    return manager.get(taskId);
  }

  async function createConversation(rawContext = {}, channel = "web") {
    if (!SUPPORTED_CHANNELS.has(channel)) {
      throw Object.assign(new Error(`Unsupported agent channel: ${channel}`), {
        status: 400,
        code: "UNSUPPORTED_AGENT_CHANNEL",
      });
    }
    const context = validateConversationCreate({
      context: {
        ...rawContext,
        channel,
      },
    });
    return conversations.create({
      ...context,
      channel,
      channel_user_id: rawContext.channelUserId || rawContext.channel_user_id || null,
      user_id: rawContext.userId || rawContext.user_id || null,
    });
  }

  async function getConversation(conversationId) {
    return conversations.get(conversationId);
  }

  async function updateLaunchDraft(draftId, patch = {}) {
    if (!launchDrafts?.update) {
      throw Object.assign(new Error("Launch draft updates are unavailable"), {
        status: 503,
        code: "LAUNCH_DRAFT_UPDATE_UNAVAILABLE",
      });
    }
    const updated = await launchDrafts.update(draftId, normalizeLaunchDraftPatch(patch));
    if (!updated) {
      throw Object.assign(new Error("Launch draft was not found"), {
        status: 404,
        code: "LAUNCH_DRAFT_NOT_FOUND",
      });
    }
    return {
      schema_version: "go.launch_draft.v1",
      draft: updated,
      card: {
        type: "launch_draft",
        status: updated.preparation_status,
        data: {
          ...updated,
          executable: true,
          submitted: false,
          reason: "awaiting_user_confirmation",
        },
      },
    };
  }

  async function handleMessage({
    channel = "web",
    conversationId = null,
    message,
    command = null,
    context = {},
    wait = false,
    timeoutMs = 8_000,
  }) {
    if (!SUPPORTED_CHANNELS.has(channel)) {
      throw Object.assign(new Error(`Unsupported agent channel: ${channel}`), {
        status: 400,
        code: "UNSUPPORTED_AGENT_CHANNEL",
      });
    }

    let conversation = conversationId ? await conversations.get(conversationId) : null;
    if (!conversation) {
      conversation = await createConversation(context, channel);
    }

    const validated = validateConversationMessage({
      message,
      command,
      context: {
        language: context.language || conversation.context?.language || "en",
        currentView: context.currentView || conversation.context?.currentView || "go",
        projectId: context.projectId || conversation.context?.projectId,
        contextRefs: context.contextRefs || context.context_refs || [],
      },
    });

    let resolvedContext = null;
    const actorId =
      context.userId ||
      context.user_id ||
      conversation.userId ||
      conversation.context?.user_id ||
      null;
    if (validated.context.contextRefs?.length) {
      if (!contextResolver) {
        throw Object.assign(new Error("Agent context resolution is unavailable"), {
          status: 503,
          code: "CONTEXT_RESOLVER_UNAVAILABLE",
        });
      }
      if (!actorId) {
        throw Object.assign(new Error("Sign in before using private Pulse or Assets context"), {
          status: 401,
          code: "CONTEXT_AUTHENTICATION_REQUIRED",
        });
      }
      resolvedContext = await contextResolver.resolve({
        actor: {
          actorId,
          permissions: ["pulse:read", "assets:read", "research:read", "market:read"],
        },
        client: validated.context.currentView || channel,
        conversationId: conversation.conversationId,
        refs: validated.context.contextRefs,
        policyProfile: "authenticated-user",
      });
    }
    const runtimeKnowledge = runtimeKnowledgeResolver
      ? await runtimeKnowledgeResolver.resolve(actorId || undefined).catch((error) => {
          options.logger?.warn?.("agent_runtime_knowledge_unavailable", {
            code: error?.code || "AGENT_RUNTIME_KNOWLEDGE_UNAVAILABLE",
            message: error?.message || String(error),
          });
          return null;
        })
      : null;

    const parsedEarly = validateAgentTask({
      ...(validated.command
        ? { command: validated.command }
        : { input: validated.message }),
      parameters: {
        context: {
          ...validated.context,
          channel,
          conversation_id: conversation.conversationId,
          ...(resolvedContext ? { resolved_context: resolvedContext } : {}),
        },
      },
    });

    const hasLaunchContext = Array.isArray(conversation.messages) && conversation.messages.some(
      (entry) => Array.isArray(entry?.blocks) && entry.blocks.some((block) => block?.type === "launch_draft"),
    );
    // Plain chat uses the fast direct-model path. Skills/analysis still go
    // through the durable task path below so cards, events, and Memory
    // prefill remain queryable.
    if (wait && parsedEarly.type === "agent.chat" && !hasLaunchContext) {
      const capabilities = AGENT_CAPABILITIES
        .filter((capability) => !/mock|review-only|disabled/i.test(String(capability)))
        .concat([
          "Direct Pump.fun launch signed by the selected Cooking wallet after explicit user confirmation",
          "Direct Solana Swap through a selected one-wallet Assets group after token security and explicit user confirmation",
        ]);
      if (runtimeKnowledge?.manifest?.agent?.capabilityManifest?.length) {
        capabilities.push(...runtimeKnowledge.manifest.agent.capabilityManifest);
      }
      const syntheticTask = {
        taskId: randomUUID(),
        type: "agent.chat",
        status: "succeeded",
        progress: 100,
        requires_confirmation: false,
        execution_mode: "assistant",
        executionMode: "assistant",
        result: {
          mode: "assistant",
          request: validated.message,
          ...(resolvedContext ? { context: resolvedContext.safeModelContext } : {}),
        },
      };
      const agentReply = await withTimeout(
        generateConfiguredAgentReply({
          message: validated.message,
          language: validated.context.language,
          history: Array.isArray(conversation.messages) ? conversation.messages.slice(-6) : [],
          task: syntheticTask,
          capabilities,
          runtimeInstructions: runtimeKnowledge?.manifest?.agent?.systemInstructions || "",
          durableMemories: runtimeKnowledge?.memories || [],
        }, runtimeKnowledge, 3_000),
        3_000,
        "agent.chat.direct",
      ).catch(() => ({
        provider: "fallback",
        used_llm: false,
        configured: false,
        fallback_reason: "chat_timeout",
        content: validated.context.language === "zh"
          ? "在。我可以帮你解读叙事、根据链接生成发射参数，并在你确认后进入 Pump 发射或钱包买卖。"
          : "Here. I can explain narratives, turn links into launch fields, and enter Pump launch or wallet trade flows after you confirm.",
        suggestion: validated.context.language === "zh"
          ? "直接发链接，或者说“分析这个 Solana Meme / 帮我发射 / 买入某个代币”。"
          : "Send a link, or say “analyze this Solana meme / launch this / buy a token”.",
      }));

      // Preserve conversation ordering before returning. The bounded write
      // keeps the fast path deterministic without allowing persistence to
      // hold the response indefinitely.
      await withTimeout(
        (async () => {
          await conversations.addMessage(conversation.conversationId, {
            role: "user",
            content: validated.message,
            command: validated.command,
            channel,
          }).catch(() => null);
          await conversations.addMessage(conversation.conversationId, {
            role: "assistant",
            content: agentReply.content,
            taskId: syntheticTask.taskId,
            status: "succeeded",
            channel,
            blocks: [],
          }).catch(() => null);
        })(),
        4_000,
        "agent.chat.persist",
      ).catch(() => null);

      return {
        schema_version: "agent.runtime.v1",
        channel,
        conversation_id: conversation.conversationId,
        conversationId: conversation.conversationId,
        task_id: syntheticTask.taskId,
        taskId: syntheticTask.taskId,
        status: "succeeded",
        wait,
        task: syntheticTask,
        message: {
          role: "assistant",
          content: agentReply.content,
          suggestion: agentReply.suggestion,
          provider: agentReply.provider || "fallback",
          used_llm: Boolean(agentReply.used_llm),
        },
        cards: [],
        agent: {
          provider: agentReply.provider || "fallback",
          used_llm: Boolean(agentReply.used_llm),
          configured: Boolean(agentReply.configured),
          ...(agentReply.fallback_reason ? { fallback_reason: agentReply.fallback_reason } : {}),
          ...(runtimeKnowledge
            ? { knowledge: publicRuntimeKnowledge(runtimeKnowledge) }
            : {}),
        },
        persistence: supabase ? "supabase" : "memory",
      };
    }

    await conversations.addMessage(conversation.conversationId, {
      role: "user",
      content: validated.message,
      command: validated.command,
      channel,
    });

    const parsed = validateAgentTask({
      ...(validated.command
        ? { command: validated.command }
        : { input: validated.message }),
      parameters: {
        context: {
          ...validated.context,
          channel,
          conversation_id: conversation.conversationId,
          ...(resolvedContext ? { resolved_context: resolvedContext } : {}),
          channel_user_id:
            context.channelUserId ||
            context.channel_user_id ||
            conversation.channelUserId ||
            conversation.context?.channel_user_id ||
            null,
          user_id:
            context.userId ||
            context.user_id ||
            conversation.userId ||
            conversation.context?.user_id ||
            null,
        },
      },
    });

    const requestId = context.requestId || randomUUID();
    const capabilities = AGENT_CAPABILITIES
      .filter((capability) => !/mock|review-only|disabled/i.test(String(capability)))
      .concat([
        "Direct Pump.fun launch signed by the selected Cooking wallet after explicit user confirmation",
        "Direct Solana Swap through a selected one-wallet Assets group after token security and explicit user confirmation",
      ]);
    if (runtimeKnowledge?.manifest?.agent?.capabilityManifest?.length) {
      capabilities.push(...runtimeKnowledge.manifest.agent.capabilityManifest);
    }

    // Confirmed Memory is injected only as editable prefill suggestions. It
    // never overrides the user's explicit input and never authorizes execution.
    const memoryPrefill = (runtimeKnowledge?.memories || []).length
      ? structuredClone(runtimeKnowledge.memories)
      : [];
    if (memoryPrefill.length && parsed.input && typeof parsed.input === "object") {
      parsed.input = {
        ...parsed.input,
        context: {
          ...(parsed.input.context || {}),
          memory_prefill: memoryPrefill,
        },
      };
    }

    const created = await withTimeout(
      manager.create(parsed.type, parsed.input, requestId, {
        ...parsed.metadata,
        conversation_id: conversation.conversationId,
        channel,
        user_id:
          context.userId ||
          context.user_id ||
          conversation.userId ||
          conversation.context?.user_id ||
          null,
      }),
      6_000,
      "agent.task.create",
    );
    const task = created.task || created;
    const runDone = created.done || Promise.resolve();
    await conversations.bindTask(conversation.conversationId, task.taskId);
    if (wait) waitingTaskIds.add(task.taskId);

    let finalTask = publicTask(task);
    let assistantMessage = null;
    let agentReply = null;
    if (wait) {
      const completed = await withTimeout(
        (async () => {
          await Promise.race([
            runDone.catch(() => null),
            new Promise((resolve) => setTimeout(resolve, Math.max(250, timeoutMs))),
          ]);
          return manager.get(task.taskId);
        })(),
        timeoutMs + 1_000,
        "agent.task.wait",
      ).catch(async () => manager.get(task.taskId));
      waitingTaskIds.delete(task.taskId);
      finalTask = publicTask(completed || task);
      const restoredConversation = await withTimeout(
        conversations.get(conversation.conversationId),
        4_000,
        "agent.conversation.reload",
      ).catch(() => conversation);
      agentReply = await withTimeout(
        generateConfiguredAgentReply({
          message: validated.message,
          language: validated.context.language,
          history: restoredConversation?.messages || [],
          task: finalTask,
          capabilities,
          runtimeInstructions: runtimeKnowledge?.manifest?.agent?.systemInstructions || "",
          durableMemories: runtimeKnowledge?.memories || [],
        }, runtimeKnowledge, 5_000),
        5_000,
        "agent.reply",
      ).catch(() => ({
        provider: "fallback",
        used_llm: false,
        configured: false,
        fallback_reason: "reply_timeout",
        content: validated.context.language === "zh"
          ? "任务处理超时，已保留当前进度。请重试或换一种说法。"
          : "The task timed out. Please retry or rephrase.",
        suggestion: validated.context.language === "zh" ? "可以再说一次，或直接发送链接。" : "Try again, or send a public link.",
      }));
      assistantMessage = {
        role: "assistant",
        content: agentReply.content,
        suggestion: agentReply.suggestion,
        provider: agentReply.provider,
        used_llm: Boolean(agentReply.used_llm),
        ...(agentReply.model ? { model: agentReply.model } : {}),
      };
      await withTimeout(
        conversations.addMessage(conversation.conversationId, {
          role: "assistant",
          content: agentReply.content,
          taskId: completed?.taskId || task.taskId,
          status: completed?.status || task.status,
          channel,
          blocks: assistantBlocksFromTask(completed || task),
        }),
        4_000,
        "agent.assistant.persist",
      ).catch(() => null);
    }

    return {
      schema_version: "agent.runtime.v1",
      channel,
      conversation_id: conversation.conversationId,
      task_id: task.taskId,
      status: finalTask?.status || task.status || "succeeded",
      wait,
      task: finalTask,
      message: assistantMessage,
      cards: finalTask?.result?.card
        ? [finalTask.result.card]
        : Array.isArray(finalTask?.result?.cards)
          ? finalTask.result.cards
          : [],
      agent: agentReply
        ? {
            provider: agentReply.provider,
            used_llm: Boolean(agentReply.used_llm),
            configured: Boolean(agentReply.configured),
            ...(agentReply.model ? { model: agentReply.model } : {}),
            ...(agentReply.fallback_reason ? { fallback_reason: agentReply.fallback_reason } : {}),
            ...(runtimeKnowledge
              ? { knowledge: publicRuntimeKnowledge(runtimeKnowledge) }
              : {}),
          }
        : null,
      persistence: supabase ? "supabase" : "memory",
    };
  }

  return {
    manager,
    conversations,
    launchDrafts,
    createConversation,
    getConversation,
    handleMessage,
    updateLaunchDraft,
    waitForTask,
    getTask: (taskId) => manager.get(taskId),
    getTaskForActor: (taskId, actorId) => manager.getForActor(taskId, actorId),
    listTaskEvents: (taskId, actorId, options = {}) => manager.eventsForActor(taskId, actorId, options),
    cancelTask: (taskId, actorId, reason) => manager.cancel(taskId, actorId, reason),
    recoverTasks: (options = {}) => manager.recover(options),
    publicTask,
  };
}

export default createAgentRuntime;
