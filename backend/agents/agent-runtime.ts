// @ts-nocheck
/**
 * Channel-agnostic Agent Runtime.
 * Web Go and Telegram share this entrypoint so product logic stays in one place.
 */
import { randomUUID } from "node:crypto";
import { TaskManager } from "./task-manager.ts";
import { createMockHandlers } from "./mock-handlers.ts";
import { createIntegrationRegistry } from "../integrations/registry.ts";
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

const SUPPORTED_CHANNELS = new Set(["web", "telegram", "api"]);

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
    execution_mode: task.executionMode || "mock",
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
    launch_draft: zh ? "已生成可审阅发射预案。" : "Review-only launch draft ready.",
    dev_market: zh ? "已生成链上 Dev 行情摘要。" : "On-chain Dev market summary ready.",
    narrative_trends: zh ? "已生成叙事趋势摘要。" : "Narrative trend summary ready.",
    meme_analysis: zh ? "已生成 Meme 分析报告。" : "Meme analysis report ready.",
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

const LAUNCH_DRAFT_TOKEN_FIELDS = Object.freeze([
  "name",
  "symbol",
  "description",
  "image_url",
  "x_url",
  "website_url",
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
      review_status: "reviewed",
      reviewed_at: new Date().toISOString(),
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

export function createAgentRuntime(options = {}) {
  const config = options.config || {};
  const integrations = options.integrations || createIntegrationRegistry(config);
  const supabase = options.supabase || null;

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

  const manager =
    options.taskManager ||
    new TaskManager({
      repository: tasks,
      handlers: createMockHandlers(integrations, {
        devWalletRepository: devWallets,
        launchDraftRepository: launchDrafts,
      }),
      stepDelayMs: options.stepDelayMs ?? config.taskStepDelayMs ?? 20,
    });

  manager.on("taskEvent", (event) => {
    void (async () => {
      if (event.type !== "task.completed" && event.type !== "task.failed") return;
      const task = event.task;
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
          executable: false,
          submitted: false,
          reason: "real_execution_disabled",
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
      },
    });

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
    const task = await manager.create(parsed.type, parsed.input, requestId, {
      ...parsed.metadata,
      conversation_id: conversation.conversationId,
      channel,
    });
    await conversations.bindTask(conversation.conversationId, task.taskId);

    let finalTask = publicTask(task);
    let assistantMessage = null;
    if (wait) {
      const completed = await waitForTask(task.taskId, { timeoutMs });
      finalTask = publicTask(completed);
      assistantMessage = messageFromTask(completed, validated.context.language);
    }

    return {
      schema_version: "agent.runtime.v1",
      channel,
      conversation_id: conversation.conversationId,
      task_id: task.taskId,
      status: finalTask?.status || task.status,
      wait,
      task: finalTask,
      message: assistantMessage,
      cards: finalTask?.result?.card
        ? [finalTask.result.card]
        : Array.isArray(finalTask?.result?.cards)
          ? finalTask.result.cards
          : [],
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
    publicTask,
  };
}

export default createAgentRuntime;
