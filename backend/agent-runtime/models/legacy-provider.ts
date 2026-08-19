import {
  generateAgentReply,
  generateStructuredLaunchContent,
  getLlmProviderStatus,
} from "../../agents/llm-provider.ts";
import type {
  ModelCapabilities,
  ModelHealth,
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../contracts/model.ts";

/**
 * Compatibility adapter only. It lets Runtime v2 consume the current
 * OpenAI-compatible helper without leaking provider-specific calls into new
 * business code. A later provider adapter can replace it without changing
 * tasks, tools, approvals, or cards.
 */
export class LegacyNarraOpsModelProvider implements ModelProvider {
  readonly id = "openai-compatible";
  readonly capabilities: ModelCapabilities = Object.freeze({
    structuredOutput: true,
    toolCalling: false,
    streaming: false,
    vision: false,
  });

  async generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) throw signal.reason;
    if (request.operation === "launch.content") {
      const input = request.input || {};
      const result = await (generateStructuredLaunchContent as any)({
        prompt: String(input.prompt || ""),
        sourceText: String(input.sourceText || input.source_text || ""),
        language: request.metadata.locale.startsWith("zh") ? "zh" : "en",
      });
      return {
        provider: result.provider || this.id,
        model: result.model || getLlmProviderStatus().model,
        structuredOutput: result.content,
        finishReason: result.used_llm ? "stop" : result.error || "fallback",
      };
    }
    if (request.operation === "agent.reply") {
      const input = request.input || {};
      const result: any = await (generateAgentReply as any)({
        message: String(input.message || ""),
        language: request.metadata.locale.startsWith("zh") ? "zh" : "en",
        history: Array.isArray(input.history) ? input.history : [],
        task: input.task || null,
        capabilities: Array.isArray(input.capabilities) ? input.capabilities : undefined,
        runtimeInstructions: String(input.runtimeInstructions || ""),
        durableMemories: Array.isArray(input.durableMemories)
          ? input.durableMemories
          : [],
        timeoutMs: Number(input.timeoutMs || 3_000),
      });
      return {
        provider: result.provider || this.id,
        model: result.model || getLlmProviderStatus().model,
        content: result.content,
        structuredOutput: {
          content: result.content,
          suggestion: result.suggestion,
        },
        finishReason: result.used_llm ? "stop" : result.fallback_reason || "fallback",
      };
    }
    throw new Error(`Unsupported legacy model operation: ${request.operation}`);
  }

  async health(): Promise<ModelHealth> {
    const status = getLlmProviderStatus();
    return {
      ok: true,
      configured: Boolean(status.configured),
      detail: status.configured ? `${status.provider}:${status.model}` : "deterministic fallback",
    };
  }
}
