// @ts-nocheck
/**
 * Optional OpenAI-compatible LLM provider for Go Agent content generation.
 * Never executes funds. Fail closed to deterministic templates.
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
};
