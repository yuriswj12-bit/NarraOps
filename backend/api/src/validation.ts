// @ts-nocheck
import { ApiError } from "./errors.ts";
import { containsForbiddenSecret } from "./security.ts";
import { parseGoInput } from "../../agents/go-command-parser.ts";
import { policyForType } from "../../agents/go-command-catalog.ts";

const TASK_TYPES = new Set([
  "agent.chat",
  "narrative.scan",
  "narrative.generate",
  "narrative.recommend",
  "meme.create",
  "wallet.group.create",
  "launch.package",
  "launch.meme",
  "trade.buy.batch",
  "trade.sell.batch",
  "funds.transfer",
  "funds.withdraw",
  "dev.market.scan",
  "narrative.trends",
  "meme.analyze",
  "account.recent-summary",
]);
const CHAINS = new Set(["solana", "bsc", "robinhood"]);
const PORTFOLIO_PERIODS = new Set(["1d", "3d", "7d", "30d", "90d", "all"]);
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,18})?$/;

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
  if (!CHAINS.has(chain)) throw new ApiError(400, "VALIDATION_ERROR", "chain must be solana, bsc, or robinhood");
  return { narrativeId, draft, chain, platform: string(body.platform, "platform", { max: 80 }) };
}

export function validateLaunchDraft(body) {
  base(body);
  const chain = string(body.chain, "chain", { required: true, max: 30 });
  if (!CHAINS.has(chain)) throw new ApiError(400, "VALIDATION_ERROR", "chain must be solana, bsc, or robinhood");
  const token = body.token == null ? {} : body.token;
  if (!isObject(token)) throw new ApiError(400, "VALIDATION_ERROR", "token must be an object");
  base(token);
  return {
    chain,
    platform: string(body.platform, "platform", { max: 80 }),
    narrative_url: string(body.narrative_url, "narrative_url", { max: 2_000 }),
    token: {
      name: string(token.name, "token.name", { max: 32 }),
      symbol: string(token.symbol, "token.symbol", { max: 13 }),
      description: string(token.description, "token.description", { max: 2_000 }),
      image_url: string(token.image_url, "token.image_url", { max: 2_000 }),
      x_url: string(token.x_url, "token.x_url", { max: 2_000 }),
      website_url: string(token.website_url, "token.website_url", { max: 2_000 }),
    },
    dev_wallet_id: string(body.dev_wallet_id, "dev_wallet_id", { max: 100 }),
    wallet_group_id: string(body.wallet_group_id, "wallet_group_id", { max: 100 }),
  };
}

const LAUNCH_PLATFORMS = new Set(["pump", "fourmeme"]);
const BASE64_IMAGE_PATTERN = /^(?:data:image\/[a-zA-Z0-9.+-]+;base64,)?[A-Za-z0-9+/]+={0,2}$/;

export function validateFourMemeNonce(body) {
  base(body);
  return { address: string(body.address, "address", { required: true, max: 42 }) };
}

export function validateLaunchTransactionPlan(body) {
  base(body);
  const platform = string(body.platform, "platform", { required: true, max: 20 });
  if (!LAUNCH_PLATFORMS.has(platform)) throw new ApiError(400, "VALIDATION_ERROR", "platform must be pump or fourmeme");
  const imageBase64 = string(body.imageBase64, "imageBase64", { max: 8_000_000 });
  const metadataUri = string(body.metadataUri, "metadataUri", { max: 2_000 });
  if (!imageBase64 && !metadataUri) throw new ApiError(400, "VALIDATION_ERROR", "imageBase64 or metadataUri is required");
  if (imageBase64 && !BASE64_IMAGE_PATTERN.test(imageBase64)) throw new ApiError(400, "VALIDATION_ERROR", "imageBase64 must contain a base64-encoded image");
  const developerBuyAmount = string(body.developerBuyAmount ?? "0", "developerBuyAmount", { required: true, max: 40 });
  if (!MONEY_PATTERN.test(developerBuyAmount)) throw new ApiError(400, "VALIDATION_ERROR", "developerBuyAmount must be a non-negative decimal string");
  const result = {
    platform,
    walletAddress: string(body.walletAddress, "walletAddress", { required: true, max: 64 }),
    name: string(body.name, "name", { required: true, max: 32 }),
    symbol: string(body.symbol, "symbol", { required: true, max: 10 }),
    description: string(body.description, "description", { max: 1_000 }) || "",
    imageBase64,
    metadataUri,
    imageName: string(body.imageName, "imageName", { max: 120 }) || "cooking.png",
    imageType: string(body.imageType, "imageType", { max: 80 }) || "image/png",
    twitter: string(body.twitter, "twitter", { max: 500 }) || "",
    telegram: string(body.telegram, "telegram", { max: 500 }) || "",
    website: string(body.website, "website", { max: 500 }) || "",
    developerBuyAmount,
  };
  if (platform === "fourmeme") result.loginSignature = string(body.loginSignature, "loginSignature", { required: true, max: 300 });
  return result;
}

export function validateInternalLaunchPrepare(body) {
  const input = validateLaunchTransactionPlan({ ...body, walletAddress: body.walletAddress || (body.platform === "pump" ? "11111111111111111111111111111111" : "0x0000000000000000000000000000000000000000"), ...(body.platform === "fourmeme" ? { loginSignature: body.loginSignature || "internal" } : {}) });
  delete input.walletAddress;
  delete input.loginSignature;
  const rawBoundBuy = body.boundBuy;
  if (!isObject(rawBoundBuy) || typeof rawBoundBuy.enabled !== "boolean") throw new ApiError(400, "VALIDATION_ERROR", "boundBuy.enabled must be a boolean");
  let boundBuy = { enabled: false };
  if (rawBoundBuy.enabled) {
    if (!isObject(rawBoundBuy.allocation)) throw new ApiError(400, "VALIDATION_ERROR", "boundBuy.allocation must be an object");
    const allocationMode = string(rawBoundBuy.allocation.mode, "boundBuy.allocation.mode", { required: true, max: 30 });
    let allocation;
    if (allocationMode === "PER_WALLET_EQUAL") {
      const amountPerWallet = string(rawBoundBuy.allocation.amountPerWallet, "boundBuy.allocation.amountPerWallet", { required: true, max: 40 });
      if (!MONEY_PATTERN.test(amountPerWallet) || Number(amountPerWallet) <= 0) throw new ApiError(400, "VALIDATION_ERROR", "boundBuy per-wallet amount must be positive");
      allocation = { mode: allocationMode, amountPerWallet };
    } else if (allocationMode === "TOTAL_RANDOM") {
      const totalAmount = string(rawBoundBuy.allocation.totalAmount, "boundBuy.allocation.totalAmount", { required: true, max: 40 });
      if (!MONEY_PATTERN.test(totalAmount) || Number(totalAmount) <= 0) throw new ApiError(400, "VALIDATION_ERROR", "boundBuy random total amount must be positive");
      allocation = { mode: allocationMode, totalAmount };
    } else if (allocationMode === "PER_WALLET_CUSTOM") {
      const custom = rawBoundBuy.allocation.customAmounts;
      if (!Array.isArray(custom) || !custom.length || custom.length > 100) throw new ApiError(400, "VALIDATION_ERROR", "boundBuy customAmounts must contain 1-100 wallets");
      const seen = new Set();
      const customAmounts = custom.map((entry, index) => {
        if (!isObject(entry)) throw new ApiError(400, "VALIDATION_ERROR", `boundBuy customAmounts[${index}] must be an object`);
        const walletId = string(entry.walletId, `boundBuy.customAmounts[${index}].walletId`, { required: true, max: 128 });
        const amount = string(entry.amount, `boundBuy.customAmounts[${index}].amount`, { required: true, max: 40 });
        if (seen.has(walletId)) throw new ApiError(400, "VALIDATION_ERROR", "boundBuy custom wallet IDs must be unique");
        if (!MONEY_PATTERN.test(amount) || Number(amount) <= 0) throw new ApiError(400, "VALIDATION_ERROR", "Every custom bound-buy amount must be positive");
        seen.add(walletId); return { walletId, amount };
      });
      allocation = { mode: allocationMode, customAmounts };
    } else throw new ApiError(400, "VALIDATION_ERROR", "boundBuy allocation must be equal per-wallet, fixed-total random, or custom per-wallet");
    const slippageBps = Number(rawBoundBuy.slippageBps ?? 500);
    if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) throw new ApiError(400, "VALIDATION_ERROR", "boundBuy slippageBps must be between 1 and 5000");
    boundBuy = { enabled: true, walletGroupId: string(rawBoundBuy.walletGroupId, "boundBuy.walletGroupId", { required: true, max: 64 }), window: { earliestBlockOffset: 1, latestBlockOffset: 5 }, allocation, slippageBps };
  }
  return {
    ...input,
    cookingWalletGroupId: string(body.cookingWalletGroupId, "cookingWalletGroupId", { required: true, max: 64 }),
    boundBuy,
  };
}

export function validateLaunchConfirm(body) {
  base(body);
  return { confirmationToken: string(body.confirmationToken, "confirmationToken", { required: true, max: 100 }) };
}

export function validateAgentTask(body) {
  base(body);
  const goText = typeof body.command === "string"
    ? body.command
    : typeof body.input === "string"
      ? body.input
      : typeof body.message === "string"
        ? body.message
        : null;
  if (goText !== null) {
    const parsed = parseGoInput(goText);
    const parameters = body.parameters ?? {};
    if (!isObject(parameters)) throw new ApiError(400, "VALIDATION_ERROR", "parameters must be an object");
    base(parameters);
    return {
      type: parsed.type,
      input: { ...parameters, prompt: parsed.arguments, agent_input: parsed },
      metadata: parsed,
    };
  }

  const type = string(body.type, "type", { required: true, max: 100 });
  if (!TASK_TYPES.has(type)) {
    throw new ApiError(400, "VALIDATION_ERROR", `type must be one of: ${[...TASK_TYPES].join(", ")}`);
  }
  if (body.input != null && !isObject(body.input)) {
    throw new ApiError(400, "VALIDATION_ERROR", "input must be an object");
  }
  base(body.input ?? {});
  const policy = policyForType(type);
  return {
    type,
    input: body.input ?? {},
    metadata: {
      type,
      category: policy.category,
      command: null,
      raw_input: null,
      parsed_by: "explicit_type",
      requires_confirmation: policy.requires_confirmation,
      execution_mode: policy.execution_mode,
    },
  };
}

export function validateConversationCreate(body) {
  base(body);
  const context = isObject(body.context) ? body.context : {};
  base(context);
  return {
    language: context.language === "zh" ? "zh" : "en",
    currentView: string(context.currentView, "context.currentView", { max: 50 }) || "go",
    projectId: string(context.projectId, "context.projectId", { max: 100 }),
  };
}

export function validateConversationMessage(body) {
  base(body);
  const message = string(body.message, "message", { required: true, max: 8_000 });
  const command = string(body.command, "command", { max: 200 });
  const context = isObject(body.context) ? body.context : {};
  base(context);
  return {
    message,
    command,
    context: {
      language: context.language === "zh" ? "zh" : "en",
      currentView: string(context.currentView, "context.currentView", { max: 50 }) || "go",
      projectId: string(context.projectId, "context.projectId", { max: 100 }),
    },
  };
}

export function validatePortfolioPeriod(value) {
  const period = value || "7d";
  if (!PORTFOLIO_PERIODS.has(period)) {
    throw new ApiError(400, "VALIDATION_ERROR", "period must be 1d, 3d, 7d, 30d, 90d, or all");
  }
  return period;
}

function integer(value, field, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function walletIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new ApiError(400, "VALIDATION_ERROR", "walletIds must contain between 1 and 200 wallet IDs");
  }
  const normalized = value.map((entry, index) => string(entry, `walletIds[${index}]`, { required: true, max: 100 }));
  if (new Set(normalized).size !== normalized.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "walletIds must not contain duplicates");
  }
  return normalized;
}

function idempotencyKey(value) {
  const normalized = string(value, "idempotencyKey", { required: true, max: 128 });
  if (normalized.length < 8) throw new ApiError(400, "VALIDATION_ERROR", "idempotencyKey must contain at least 8 characters");
  return normalized;
}

export function validateWalletGroupCreate(body) {
  base(body);
  const purpose = string(body.purpose || "general", "purpose", { required: true, max: 20 });
  if (!["general", "cooking"].includes(purpose)) throw new ApiError(400, "VALIDATION_ERROR", "purpose must be general or cooking");
  const network = string(body.network || "solana", "network", { required: true, max: 20 });
  if (!["solana", "evm"].includes(network)) throw new ApiError(400, "VALIDATION_ERROR", "network must be solana or evm");
  const walletCount = integer(body.walletCount, "walletCount", { min: 1, max: 100 });
  if (purpose === "cooking" && walletCount !== 1) throw new ApiError(400, "COOKING_WALLET_COUNT_INVALID", "A cooking wallet group must contain exactly one wallet");
  return {
    name: string(body.name, "name", { required: true, max: 80 }),
    purpose,
    network,
    walletCount,
  };
}

export function validateWalletAdd(body) {
  base(body);
  return { count: integer(body.count, "count", { min: 1, max: 100 }) };
}

export function validateWalletBatchDelete(body) {
  base(body);
  const normalized = { walletIds: walletIds(body.walletIds) };
  if (body.confirm === true || body.confirmationToken != null || body.recoveryStrategy != null) {
    normalized.confirm = body.confirm === true;
    normalized.confirmationToken = string(body.confirmationToken, "confirmationToken", { required: true, max: 100 });
    normalized.recoveryStrategy = string(body.recoveryStrategy, "recoveryStrategy", { required: true, max: 80 });
    if (!normalized.confirm) throw new ApiError(400, "VALIDATION_ERROR", "confirm must be true for the second delete request");
  }
  return normalized;
}

export function validateWalletExport(body) {
  base(body);
  if (body.confirmExport !== true) {
    throw new ApiError(400, "EXPORT_CONFIRMATION_REQUIRED", "confirmExport must be true");
  }
  return {
    confirmExport: true,
    reason: string(body.reason, "reason", { max: 500 }),
  };
}

function transferEndpoint(value, field) {
  if (!isObject(value)) throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an object`);
  base(value);
  const allowed = new Set(["login_wallet", "wallet_group"]);
  const type = string(value.type, `${field}.type`, { required: true, max: 30 });
  if (!allowed.has(type)) throw new ApiError(400, "VALIDATION_ERROR", `${field}.type is not supported`);
  const id = string(value.id, `${field}.id`, { max: 100 });
  const address = string(value.address, `${field}.address`, { max: 100 });
  if (type === "wallet_group" && !id) throw new ApiError(400, "VALIDATION_ERROR", `${field}.id is required for wallet_group`);
  if (type === "login_wallet" && id) throw new ApiError(400, "VALIDATION_ERROR", `${field}.id must be omitted for login_wallet`);
  return { type, ...(id ? { id } : {}), ...(address ? { address } : {}) };
}

export function validateTransferPreview(body) {
  base(body);
  const chain = string(body.chain, "chain", { required: true, max: 20 });
  if (!new Set(["solana", "bsc"]).has(chain)) throw new ApiError(400, "VALIDATION_ERROR", "chain must be solana or bsc");
  const source = transferEndpoint(body.source, "source");
  const destination = transferEndpoint(body.destination, "destination");
  if (source.type === "login_wallet" && destination.type === "login_wallet") {
    throw new ApiError(400, "VALIDATION_ERROR", "source and destination cannot both be login_wallet");
  }
  if (source.type === "wallet_group" && source.id === destination.id) {
    throw new ApiError(400, "VALIDATION_ERROR", "source and destination wallet groups must differ");
  }
  if (destination.type === "login_wallet" && !destination.address) {
    throw new ApiError(400, "VALIDATION_ERROR", "destination.address is required when withdrawing to a login wallet");
  }
  const amountMode = string(body.amountMode, "amountMode", { required: true, max: 20 });
  if (!new Set(["fraction", "amount"]).has(amountMode)) {
    throw new ApiError(400, "VALIDATION_ERROR", "amountMode must be fraction or amount");
  }
  const distribution = string(body.distribution, "distribution", { required: true, max: 20 });
  if (!new Set(["random", "equal"]).has(distribution)) {
    throw new ApiError(400, "VALIDATION_ERROR", "distribution must be random or equal");
  }
  let fractionBps;
  let amount;
  if (amountMode === "fraction") {
    fractionBps = integer(body.fractionBps, "fractionBps", { min: 1, max: 10_000 });
    if (body.amount != null) throw new ApiError(400, "VALIDATION_ERROR", "amount must be omitted when amountMode is fraction");
  } else {
    amount = string(body.amount, "amount", { required: true, max: 40 });
    if (!MONEY_PATTERN.test(amount) || /^0+(?:\.0+)?$/.test(amount)) {
      throw new ApiError(400, "VALIDATION_ERROR", "amount must be a positive decimal string");
    }
    if (body.fractionBps != null) throw new ApiError(400, "VALIDATION_ERROR", "fractionBps must be omitted when amountMode is amount");
  }
  return {
    chain,
    source,
    destination,
    amountMode,
    ...(fractionBps ? { fractionBps } : {}),
    ...(amount ? { amount } : {}),
    distribution,
    idempotencyKey: idempotencyKey(body.idempotencyKey),
  };
}

export function validateTransferSubmit(body, headerIdempotencyKey) {
  base(body);
  const normalizedHeader = typeof headerIdempotencyKey === "string" ? headerIdempotencyKey.trim() : "";
  if (!normalizedHeader) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
  const normalized = {
    previewToken: string(body.previewToken, "previewToken", { required: true, max: 100 }),
    confirmationToken: string(body.confirmationToken, "confirmationToken", { required: true, max: 100 }),
    idempotencyKey: idempotencyKey(body.idempotencyKey),
  };
  if (normalizedHeader !== normalized.idempotencyKey) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_MISMATCH", "Idempotency-Key header must equal body idempotencyKey");
  }
  return normalized;
}
