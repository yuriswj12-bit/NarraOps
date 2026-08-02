// @ts-nocheck
/**
 * OpenAI-compatible provider for Go Agent conversation and content generation.
 * Never executes funds. Fail closed to an explicit safe fallback.
 */
export async function generateStructuredLaunchContent({
  prompt,
  sourceText = "",
  language = "en",
} = {}) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";

  if (!apiKey) {
    return {
      provider: "template",
      used_llm: false,
      content: templateLaunchContent({ prompt, sourceText, language }),
    };
  }

  const system = [
    "You are NarraOps Go Agent content generator.",
    "Return ONLY valid JSON with keys: name, symbol, description, narrative_thesis, risk_notes.",
    "symbol must be 3-10 uppercase letters/numbers.",
    "Do not include private keys, wallets, or execution instructions.",
    "Keep description under 280 characters.",
  ].join(" ");

  const user = JSON.stringify({
    language,
    prompt,
    source_text: sourceText?.slice?.(0, 1200) || "",
  });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return {
        provider: "template",
        used_llm: false,
        content: templateLaunchContent({ prompt, sourceText, language }),
        error: `llm_http_${response.status}`,
      };
    }
    const payload = await response.json();
    const raw = payload?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const content = normalizeLaunchContent(parsed, { prompt, sourceText, language });
    return {
      provider: "openai_compatible",
      used_llm: true,
      model,
      content,
    };
  } catch (error) {
    return {
      provider: "template",
      used_llm: false,
      content: templateLaunchContent({ prompt, sourceText, language }),
      error: error instanceof Error ? error.name : "llm_error",
    };
  }
}

const DEFAULT_AGENT_CAPABILITIES = Object.freeze([
  "解释 NarraOps 能力和当前工作区状态",
  "根据公开叙事生成可审阅的 narrative / meme 草案",
  "读取已接入的只读行情、开发者钱包和 Meme 分析工具结果",
  "生成 review-only launch draft 和风险清单",
  "模拟交易、转账和提现计划，但不签名、不广播、不动用资金",
]);

export function getLlmProviderStatus() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
  const baseUrl = (process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o-mini";
  return {
    configured: Boolean(apiKey),
    provider: apiKey ? "openai_compatible" : "fallback",
    base_url: baseUrl,
    model,
  };
}

export async function generateAgentReply({
  message = "",
  language = "en",
  history = [],
  task = null,
  capabilities = DEFAULT_AGENT_CAPABILITIES,
} = {}) {
  const status = getLlmProviderStatus();
  if (!status.configured) {
    return {
      provider: "fallback",
      used_llm: false,
      configured: false,
      fallback_reason: "missing_provider_key",
      ...fallbackAgentReply({ message, language, task, capabilities }),
    };
  }

  const system = [
    "You are the NarraOps Agent, a Chinese-first AI assistant for meme narrative research and review-only launch planning.",
    "Answer naturally and directly. Use the task result as the only source of current workspace data.",
    "Never invent live prices, wallet balances, social evidence, or completed actions.",
    "If a result says mock, data-gap, disabled, or review-only, say that clearly.",
    "Real signing, broadcasting, fund movement, and token launch are disabled. Never claim they happened.",
    "Return ONLY valid JSON with exactly two string keys: content and suggestion.",
    "Keep content under 1,200 characters and suggestion under 240 characters.",
  ].join(" ");
  const context = JSON.stringify({
    language: language === "zh" ? "zh" : "en",
    user_message: String(message).slice(0, 8_000),
    capabilities,
    task: task ? sanitizeAgentTask(task) : null,
  });
  const prior = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.role === "user" || entry?.role === "assistant")
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content || "").slice(0, 2_000),
    }))
    .filter((entry) => entry.content)
    .slice(-8);
  if (!prior.length || prior.at(-1)?.role !== "user" || prior.at(-1)?.content !== message) {
    prior.push({ role: "user", content: String(message).slice(0, 8_000) });
  }

  try {
    const response = await fetch(`${status.base_url}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENAI_API_KEY || process.env.LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: status.model,
        temperature: 0.35,
        max_tokens: 1_200,
        stream: false,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          ...prior,
          { role: "user", content: `Use this NarraOps context to answer the latest user message:\n${context}` },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      return {
        provider: "fallback",
        used_llm: false,
        configured: true,
        model: status.model,
        fallback_reason: `llm_http_${response.status}`,
        ...fallbackAgentReply({ message, language, task, capabilities }),
      };
    }
    const payload = await response.json();
    const parsed = parseJsonObject(payload?.choices?.[0]?.message?.content);
    return {
      provider: "openai_compatible",
      used_llm: true,
      configured: true,
      model: status.model,
      content: normalizeReplyText(parsed?.content, fallbackAgentReply({ message, language, task, capabilities }).content, 1_200),
      suggestion: normalizeReplyText(parsed?.suggestion, fallbackAgentReply({ message, language, task, capabilities }).suggestion, 240),
    };
  } catch (error) {
    return {
      provider: "fallback",
      used_llm: false,
      configured: true,
      model: status.model,
      fallback_reason: error instanceof Error ? error.name : "llm_error",
      ...fallbackAgentReply({ message, language, task, capabilities }),
    };
  }
}

function sanitizeAgentTask(task) {
  return {
    type: task?.type || null,
    status: task?.status || null,
    execution_mode: task?.execution_mode || task?.executionMode || null,
    result: task?.result ? boundedJsonValue(task.result, 12_000) : null,
    failure: task?.failure || null,
  };
}

function boundedJsonValue(value, maxChars) {
  const raw = JSON.stringify(value);
  if (raw.length <= maxChars) return value;
  return {
    truncated: true,
    summary: raw.slice(0, maxChars),
  };
}

function parseJsonObject(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "{}").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    try { return match ? JSON.parse(match[0]) : {}; } catch { return {}; }
  }
}

function normalizeReplyText(value, fallback, max) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, max);
}

function fallbackAgentReply({ message, language, task, capabilities }) {
  const zh = language === "zh";
  const input = String(message || "").toLowerCase();
  const capabilityQuestion = /你可以做什么|你能做什么|能做什么|有什么功能|help|what can you do|capabilit/.test(input);
  const taskResult = task?.result || {};
  const isLiveReport = taskResult?.mode === "live"
    && (taskResult?.report || taskResult?.forensic_report || taskResult?.machine_report);
  const isForensicReport = taskResult?.source === "hertzflow"
    && (taskResult?.report || taskResult?.forensic_report || taskResult?.machine_report);
  if (capabilityQuestion || task?.type === "agent.chat") {
    return {
      content: zh
        ? `我是 NarraOps Agent，可以做叙事发现、GMGN 只读行情、HertzFlow SOL Meme 链上取证报告、开发者钱包分析、风险整理和 review-only 方案。${getLlmProviderStatus().configured ? "当前模型暂时未返回，已使用结构化结果安全降级。" : "当前部署没有配置真实模型密钥，已使用结构化结果安全降级。"}`
        : `I’m the NarraOps Agent. I can do narrative discovery, read-only GMGN market research, HertzFlow Solana meme forensic reports, developer-wallet analysis, risk review, and review-only plans. ${getLlmProviderStatus().configured ? "The model did not return in time, so I used the structured result safely." : "No model key is configured, so I used the structured result safely."}`,
      suggestion: zh ? "可以直接输入：分析某个 Solana Meme 地址，或继续追问主控集群、分发路径和优先监控地址。" : "Ask me to analyze a Solana meme address, or follow up on clusters, distribution paths, and watchlist addresses.",
    };
  }
  if (isLiveReport) {
    const verdict = taskResult.verdict || {};
    const metrics = taskResult.metrics || {};
    return {
      content: zh
        ? `HertzFlow 报告已生成。已基于最新 GMGN 样本完成持仓集中度、MM/机器人命中、分发/套现关系、地址集群和监控清单分析。结论：${verdict.one_liner || "请查看下方报告卡。"} 当前仅执行只读分析，不会签名、广播或移动资金。`
        : `The HertzFlow report is ready. It used a fresh GMGN sample to analyze concentration, MM/bot hits, distribution and cash-out relationships, address clusters, and a watchlist. Conclusion: ${verdict.one_liner || "See the report card below."} This was read-only; no signing, broadcasting, or fund movement occurred.`,
      suggestion: zh
        ? `可继续追问：主关系集群是谁？哪些地址优先监控？可见套现下限是多少？`
        : "You can ask which cluster is dominant, which addresses are P0, or what the visible cash-out lower bound is.",
    };
  }
  if (isForensicReport) {
    const reason = taskResult?.data_gap || taskResult?.reason || "GMGN 没有返回足够的 holder/trader 样本";
    return {
      content: zh
        ? `HertzFlow 已执行，但这次没有生成可下结论的链上报告：${reason}。报告卡已保留数据缺口和限制，不会编造风险分或地址关系。当前仅执行只读分析。`
        : `HertzFlow ran, but this request did not return enough wallet evidence for a conclusion: ${reason}. The report card keeps the data gaps and limitations instead of inventing a risk score or wallet relationships. This was read-only.`,
      suggestion: zh
        ? "请确认合约地址正确，或换一个有活跃 holders/traders 的 Solana Meme 地址重试。"
        : "Check the contract address, or retry with an active Solana meme that has holder/trader samples.",
    };
  }
  const mode = taskResult?.mode || task?.execution_mode || task?.executionMode || "fallback";
  const configuredMessage = getLlmProviderStatus().configured
    ? (zh ? "模型暂时超时或返回错误，已保留结构化结果。" : "The configured model timed out or returned an error; the structured result is preserved.")
    : (zh ? "当前没有配置真实模型密钥，已返回安全的结构化结果。" : "No model key is configured, so a safe structured result was returned.");
  return {
    content: zh
      ? `我已按受控流程处理这条请求，但${configuredMessage}结果模式：${mode}。不会执行签名、广播或资金操作。`
      : `I processed this request through the controlled workflow, but ${configuredMessage} Result mode: ${mode}. No signing, broadcasting, or fund movement was performed.`,
    suggestion: zh ? "可以继续追问结构化结果中的风险、关系集群或监控地址。" : "You can follow up on the risks, relationship clusters, or watchlist in the structured result.",
  };
}

function templateLaunchContent({ prompt, sourceText, language }) {
  const base = String(sourceText || prompt || "Narra meme").trim();
  const words = base
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  const titleSeed = words.slice(0, 4).join(" ") || "Narra Meme";
  const symbolSeed = (words.find((w) => /^[a-zA-Z]{3,10}$/.test(w)) || "NARRA").toUpperCase().slice(0, 8);
  const zh = language === "zh";
  return {
    name: titleSeed.slice(0, 48),
    symbol: symbolSeed,
    description: zh
      ? `${titleSeed}：基于公开叙事整理的可审阅 Meme 发射预案。`
      : `${titleSeed}: a review-only meme launch draft prepared from public narrative evidence.`,
    narrative_thesis: base.slice(0, 240),
    risk_notes: [
      zh ? "内容由 Agent 生成，需人工审阅" : "Agent-generated content requires human review",
      zh ? "真实发射默认关闭" : "Live launch remains disabled by default",
    ],
  };
}

function normalizeLaunchContent(value, fallbackInput) {
  const fallback = templateLaunchContent(fallbackInput);
  const symbol = String(value?.symbol || fallback.symbol)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10) || fallback.symbol;
  return {
    name: String(value?.name || fallback.name).slice(0, 64),
    symbol,
    description: String(value?.description || fallback.description).slice(0, 280),
    narrative_thesis: String(value?.narrative_thesis || fallback.narrative_thesis).slice(0, 400),
    risk_notes: Array.isArray(value?.risk_notes) && value.risk_notes.length
      ? value.risk_notes.map((item) => String(item).slice(0, 160)).slice(0, 5)
      : fallback.risk_notes,
  };
}

export default {
  generateStructuredLaunchContent,
  generateAgentReply,
  getLlmProviderStatus,
};
