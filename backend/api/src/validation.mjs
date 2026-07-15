import { ApiError } from "./errors.mjs";
import { containsForbiddenSecret } from "./security.mjs";

const TASK_TYPES = new Set(["narrative.scan", "narrative.generate", "launch.package"]);
const CHAINS = new Set(["solana", "bsc"]);

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function string(value, field, { required = false, max = 2_000 } = {}) {
  if (value == null || value === "") {
    if (required) throw new ApiError(400, "VALIDATION_ERROR", `${field} is required`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a string up to ${max} characters`);
  }
  return value.trim();
}

function base(body) {
  if (!isObject(body)) throw new ApiError(400, "VALIDATION_ERROR", "Request body must be a JSON object");
  if (containsForbiddenSecret(body)) {
    throw new ApiError(400, "SENSITIVE_INPUT_REJECTED", "Private keys, seed phrases, tokens, cookies, and API keys are not accepted");
  }
}

export function validateNarrativeScan(body) {
  base(body);
  const query = string(body.query, "query", { max: 500 });
  const sources = body.sources ?? [];
  if (!Array.isArray(sources) || sources.length > 50) {
    throw new ApiError(400, "VALIDATION_ERROR", "sources must be an array with at most 50 entries");
  }
  const normalizedSources = sources.map((source, index) => {
    if (!isObject(source)) throw new ApiError(400, "VALIDATION_ERROR", `sources[${index}] must be an object`);
    return {
      platform: string(source.platform, `sources[${index}].platform`, { required: true, max: 40 }),
      handle: string(source.handle, `sources[${index}].handle`, { required: true, max: 200 }),
      focus: string(source.focus, `sources[${index}].focus`, { max: 500 }),
    };
  });
  if (!query && normalizedSources.length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Provide query or at least one source");
  }
  return { query, sources: normalizedSources, language: body.language === "zh" ? "zh" : "en" };
}

export function validateNarrativeGenerate(body) {
  base(body);
  const brief = string(body.brief, "brief", { max: 4_000 });
  const signalId = string(body.signalId, "signalId", { max: 100 });
  if (!brief && !signalId) throw new ApiError(400, "VALIDATION_ERROR", "brief or signalId is required");
  return { brief, signalId, language: body.language === "zh" ? "zh" : "en" };
}

export function validateLaunchPackage(body) {
  base(body);
  const narrativeId = string(body.narrativeId, "narrativeId", { max: 100 });
  const draft = isObject(body.draft) ? body.draft : undefined;
  if (!narrativeId && !draft) throw new ApiError(400, "VALIDATION_ERROR", "narrativeId or draft is required");
  const chain = body.chain ?? "solana";
  if (!CHAINS.has(chain)) throw new ApiError(400, "VALIDATION_ERROR", "chain must be solana or bsc");
  return { narrativeId, draft, chain, platform: string(body.platform, "platform", { max: 80 }) };
}

export function validateAgentTask(body) {
  base(body);
  const type = string(body.type, "type", { required: true, max: 100 });
  if (!TASK_TYPES.has(type)) {
    throw new ApiError(400, "VALIDATION_ERROR", `type must be one of: ${[...TASK_TYPES].join(", ")}`);
  }
  if (body.input != null && !isObject(body.input)) {
    throw new ApiError(400, "VALIDATION_ERROR", "input must be an object");
  }
  base(body.input ?? {});
  return { type, input: body.input ?? {} };
}
