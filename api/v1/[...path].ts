// @ts-nocheck
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { getAddress, verifyMessage, Wallet } from "ethers";
import { buildPulsePlanResponse } from "./go/pulse-plan";
import { buildNarrativeSnapshotPlanResponse } from "./go/narrative-snapshot-plan";
import { loadPulseMarketResponse } from "./pulse-market";
import { loadPulseDevWalletPnlResponse } from "./pulse-dev-wallet-pnl";
import {
  dismissPulseNarrative,
  loadPulseNarrativesResponse,
  usePulseNarrative,
} from "./pulse-narratives";
import {
  createAgentConversation,
  createAgentTask,
  getAgentCapabilities,
  getAgentTask,
  listAgentTaskEvents,
  cancelAgentTask,
  getAgentConversation,
  handleTelegramWebhook,
  getSharedAgentRuntime,
  postAgentConversationMessage,
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
  proposeAgentMemory,
  decideAgentMemory,
  forgetAgentMemory,
  listAgentMemories,
  updateAgentLaunchDraft,
} from "./agent/runtime.cjs";

const COOKIE_NAME = "narraops_session";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function sendJson(response, status, body, headers = {}) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

function apiError(response, status, code, message) {
  sendJson(response, status, { error: { code, message } });
}

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

let launchPlannerSingleton = null;
let launchPlannerModulePromise = null;
let solanaWeb3ModulePromise = null;

function withHardTimeout(promise, timeoutMs, label = "operation") {
  const ms = Math.max(500, Number(timeoutMs) || 8000);
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


async function directLaunchPlanner() {
  if (!launchPlannerSingleton) {
    const { LaunchPlanningService } = await (launchPlannerModulePromise ||= import("./launch-planner.cjs"));
    launchPlannerSingleton = new LaunchPlanningService({
      solanaRpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
      pumpMetadataUploadUrl: process.env.PUMP_METADATA_UPLOAD_URL || "https://pump.fun/api/ipfs",
      pinataJwt: process.env.PINATA_JWT || undefined,
      pinataGatewayUrl: process.env.PINATA_GATEWAY_URL || "https://gateway.pinata.cloud/ipfs",
    });
  }
  return launchPlannerSingleton;
}

function solanaWeb3() {
  return (solanaWeb3ModulePromise ||= import("@solana/web3.js"));
}

async function imageUrlToDataUrl(imageUrl) {
  const url = String(imageUrl || "").trim();
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  const hostname = String(parsed?.hostname || "").toLowerCase();
  const privateHost = !parsed
    || !["http:", "https:"].includes(parsed.protocol)
    || !hostname
    || hostname === "localhost"
    || hostname.endsWith(".local")
    || hostname === "::1"
    || /^(0|127|10|169\.254)\./.test(hostname)
    || /^192\.168\./.test(hostname)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);
  if (privateHost) {
    throw Object.assign(new Error("Token image URL must be a public HTTP(S) URL"), {
      status: 400,
      code: "INVALID_TOKEN_IMAGE_URL",
    });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: "image/*" } });
    if (!response.ok) {
      throw Object.assign(new Error(`Token image returned HTTP ${response.status}`), {
        status: 400,
        code: "TOKEN_IMAGE_FETCH_FAILED",
      });
    }
    const contentType = String(response.headers.get("content-type") || "image/png").split(";", 1)[0];
    if (!contentType.startsWith("image/")) {
      throw Object.assign(new Error("Token image URL did not return an image"), {
        status: 400,
        code: "TOKEN_IMAGE_TYPE_INVALID",
      });
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 8_000_000) {
      throw Object.assign(new Error("Token image must be between 1 byte and 8 MB"), {
        status: 400,
        code: "TOKEN_IMAGE_SIZE_INVALID",
      });
    }
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error("Unable to fetch the public token image"), {
      status: 400,
      code: "TOKEN_IMAGE_FETCH_FAILED",
      cause: error?.message,
    });
  } finally {
    clearTimeout(timer);
  }
}

function requestPath(request) {
  return new URL(request.url || "/", "https://narraops.invalid").pathname;
}

async function pulseStatus(supabase) {
  const live = await loadPulseNarrativesResponse(supabase);
  const rows = Object.values(live.columns || {}).flat();
  const opportunities = rows.map((row) => ({
    opportunityId: row.narrative_id,
    title: row.original_text,
    summary: row.original_text,
    status: "review",
    stage: "spreading",
    evidence: [{
      evidenceId: row.narrative_id,
      sourceType: row.source_type,
      url: row.source_url,
      publisher: row.author_name || row.platform,
      title: row.original_text,
      excerpt: null,
      publishedAt: row.published_at,
      capturedAt: live.generated_at,
      status: "available",
    }],
    riskFlags: [],
    missingEvidence: [],
    similarTokenCount: null,
    firstObservedAt: row.published_at,
    updatedAt: row.published_at,
  }));
  const observedAt = live.generated_at || new Date().toISOString();
  return {
    schema_version: "pulse.v1",
    mode: "evidence_pipeline",
    data_status: live.data_status || "no_fresh_narratives",
    observed_at: observedAt,
    opportunities,
    collector: {
      sourceCount: live.collector?.source_count || 0,
      healthySourceCount: live.collector?.successful_source_count || 0,
      candidateCount: live.collector?.collected_item_count || 0,
      clusterCount: 0,
      activeCandidateCount: opportunities.length,
      reviewedOpportunityCount: opportunities.length,
    },
    gates: ["evidence_eligibility", "narrative", "amplification"],
    states: ["watch", "review", "high_priority"],
    limitations: [
      "Historical evaluation data is not exposed as a live signal.",
      "Social-platform evidence is deferred until an official or authenticated adapter is configured.",
      "Only manually reviewed candidates are published; the remaining collector output stays in the review queue.",
    ],
    execution: "live_confirmation_required",
  };
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      status: 400,
      code: "INVALID_JSON",
    });
  }
}

function normalizeIdentity(chain, address) {
  if (chain === "evm") {
    const checksummed = getAddress(String(address || "").trim());
    return { address: checksummed, normalized: checksummed.toLowerCase() };
  }
  if (chain === "solana") {
    const normalized = bs58.encode(bs58.decode(String(address || "").trim()));
    return { address: normalized, normalized };
  }
  throw Object.assign(new Error("chain must be evm or solana"), {
    status: 400,
    code: "INVALID_CHAIN",
  });
}

function challengeMessage({ chain, address, chainId, nonce, origin }) {
  const network =
    chain === "solana" ? "Solana" : `EVM${chainId ? ` (${chainId})` : ""}`;
  return [
    "Sign in to NarraOps",
    "",
    `Wallet: ${address}`,
    `Network: ${network}`,
    `Origin: ${origin}`,
    `Nonce: ${nonce}`,
    "",
    "This request does not trigger a blockchain transaction or cost gas.",
  ].join("\n");
}

function parseCookie(header) {
  const entries = String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    if (entry.slice(0, separator) === COOKIE_NAME) {
      return decodeURIComponent(entry.slice(separator + 1));
    }
  }
  return null;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token, maxAge) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

async function requireResult(promise, fallbackMessage) {
  const { data, error } = await promise;
  if (error) {
    console.error("supabase_operation_failed", {
      code: error.code,
      message: error.message,
    });
    throw Object.assign(new Error(fallbackMessage), {
      status: 503,
      code: "PERSISTENCE_UNAVAILABLE",
    });
  }
  return data;
}

async function loadSession(supabase, request) {
  const token = parseCookie(request.headers.cookie);
  if (!token) return null;
  return withHardTimeout((async () => {
  const session = await requireResult(
    supabase
      .from("web3_sessions")
      .select("session_id,user_id,expires_at,created_at")
      .eq("token_hash", tokenHash(token))
      .gt("expires_at", new Date().toISOString())
      .maybeSingle(),
    "Unable to read the Web3 session",
  );
  if (!session) return null;
  const [user, identities] = await Promise.all([
    requireResult(
      supabase
        .from("web3_users")
        .select("user_id,display_name,onboarding_completed,created_at")
        .eq("user_id", session.user_id)
        .single(),
      "Unable to read the Web3 user",
    ),
    requireResult(
      supabase
        .from("web3_identities")
        .select("chain,address,chain_id")
        .eq("user_id", session.user_id)
        .order("created_at", { ascending: true }),
      "Unable to read wallet identities",
    ),
  ]);
  await supabase
    .from("web3_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("session_id", session.session_id);
  return {
    authenticated: true,
    authenticatedAt: session.created_at,
    user: {
      userId: user.user_id,
      displayName: user.display_name,
      onboardingCompleted: user.onboarding_completed,
      createdAt: user.created_at,
      identities: identities.map((identity) => ({
        chain: identity.chain,
        address: identity.address,
        chainId: identity.chain_id,
      })),
    },
  };
  })(), 5_000, "loadSession");
}

function authenticatedUserId(session) {
  const userId = session?.user?.userId;
  if (!userId) {
    throw Object.assign(
      new Error("Sign in with a Web3 wallet to continue"),
      { status: 401, code: "AUTHENTICATION_REQUIRED" },
    );
  }
  return userId;
}

function assertAgentConversationAccess(conversation, userId) {
  const ownerUserId =
    conversation?.userId ||
    conversation?.user_id ||
    conversation?.context?.userId ||
    conversation?.context?.user_id ||
    null;
  if (!ownerUserId || ownerUserId !== userId) {
    throw Object.assign(
      new Error("Agent conversation was not found"),
      { status: 404, code: "CONVERSATION_NOT_FOUND" },
    );
  }
}

function assetsError(error, fallbackMessage) {
  console.error("supabase_assets_operation_failed", {
    code: error?.code,
    message: error?.message,
  });
  const persistenceNotReady = ["42P01", "PGRST204", "PGRST205"].includes(
    error?.code,
  );
  const detail = String(error?.message || error?.details || "").trim();
  throw Object.assign(
    new Error(
      persistenceNotReady
        ? "Assets persistence has not been migrated yet"
        : detail
          ? `${fallbackMessage}: ${detail}`
          : fallbackMessage,
    ),
    {
      status: 503,
      code: persistenceNotReady
        ? "ASSETS_PERSISTENCE_NOT_READY"
        : error?.code || "ASSETS_PERSISTENCE_UNAVAILABLE",
      details: {
        supabaseCode: error?.code || null,
        supabaseMessage: error?.message || null,
      },
    },
  );
}

async function requireAssetsResult(promise, fallbackMessage) {
  const { data, error } = await promise;
  if (error) assetsError(error, fallbackMessage);
  return data;
}

function gmgnCredentialsConfigured() {
  return Boolean(String(process.env.GMGN_API_KEY || "").trim());
}

function validSolanaAddress(value) {
  try {
    return bs58.decode(String(value || "")).length === 32;
  } catch {
    return false;
  }
}

function positiveDecimal(value, field) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text) || Number(text) <= 0) {
    throw Object.assign(new Error(`${field} must be a positive decimal amount`), {
      status: 400,
      code: "INVALID_LAUNCH_AMOUNT",
    });
  }
  return text;
}

export function allocateFixedTotalRandom({ totalLamports, walletCount, seed }) {
  const total = BigInt(totalLamports);
  const count = Number(walletCount);
  if (!Number.isInteger(count) || count < 1 || total < BigInt(count)) {
    throw Object.assign(new Error("Bundled buy total must allocate at least one lamport per wallet"), {
      status: 400,
      code: "BOUND_BUY_TOTAL_TOO_SMALL",
    });
  }
  const weights = Array.from({ length: count }, (_, index) =>
    BigInt(`0x${createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0, 16)}`) + 1n,
  );
  const distributable = total - BigInt(count);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  const amounts = weights.map((weight) => 1n + (distributable * weight) / weightTotal);
  let remainder = total - amounts.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % count, remainder -= 1n) {
    amounts[index] += 1n;
  }
  return amounts;
}

function launchPlatformId(platform) {
  if (platform && typeof platform === "object") return String(platform.id || platform.name || "").toLowerCase();
  return String(platform || "").toLowerCase();
}

async function ownedLaunchDraft(supabase, userId, draftId) {
  if (!supabase || !userId) {
    throw Object.assign(new Error("Connect a wallet before using a live launch draft"), {
      status: 401,
      code: "AUTHENTICATION_REQUIRED",
    });
  }
  return requireAssetsResult(
    supabase
      .from("go_launch_drafts")
      .select("*")
      .eq("launch_draft_id", draftId)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read the launch draft",
  );
}

async function ownedExecutionGroup(supabase, userId, groupId, purpose) {
  const group = await requireAssetsResult(
    supabase
      .from("asset_wallet_groups")
      .select("group_id,name,purpose,network")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read the selected wallet group",
  );
  if (!group) {
    throw Object.assign(new Error("The selected wallet group was not found"), {
      status: 404,
      code: "WALLET_GROUP_NOT_FOUND",
    });
  }
  if (group.network !== "solana" || (purpose && group.purpose !== purpose)) {
    throw Object.assign(new Error("The selected wallet group is not compatible with this Pump launch"), {
      status: 400,
      code: "WALLET_GROUP_NETWORK_MISMATCH",
    });
  }
  const wallets = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,public_address,provisioning_status,wallet_index")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .order("wallet_index", { ascending: true }),
    "Unable to read the selected wallet group wallets",
  );
  const active = (wallets || []).filter((wallet) => wallet.provisioning_status === "active" && validSolanaAddress(wallet.public_address));
  if (!active.length) {
    throw Object.assign(new Error("The selected wallet group has no active Solana addresses. Provision or bind its wallets in Assets first."), {
      status: 400,
      code: "WALLET_GROUP_NOT_READY",
    });
  }
  return { group, wallets: active };
}

function launchApprovalParameters(draft) {
  const token = draft?.token || {};
  return {
    chain: draft?.chain || null,
    platform: launchPlatformId(draft?.platform) || null,
    token: {
      name: token.name || null,
      symbol: token.symbol || null,
      description: token.description || null,
      image_url: token.image_url || null,
      initial_buy: token.initial_buy || "0",
      bundle_buy_per_wallet: token.bundle_buy_per_wallet || null,
      website_url: token.website_url || null,
      x_url: token.x_url || null,
      telegram_url: token.telegram_url || null,
    },
    cooking_wallet_group_id: draft?.metadata?.cooking_wallet_group_id || null,
    bundled_wallet_group_id: draft?.metadata?.bundled_wallet_group_id || null,
  };
}

function assertTrustedApprovalOrigin(request) {
  const supplied = String(requestHeader(request, "origin") || "");
  const expected = process.env.APP_ORIGIN || "https://www.narraops.xyz";
  let suppliedOrigin;
  let expectedOrigin;
  try {
    suppliedOrigin = new URL(supplied).origin;
    expectedOrigin = new URL(expected).origin;
  } catch {
    suppliedOrigin = null;
    expectedOrigin = null;
  }
  if (!suppliedOrigin || suppliedOrigin !== expectedOrigin) {
    throw Object.assign(new Error("Approval decisions require a trusted same-origin request"), {
      status: 403,
      code: "UNTRUSTED_REQUEST_ORIGIN",
    });
  }
}

function approvalErrorStatus(error) {
  if (error?.status) return error.status;
  if (error?.code === "APPROVAL_ACTOR_MISMATCH" || error?.code === "APPROVAL_NOT_FOUND") return 404;
  if (error?.code === "APPROVAL_RECENT_AUTH_REQUIRED") return 401;
  if (["APPROVAL_EXPIRED", "APPROVAL_STATE_CONFLICT", "APPROVAL_VERSION_CONFLICT"].includes(error?.code)) return 409;
  if (String(error?.code || "").startsWith("APPROVAL_")) return 400;
  return 500;
}

function memoryErrorStatus(error) {
  if (error?.status) return error.status;
  if (error?.code === "AGENT_MEMORY_NOT_FOUND") return 404;
  if (String(error?.code || "").includes("CONFLICT")) return 409;
  if (String(error?.code || "").startsWith("AGENT_MEMORY_")) return 400;
  return 500;
}

export async function handleAgentMemoryRoute({
  request,
  response,
  session,
  proposeMemory = proposeAgentMemory,
  decideMemory = decideAgentMemory,
  forgetMemory = forgetAgentMemory,
  listMemories = listAgentMemories,
}) {
  const path = requestPath(request);
  const actorId = authenticatedUserId(session);

  if (request.method === "GET" && path === "/api/v1/agent/memories") {
    const url = new URL(request.url || "/", "https://narraops.invalid");
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));
    const review = url.searchParams.get("review") === "true";
    const memories = await listMemories(actorId, {
      scopes: ["user"],
      kinds: ["user_preference", "user_fact"],
      limit,
      ...(review ? { statuses: ["proposed", "active"] } : {}),
    });
    sendJson(response, 200, {
      schema_version: "agent.memory_list.v1",
      memories,
    }, { "cache-control": "private, no-store" });
    return true;
  }

  if (request.method === "POST" && path === "/api/v1/agent/memories/proposals") {
    assertTrustedApprovalOrigin(request);
    const body = await readBody(request);
    const kind = String(body.kind || "");
    if (!["user_preference", "user_fact"].includes(kind)) {
      throw Object.assign(new Error("Only user preferences and user facts are accepted"), {
        status: 400,
        code: "AGENT_MEMORY_KIND_INVALID",
      });
    }
    const idempotencyKey = String(
      requestHeader(request, "idempotency-key") || body.idempotencyKey || "",
    ).trim();
    if (!idempotencyKey) {
      throw Object.assign(new Error("Idempotency-Key is required"), {
        status: 400,
        code: "AGENT_MEMORY_IDEMPOTENCY_KEY_INVALID",
      });
    }
    const result = await proposeMemory(actorId, {
      scope: "user",
      kind,
      content: body.content,
      ...(body.structuredValue || body.structured_value
        ? { structuredValue: body.structuredValue || body.structured_value }
        : {}),
      sensitivity: body.sensitivity === "sensitive" ? "sensitive" : "private",
      source: {
        type: "user_message",
        id: `api:${idempotencyKey.slice(0, 251)}`,
        refs: [],
      },
      confidence: 1,
      idempotencyKey,
      ...(body.expiresAt || body.expires_at
        ? { expiresAt: body.expiresAt || body.expires_at }
        : {}),
    });
    sendJson(response, result.idempotentReplay ? 200 : 201, result, {
      "cache-control": "private, no-store",
    });
    return true;
  }

  const match = path.match(
    /^\/api\/v1\/agent\/memories\/([0-9a-f-]{36})\/(confirm|reject|forget)$/i,
  );
  if (request.method === "POST" && match) {
    assertTrustedApprovalOrigin(request);
    const body = await readBody(request);
    const expectedStateVersion = Number(
      body.expectedStateVersion ?? body.expected_state_version,
    );
    if (!Number.isInteger(expectedStateVersion) || expectedStateVersion < 1) {
      throw Object.assign(new Error("expectedStateVersion must be a positive integer"), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const memoryId = match[1];
    const action = match[2].toLowerCase();
    const item = action === "forget"
      ? await forgetMemory(actorId, { memoryId, expectedStateVersion })
      : await decideMemory(actorId, {
          memoryId,
          decision: action === "confirm" ? "active" : "rejected",
          expectedStateVersion,
          confirmation: "user_explicit",
        });
    sendJson(response, 200, item, { "cache-control": "private, no-store" });
    return true;
  }

  throw Object.assign(new Error("Memory route method is not supported"), {
    status: 405,
    code: "METHOD_NOT_ALLOWED",
  });
}

export async function handleAgentApprovalRoute({
  request,
  response,
  session,
  readApproval = getAgentApproval,
  decideApproval = decideAgentApproval,
}) {
  const path = requestPath(request);
  const match = path.match(/^\/api\/v1\/agent\/approvals\/([0-9a-f-]{36})(?:\/(approve|reject))?$/i);
  if (!match) return false;
  const actorId = authenticatedUserId(session);
  const approvalId = match[1];
  const action = match[2] || null;

  if (request.method === "GET" && !action) {
    const approval = await readApproval(approvalId, actorId);
    if (!approval) {
      throw Object.assign(new Error("Approval was not found"), {
        status: 404,
        code: "APPROVAL_NOT_FOUND",
      });
    }
    sendJson(response, 200, approval, { "cache-control": "private, no-store" });
    return true;
  }

  if (request.method === "POST" && action) {
    assertTrustedApprovalOrigin(request);
    const body = await readBody(request);
    const expectedStateVersion = Number(
      body.expectedStateVersion ?? body.expected_state_version,
    );
    if (!Number.isInteger(expectedStateVersion) || expectedStateVersion < 1) {
      throw Object.assign(new Error("expectedStateVersion must be a positive integer"), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const approval = await decideApproval({
      approvalId,
      actorId,
      decision: action === "approve" ? "approved" : "rejected",
      expectedStateVersion,
      recentAuthAt: session?.authenticatedAt,
    });
    sendJson(response, 200, approval, { "cache-control": "private, no-store" });
    return true;
  }

  throw Object.assign(new Error("Approval route method is not supported"), {
    status: 405,
    code: "METHOD_NOT_ALLOWED",
  });
}

async function executeLiveLaunchDraft({ supabase, userId, draftId }) {
  const draft = await ownedLaunchDraft(supabase, userId, draftId);
  if (!draft) {
    throw Object.assign(new Error("The launch draft was not found"), {
      status: 404,
      code: "LAUNCH_DRAFT_NOT_FOUND",
    });
  }
  if (String(draft.chain || "").toLowerCase() !== "solana" || launchPlatformId(draft.platform) !== "pump") {
    throw Object.assign(new Error("The live Go launcher currently supports Solana Pump.fun drafts only"), {
      status: 400,
      code: "UNSUPPORTED_LAUNCH_PLATFORM",
    });
  }
  const token = draft.token || {};
  const cookingId = draft.metadata?.cooking_wallet_group_id || null;
  const bundledId = draft.metadata?.bundled_wallet_group_id || null;
  if (!cookingId || !bundledId) {
    throw Object.assign(new Error("Select both a Cooking wallet group and a bundled wallet group before launching"), {
      status: 400,
      code: "WALLET_GROUP_SELECTION_REQUIRED",
    });
  }
  const [cooking, bundled] = await Promise.all([
    ownedExecutionGroup(supabase, userId, cookingId, "cooking"),
    ownedExecutionGroup(supabase, userId, bundledId, "general"),
  ]);
  if (cooking.wallets.length !== 1) {
    throw Object.assign(new Error("A Cooking wallet group must contain exactly one active Solana wallet"), {
      status: 400,
      code: "COOKING_WALLET_INVALID",
    });
  }
  const initialBuy = token.initial_buy ? positiveDecimal(token.initial_buy, "initial_buy") : "0";
  const bundleBuyTotal = token.bundle_buy_total ? positiveDecimal(token.bundle_buy_total, "bundle_buy_total") : null;
  const bundleAllocation = bundleBuyTotal
    ? allocateFixedTotalRandom({
        totalLamports: transferDecimalToLamports(bundleBuyTotal),
        walletCount: bundled.wallets.length,
        seed: draftId,
      }).map((amount, index) => ({
        wallet_id: bundled.wallets[index].wallet_id,
        amount_lamports: amount.toString(),
      }))
    : [];
  if (!token.name || !token.symbol || !token.description || !token.image_url) {
    throw Object.assign(new Error("Complete token name, symbol, description, and image URL before launching"), {
      status: 400,
      code: "LAUNCH_DRAFT_INCOMPLETE",
    });
  }

  const existing = draft.metadata?.direct_execution || {};
  if (existing.status === "confirmed" && existing.tx_hash) {
    return {
      schema_version: "go.launch_execution.v1",
      status: "confirmed",
      provider: "pump.fun",
      execution_mode: "client_signed",
      launchpad: "pump",
      tx_hash: existing.tx_hash,
      token_address: existing.token_address || null,
      cooking_wallet_group_id: cookingId,
      bundled_wallet_group_id: bundledId,
      bundled_wallet_count: bundled.wallets.length,
      bundled_buy_total: bundleBuyTotal,
      bundled_buy_allocation: bundleAllocation,
    };
  }
  const runtimeShadow = existing.runtime_semantic_shadow || {};
  const requiresRuntimeRefresh =
    (process.env.AGENT_PUMP_SEMANTIC_SHADOW_ENABLED === "true"
      && runtimeShadow.recorded !== true)
    || (process.env.AGENT_PUMP_APPROVAL_DUAL_RUN_ENABLED === "true"
      && runtimeShadow.approvalDualRun?.requested !== true)
    || (process.env.AGENT_PUMP_ENFORCEMENT_ENABLED === "true"
      && (
        runtimeShadow.recorded !== true
        || runtimeShadow.approvalDualRun?.requested !== true
      ));
  if (
    existing.status === "requires_user_signature"
    && existing.transaction_base64
    && existing.message_hash
    && !requiresRuntimeRefresh
  ) {
    return {
      schema_version: "go.launch_execution.v1",
      status: "requires_user_signature",
      provider: "pump.fun",
      execution_mode: "client_signed",
      launchpad: "pump",
      plan: {
        mintAddress: existing.mint_address,
        metadataUri: existing.metadata_uri,
        transactionBase64: existing.transaction_base64,
        lastValidBlockHeight: existing.last_valid_block_height,
      },
      cooking_wallet_group_id: cookingId,
      bundled_wallet_group_id: bundledId,
      bundled_wallet_count: bundled.wallets.length,
      bundled_buy_total: bundleBuyTotal,
      bundled_buy_allocation: bundleAllocation,
      runtime: existing.runtime_semantic_shadow || {
        recorded: false,
        reason: "semantic_shadow_not_recorded",
      },
      message: "Pump transaction prepared. Sign it with the selected Cooking wallet to broadcast it.",
    };
  }
  const planner = await directLaunchPlanner();
  const plan = await planner.plan({
    platform: "pump",
    walletAddress: cooking.wallets[0].public_address,
    name: token.name,
    symbol: token.symbol,
    description: token.description,
    imageBase64: await imageUrlToDataUrl(token.image_url),
    imageName: "narraops-token-image",
    imageType: "image/png",
    twitter: token.x_url || "",
    telegram: token.telegram_url || "",
    website: token.website_url || "",
    developerBuyAmount: initialBuy,
  });
  const { Transaction } = await solanaWeb3();
  const preparedTransaction = Transaction.from(
    Buffer.from(plan.transactionBase64, "base64"),
  );
  let runtimeSemanticShadow = {
    recorded: false,
    reason: "semantic_shadow_disabled",
  };
  if (process.env.AGENT_PUMP_SEMANTIC_SHADOW_ENABLED === "true") {
    try {
      const [fee, currentBlockHeight] = await Promise.all([
        planner.pump.connection.getFeeForMessage(
          preparedTransaction.compileMessage(),
          "confirmed",
        ),
        planner.pump.connection.getBlockHeight("confirmed"),
      ]);
      if (!Number.isSafeInteger(fee?.value) || fee.value < 0) {
        throw Object.assign(new Error("Solana RPC did not return a valid Pump fee"), {
          code: "PUMP_FEE_ESTIMATE_INVALID",
        });
      }
      runtimeSemanticShadow = await recordPumpLaunchSemanticShadow({
        actorId: userId,
        draftId,
        transactionBase64: plan.transactionBase64,
        feePayer: cooking.wallets[0].public_address,
        mintAddress: plan.mintAddress,
        name: token.name,
        symbol: token.symbol,
        metadataUri: plan.metadataUri,
        creator: cooking.wallets[0].public_address,
        developerBuyLamports: plan.developerBuyLamports,
        estimatedFeeAtomic: String(fee.value),
        currentBlockHeight,
        lastValidBlockHeight: plan.lastValidBlockHeight,
        bundledBuyTotal: bundleBuyTotal,
        bundledBuyAllocation: bundleAllocation,
      });
    } catch (error) {
      console.error("pump_semantic_shadow_prepare_failed", {
        code: error?.code || "PUMP_SEMANTIC_SHADOW_PREPARE_FAILED",
        message: error?.message || String(error),
        draftId,
      });
      runtimeSemanticShadow = {
        recorded: false,
        reason: "semantic_shadow_prepare_failed",
        code: error?.code || "PUMP_SEMANTIC_SHADOW_PREPARE_FAILED",
      };
    }
  }
  const execution = {
    provider: "pump.fun",
    launchpad: "pump",
    execution_mode: "client_signed",
    status: "requires_user_signature",
    fee_payer: cooking.wallets[0].public_address,
    mint_address: plan.mintAddress,
    metadata_uri: plan.metadataUri,
    transaction_base64: plan.transactionBase64,
    message_hash: createHash("sha256").update(preparedTransaction.serializeMessage()).digest("hex"),
    last_valid_block_height: plan.lastValidBlockHeight,
    cooking_wallet_group_id: cookingId,
    bundled_wallet_group_id: bundledId,
    bundled_wallet_count: bundled.wallets.length,
    bundled_buy_total: bundleBuyTotal,
    bundled_buy_allocation: bundleAllocation,
    runtime_semantic_shadow: runtimeSemanticShadow,
    updated_at: new Date().toISOString(),
  };
  await requireAssetsResult(
    supabase
      .from("go_launch_drafts")
      .update({
        status: "requires_user_signature",
        confirmation_status: "requires_user_signature",
        execution_mode: "live",
        signing_status: "awaiting_user_signature",
        broadcasting_status: "awaiting_user_signature",
        metadata: { ...(draft.metadata || {}), direct_execution: execution },
        updated_at: new Date().toISOString(),
      })
      .eq("launch_draft_id", draftId)
      .eq("user_id", userId)
      .select("*")
      .single(),
    "Unable to save the direct Pump launch plan",
  );
  return {
    schema_version: "go.launch_execution.v1",
    status: "requires_user_signature",
    provider: "pump.fun",
    execution_mode: "client_signed",
    launchpad: "pump",
    plan: {
      mintAddress: plan.mintAddress,
      metadataUri: plan.metadataUri,
      transactionBase64: plan.transactionBase64,
      lastValidBlockHeight: plan.lastValidBlockHeight,
    },
    cooking_wallet_group_id: cookingId,
    bundled_wallet_group_id: bundledId,
    bundled_wallet_count: 0,
    runtime: runtimeSemanticShadow,
    message: "Pump transaction prepared. Sign it with the selected Cooking wallet to broadcast it.",
  };
}

async function validateSignedDirectLaunchDraft({
  supabase,
  userId,
  draftId,
  signedTransactionBase64,
}) {
  const draft = await ownedLaunchDraft(supabase, userId, draftId);
  if (!draft) {
    throw Object.assign(new Error("The launch draft was not found"), { status: 404, code: "LAUNCH_DRAFT_NOT_FOUND" });
  }
  const expected = draft.metadata?.direct_execution || {};
  if (!expected.mint_address) {
    throw Object.assign(new Error("Prepare the direct Pump launch before signing it"), { status: 409, code: "DIRECT_LAUNCH_NOT_PREPARED" });
  }
  const encoded = String(signedTransactionBase64 || "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 2_000_000) {
    throw Object.assign(new Error("signedTransactionBase64 is invalid"), { status: 400, code: "INVALID_SIGNED_TRANSACTION" });
  }
  const { PublicKey, Transaction } = await solanaWeb3();
  const transaction = Transaction.from(Buffer.from(encoded, "base64"));
  if (!transaction.verifySignatures()) {
    throw Object.assign(new Error("The signed Pump transaction could not be verified"), { status: 400, code: "SIGNED_TRANSACTION_INVALID" });
  }
  const messageHash = createHash("sha256").update(transaction.serializeMessage()).digest("hex");
  if (!expected.message_hash || messageHash !== expected.message_hash) {
    throw Object.assign(new Error("The signed transaction does not match the prepared Pump launch"), { status: 409, code: "SIGNED_TRANSACTION_PLAN_MISMATCH" });
  }
  const cookingId = expected.cooking_wallet_group_id || draft.metadata?.cooking_wallet_group_id;
  const cooking = await ownedExecutionGroup(supabase, userId, cookingId, "cooking");
  if (cooking.wallets.length !== 1 || !transaction.feePayer?.equals(new PublicKey(cooking.wallets[0].public_address))) {
    throw Object.assign(new Error("The signed transaction does not belong to the selected Cooking wallet"), { status: 400, code: "COOKING_WALLET_SIGNATURE_MISMATCH" });
  }
  const payerSignature = transaction.signatures?.[0]?.signature;
  if (!payerSignature || payerSignature.length !== 64) {
    throw Object.assign(new Error("The signed Pump transaction is missing its payer signature"), {
      status: 400,
      code: "SIGNED_TRANSACTION_INVALID",
    });
  }
  return {
    draft,
    expected,
    encoded,
    messageHash,
    cookingId,
    signer: cooking.wallets[0].public_address,
    derivedTxHash: bs58.encode(payerSignature),
  };
}

export function buildDirectPumpExecutionResponse({
  status,
  txHash,
  tokenAddress,
  cookingWalletGroupId,
  bundledWalletGroupId = null,
  bundledBuys = [],
  runtimeExecutionId = null,
}) {
  return {
    schema_version: "go.launch_execution.v1",
    status,
    provider: "pump.fun",
    execution_mode: "client_signed",
    launchpad: "pump",
    tx_hash: txHash,
    token_address: tokenAddress,
    ...(runtimeExecutionId
      ? { runtime_execution_id: runtimeExecutionId }
      : {}),
    cooking_wallet_group_id: cookingWalletGroupId,
    bundled_wallet_group_id: bundledWalletGroupId,
    bundled_wallet_count: 0,
    ...(bundledBuys.length ? { bundled_buys: bundledBuys } : {}),
  };
}

async function broadcastValidatedDirectLaunch({
  supabase,
  userId,
  draftId,
  validated,
  runtimeExecution,
}) {
  const {
    draft,
    expected,
    encoded,
    cookingId,
    derivedTxHash,
  } = validated;
  const connection = (await directLaunchPlanner()).pump.connection;
  let txHash;
  let chainRejected = false;
  try {
    txHash = await connection.sendRawTransaction(Buffer.from(encoded, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    if (txHash !== derivedTxHash) {
      throw Object.assign(
        new Error("Solana RPC returned a transaction signature that differs from the signed payload"),
        { code: "PUMP_TRANSACTION_IDENTITY_MISMATCH" },
      );
    }
    if (runtimeExecution?.enforced) {
      const submitted = await transitionPumpLaunchRuntimeExecution({
        actorId: userId,
        executionId: runtimeExecution.executionId,
        status: "submitted",
        txHash,
      });
      runtimeExecution = {
        ...runtimeExecution,
        status: submitted.status,
        stateVersion: submitted.stateVersion,
        txHash: submitted.txHash,
      };
    }
    const confirmation = await connection.confirmTransaction(txHash, "confirmed");
    if (confirmation?.value?.err) {
      chainRejected = true;
      throw new Error("Pump launch transaction failed on-chain");
    }
  } catch (error) {
    if (runtimeExecution?.enforced) {
      const runtimeStatus = chainRejected ? "failed" : "reconciliation_required";
      await transitionPumpLaunchRuntimeExecution({
        actorId: userId,
        executionId: runtimeExecution.executionId,
        status: runtimeStatus,
        txHash: derivedTxHash,
        ...(chainRejected
          ? { failure: { code: "PUMP_TRANSACTION_REJECTED", message: error.message } }
          : {}),
      });
      const execution = {
        ...expected,
        status: runtimeStatus,
        tx_hash: derivedTxHash,
        runtime_execution_id: runtimeExecution.executionId,
        error: error.message,
        updated_at: new Date().toISOString(),
      };
      await requireAssetsResult(
        supabase.from("go_launch_drafts").update({
          status: runtimeStatus,
          confirmation_status: runtimeStatus,
          broadcasting_status: runtimeStatus,
          metadata: { ...(draft.metadata || {}), direct_execution: execution },
          updated_at: new Date().toISOString(),
        }).eq("launch_draft_id", draftId).eq("user_id", userId),
        "Unable to save the direct Pump reconciliation state",
      );
      if (!chainRejected) {
        return buildDirectPumpExecutionResponse({
          status: "reconciliation_required",
          txHash: derivedTxHash,
          tokenAddress: expected.mint_address,
          runtimeExecutionId: runtimeExecution.executionId,
          cookingWalletGroupId: cookingId,
          bundledWalletGroupId:
            expected.bundled_wallet_group_id
            || draft.metadata?.bundled_wallet_group_id
            || null,
        });
      }
    }
    await requireAssetsResult(
      supabase.from("go_launch_drafts").update({
        status: "failed",
        confirmation_status: "failed",
        broadcasting_status: "failed",
        metadata: { ...(draft.metadata || {}), direct_execution: { ...expected, status: "failed", error: error.message, updated_at: new Date().toISOString() } },
        updated_at: new Date().toISOString(),
      }).eq("launch_draft_id", draftId).eq("user_id", userId),
      "Unable to save the direct Pump launch failure",
    );
    throw Object.assign(new Error(error.message || "Unable to broadcast the Pump launch"), { status: 502, code: "DIRECT_PUMP_BROADCAST_FAILED" });
  }
  if (runtimeExecution?.enforced) {
    await transitionPumpLaunchRuntimeExecution({
      actorId: userId,
      executionId: runtimeExecution.executionId,
      status: "confirmed",
      txHash,
    });
  }
  let boundBuys = [];
  if (expected.bundled_buy_total && expected.bundled_buy_allocation?.length) {
    boundBuys = await executePumpBoundBuys({
      supabase,
      userId,
      draftId,
      draft,
      expected,
      connection,
    });
  }
  const execution = {
    ...expected,
    status: "confirmed",
    tx_hash: txHash,
    token_address: expected.mint_address,
    bundled_buys: boundBuys,
    ...(runtimeExecution?.executionId
      ? { runtime_execution_id: runtimeExecution.executionId }
      : {}),
    updated_at: new Date().toISOString(),
  };
  await requireAssetsResult(
    supabase.from("go_launch_drafts").update({
      status: "confirmed",
      confirmation_status: "confirmed",
      execution_mode: "live",
      signing_status: "signed",
      broadcasting_status: "confirmed",
      metadata: { ...(draft.metadata || {}), direct_execution: execution },
      updated_at: new Date().toISOString(),
    }).eq("launch_draft_id", draftId).eq("user_id", userId).select("*").single(),
    "Unable to save the direct Pump launch receipt",
  );
  return buildDirectPumpExecutionResponse({
    status: "confirmed",
    txHash,
    tokenAddress: expected.mint_address,
    runtimeExecutionId: runtimeExecution?.executionId || null,
    cookingWalletGroupId: cookingId,
    bundledWalletGroupId:
      expected.bundled_wallet_group_id
      || draft.metadata?.bundled_wallet_group_id
      || null,
    bundledBuys: boundBuys,
  });
}

async function submitDirectLaunchDraft({
  supabase,
  userId,
  draftId,
  signedTransactionBase64,
}) {
  const validated = await validateSignedDirectLaunchDraft({
    supabase,
    userId,
    draftId,
    signedTransactionBase64,
  });
  let runtimeExecution = {
    enforced: false,
    reason: "pump_enforcement_disabled",
  };
  if (process.env.AGENT_PUMP_ENFORCEMENT_ENABLED === "true") {
    const connection = (await directLaunchPlanner()).pump.connection;
    const currentBlockHeight = await connection.getBlockHeight("confirmed");
    const semantic = validated.expected.runtime_semantic_shadow || {};
    runtimeExecution = await preparePumpLaunchRuntimeExecution({
      actorId: userId,
      draftId,
      shadowId: semantic.shadowId,
      executionId: semantic.executionId,
      intentDigest: semantic.intentDigest,
      approvalDualRun: semantic.approvalDualRun,
      messageHash: validated.messageHash,
      txSignature: validated.derivedTxHash,
      signer: validated.signer,
      currentBlockHeight,
    });
    if (!runtimeExecution.broadcastClaimed) {
      let observation = {
        status: "unknown",
        observedAt: new Date().toISOString(),
      };
      try {
        const statuses = await connection.getSignatureStatuses(
          [runtimeExecution.txHash],
          { searchTransactionHistory: true },
        );
        const status = statuses?.value?.[0] || null;
        observation = status
          ? {
              status: status.err
                ? "failed"
                : ["confirmed", "finalized"].includes(status.confirmationStatus)
                  ? "confirmed"
                  : "pending",
              observedAt: new Date().toISOString(),
              ...(status.err
                ? {
                    failure: {
                      code: "PUMP_TRANSACTION_REJECTED",
                      message: JSON.stringify(status.err),
                    },
                  }
                : {}),
            }
          : {
              status: "not_found",
              observedAt: new Date().toISOString(),
            };
      } catch {
        // Unknown reads are persisted for reconciliation and are never retried
        // by broadcasting the signed transaction again.
      }
      runtimeExecution = await reconcilePumpLaunchRuntimeExecution({
        actorId: userId,
        executionId: runtimeExecution.executionId,
        txHash: runtimeExecution.txHash,
        observation,
      });
      return buildDirectPumpExecutionResponse({
        status: runtimeExecution.status,
        txHash: runtimeExecution.txHash,
        tokenAddress: validated.expected.mint_address,
        runtimeExecutionId: runtimeExecution.executionId,
        cookingWalletGroupId: validated.cookingId,
        bundledWalletGroupId:
          validated.expected.bundled_wallet_group_id
          || validated.draft.metadata?.bundled_wallet_group_id
          || null,
      });
    }
  }
  if (
    process.env.AGENT_PUMP_ENFORCEMENT_ENABLED === "true"
    && process.env.AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED === "true"
    && runtimeExecution?.enforced
    && runtimeExecution?.executionId
  ) {
    const gatewayResult = await submitPumpBroadcastViaGateway({
      executionId: runtimeExecution.executionId,
      approvalId: validated.expected.runtime_semantic_shadow?.approvalDualRun?.approvalId,
      expectedStateVersion: runtimeExecution.stateVersion,
      envelopeDigest: validated.expected.runtime_semantic_shadow?.envelope?.envelopeDigest,
      intentDigest: validated.expected.runtime_semantic_shadow?.envelope?.intentDigest,
      txHash: validated.derivedTxHash,
      signedTransactionBase64: validated.encoded,
      actorId: userId,
      broadcast: async () => {
        const connection = (await directLaunchPlanner()).pump.connection;
        const sentHash = await connection.sendRawTransaction(
          Buffer.from(validated.encoded, "base64"),
          { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
        );
        if (sentHash !== validated.derivedTxHash) {
          throw Object.assign(
            new Error("Solana RPC returned a signature that differs from the signed payload"),
            { code: "PUMP_TRANSACTION_IDENTITY_MISMATCH" },
          );
        }
        return { status: "submitted", providerAccepted: true };
      },
    });
    if (gatewayResult.enabled) {
      const finalStatus = gatewayResult.status;
      await transitionPumpLaunchRuntimeExecution({
        actorId: userId,
        executionId: runtimeExecution.executionId,
        status: finalStatus,
        txHash: gatewayResult.txHash,
      });
      return buildDirectPumpExecutionResponse({
        status: finalStatus,
        txHash: gatewayResult.txHash,
        tokenAddress: validated.expected.mint_address,
        runtimeExecutionId: runtimeExecution.executionId,
        cookingWalletGroupId: validated.cookingId,
        bundledWalletGroupId:
          validated.expected.bundled_wallet_group_id
          || validated.draft.metadata?.bundled_wallet_group_id
          || null,
      });
    }
  }
  return broadcastValidatedDirectLaunch({
    supabase,
    userId,
    draftId,
    validated,
    runtimeExecution,
  });
}

async function submitDirectSwap({
  supabase,
  userId,
  walletGroupId,
  signedTransactionBase64,
  messageHash,
}) {
  const group = await ownedExecutionGroup(supabase, userId, walletGroupId, null);
  if (group.wallets.length !== 1) {
    throw Object.assign(new Error("Direct browser Swap requires exactly one active wallet in the selected group"), {
      status: 400,
      code: "DIRECT_SWAP_WALLET_COUNT_INVALID",
    });
  }
  const encoded = String(signedTransactionBase64 || "").trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length > 2_000_000) {
    throw Object.assign(new Error("signedTransactionBase64 is invalid"), { status: 400, code: "INVALID_SIGNED_TRANSACTION" });
  }
  const { PublicKey, VersionedTransaction } = await solanaWeb3();
  let transaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
  } catch {
    throw Object.assign(new Error("The signed Swap transaction could not be decoded"), { status: 400, code: "SIGNED_TRANSACTION_INVALID" });
  }
  const payer = transaction.message.staticAccountKeys?.[0]?.toBase58?.() || "";
  const expectedPayer = group.wallets[0].public_address;
  if (payer !== expectedPayer) {
    throw Object.assign(new Error("The signed Swap transaction does not belong to the selected Assets wallet"), { status: 400, code: "SWAP_WALLET_SIGNATURE_MISMATCH" });
  }
  const serializedMessage = transaction.message.serialize();
  const payerSignature = transaction.signatures?.[0];
  if (
    !payerSignature
    || payerSignature.every((byte) => byte === 0)
    || !nacl.sign.detached.verify(serializedMessage, payerSignature, new PublicKey(expectedPayer).toBytes())
  ) {
    throw Object.assign(new Error("The signed Swap transaction could not be verified"), { status: 400, code: "SIGNED_TRANSACTION_INVALID" });
  }
  const actualMessageHash = createHash("sha256").update(serializedMessage).digest("hex");
  if (messageHash && String(messageHash) !== actualMessageHash) {
    throw Object.assign(new Error("The signed Swap transaction does not match the prepared route"), { status: 409, code: "SIGNED_SWAP_PLAN_MISMATCH" });
  }
  const planner = await directLaunchPlanner();
  const connection = planner.pump.connection;
  let txHash;
  const currentBlockHeight = await connection.getBlockHeight("confirmed");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const signedTxSignature = bs58.encode(payerSignature);
  const swapShadow = await recordSolanaSwapSemanticShadow({
    actorId: userId,
    walletGroupId,
    signer: expectedPayer,
    signedTransactionBase64: encoded,
    slippageBps: 300,
    estimatedFeeAtomic: "0",
    maxFeeLamports: "0",
    valueAtomic: "0",
    currentBlockHeight,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  let swapRuntimeExecution = {
    enforced: false,
    reason: "swap_enforcement_disabled",
  };
  if (process.env.AGENT_SWAP_ENFORCEMENT_ENABLED === "true" && swapShadow.recorded) {
    swapRuntimeExecution = await prepareSolanaSwapRuntimeExecution({
      actorId: userId,
      walletGroupId,
      shadowId: swapShadow.shadowId,
      executionId: swapShadow.executionId,
      intentDigest: swapShadow.intentDigest,
      approvalDualRun: swapShadow.approvalDualRun,
      messageHash: actualMessageHash,
      txSignature: signedTxSignature,
      signer: expectedPayer,
      currentBlockHeight,
    });
  }
  if (
    process.env.AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED === "true"
    && swapRuntimeExecution.enforced
    && swapRuntimeExecution.executionId
  ) {
    const gatewayResult = await submitSolanaSwapViaGateway({
      executionId: swapRuntimeExecution.executionId,
      approvalId: swapShadow.approvalDualRun?.approvalId,
      expectedStateVersion: swapRuntimeExecution.stateVersion,
      envelopeDigest: swapShadow.envelopeDigest,
      intentDigest: swapShadow.intentDigest,
      txHash: signedTxSignature,
      signedTransactionBase64: encoded,
      actorId: userId,
      broadcast: async () => {
        const sentHash = await connection.sendRawTransaction(Buffer.from(encoded, "base64"), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
        if (sentHash !== signedTxSignature) {
          throw new Error("Solana RPC returned a signature that differs from the signed payload");
        }
        const confirmation = await connection.confirmTransaction(sentHash, "confirmed");
        if (confirmation?.value?.err) throw new Error("Swap transaction failed on-chain");
        return { status: "submitted", providerAccepted: true };
      },
    });
    if (gatewayResult.enabled) {
      return {
        schema_version: "go.swap_execution.v1",
        status: gatewayResult.status === "confirmed" ? "confirmed" : "submitted",
        provider: "jupiter",
        execution_mode: "client_signed",
        tx_hash: gatewayResult.txHash,
        wallet_group_id: walletGroupId,
        wallet_address: expectedPayer,
      };
    }
  }
  try {
    txHash = await connection.sendRawTransaction(Buffer.from(encoded, "base64"), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    const confirmation = await connection.confirmTransaction(txHash, "confirmed");
    if (confirmation?.value?.err) throw new Error("Swap transaction failed on-chain");
  } catch (error) {
    throw Object.assign(new Error(error.message || "Unable to broadcast the Swap transaction"), {
      status: 502,
      code: "DIRECT_SWAP_BROADCAST_FAILED",
    });
  }
  return {
    schema_version: "go.swap_execution.v1",
    status: "confirmed",
    provider: "jupiter",
    execution_mode: "client_signed",
    tx_hash: txHash,
    wallet_group_id: walletGroupId,
    wallet_address: expectedPayer,
  };
}

function validateGroupInput(body) {
  const name = String(body?.name || "").trim();
  const purpose = String(body?.purpose || "general").toLowerCase();
  const network = String(body?.network || "solana").toLowerCase();
  const walletCount = Number(body?.walletCount);
  if (!name || name.length > 80) {
    throw Object.assign(new Error("name must contain 1 to 80 characters"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  if (!["general", "cooking"].includes(purpose)) {
    throw Object.assign(new Error("purpose must be general or cooking"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  if (!["solana", "evm"].includes(network)) {
    throw Object.assign(new Error("network must be solana or evm"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  if (!Number.isSafeInteger(walletCount) || walletCount < 1 || walletCount > 100) {
    throw Object.assign(new Error("walletCount must be an integer from 1 to 100"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  if (purpose === "cooking" && walletCount !== 1) {
    throw Object.assign(
      new Error("A cooking wallet group must contain exactly one wallet"),
      { status: 400, code: "COOKING_WALLET_COUNT_INVALID" },
    );
  }
  return { name, purpose, network, walletCount };
}

function validateWalletCount(body) {
  const count = Number(body?.count);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw Object.assign(new Error("count must be an integer from 1 to 100"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  return count;
}

function walletVaultPassword() {
  const password = String(process.env.WALLET_VAULT_PASSWORD || "").trim();
  if (password.length < 16) {
    throw Object.assign(
      new Error(
        "Wallet vault is not configured. Set WALLET_VAULT_PASSWORD (16+ chars) in the production environment before creating wallet groups.",
      ),
      {
        status: 503,
        code: "WALLET_VAULT_NOT_CONFIGURED",
      },
    );
  }
  return password;
}

function deriveAssetWalletKey(password, salt) {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function sealAssetWalletSecret({ walletReferenceId, publicAddress, privateKey, password }) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveAssetWalletKey(password, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${walletReferenceId}:${publicAddress}`, "utf8"));
  const plaintext = Buffer.from(privateKey, "utf8");
  try {
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      format: "narraops-wallet-vault-v1",
      kdf: "scrypt-N32768-r8-p1",
      cipher: "aes-256-gcm",
      walletReferenceId,
      publicAddress,
      salt: salt.toString("base64url"),
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      authTag: cipher.getAuthTag().toString("base64url"),
    };
  } finally {
    plaintext.fill(0);
    key.fill(0);
  }
}

async function unsealAssetWalletSecret({ envelope, password }) {
  const salt = Buffer.from(String(envelope.salt || ""), "base64url");
  const iv = Buffer.from(String(envelope.iv || ""), "base64url");
  const ciphertext = Buffer.from(String(envelope.ciphertext || ""), "base64url");
  const authTag = Buffer.from(String(envelope.authTag || ""), "base64url");
  const key = await deriveAssetWalletKey(password, salt);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`${envelope.walletReferenceId}:${envelope.publicAddress}`, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } finally {
    key.fill(0);
  }
}

async function broadcastSolanaTransfer({ connection, from, to, lamports, privateKey }) {
  const web3 = await solanaWeb3();
  const Keypair = web3.Keypair || web3.default?.Keypair;
  const SystemProgram = web3.SystemProgram || web3.default?.SystemProgram;
  const Transaction = web3.Transaction || web3.default?.Transaction;
  if (!Keypair || !SystemProgram || !Transaction) {
    throw Object.assign(new Error("Solana transfer module failed to load"), {
      status: 503,
      code: "SOLANA_WEB3_UNAVAILABLE",
    });
  }
  const secret = Buffer.from(String(privateKey || ""), "base64");
  try {
    const signer = Keypair.fromSecretKey(secret);
    if (signer.publicKey.toBase58() !== String(from)) {
      throw Object.assign(new Error("Encrypted wallet signer does not match the sender"), {
        status: 400,
        code: "SIGNER_ADDRESS_MISMATCH",
      });
    }
    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: signer.publicKey, ...latest }).add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new (web3.PublicKey || web3.default?.PublicKey)(String(to)),
        lamports: Number(lamports),
      }),
    );
    transaction.sign(signer);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (confirmation.value.err) {
      throw Object.assign(new Error("Solana transfer was rejected on-chain"), {
        status: 502,
        code: "TRANSFER_REJECTED",
      });
    }
    return { chain: "solana", asset: "SOL", txHash: signature, status: "confirmed" };
  } finally {
    secret.fill(0);
  }
}

async function provisionAssetWallets(supabase, userId, group, wallets) {
  const password = walletVaultPassword();
  const tasks = (wallets || []).map(async (wallet) => {
    if (wallet.provisioning_status === "active" && wallet.public_address) {
      return wallet;
    }
    const walletReferenceId = `${wallet.wallet_id}:${group.network}`;
    let publicAddress;
    let privateKey;
    let solanaKeypair = null;
    let secretStored = false;
    if (group.network === "solana") {
      const web3 = await solanaWeb3();
      const Keypair = web3.Keypair || web3.default?.Keypair;
      if (!Keypair) {
        throw Object.assign(new Error("Solana wallet generation module failed to load"), {
          status: 503,
          code: "SOLANA_WEB3_UNAVAILABLE",
        });
      }
      solanaKeypair = Keypair.generate();
      publicAddress = solanaKeypair.publicKey.toBase58();
      privateKey = Buffer.from(solanaKeypair.secretKey).toString("base64");
    } else {
      const evmWallet = Wallet.createRandom();
      publicAddress = evmWallet.address;
      privateKey = evmWallet.privateKey;
    }
    try {
      const envelope = await sealAssetWalletSecret({
        walletReferenceId,
        publicAddress,
        privateKey,
        password,
      });
      await requireAssetsResult(
        supabase.from("asset_wallet_secrets").upsert({
          wallet_id: wallet.wallet_id,
          user_id: userId,
          encrypted_envelope: envelope,
          updated_at: new Date().toISOString(),
        }, { onConflict: "wallet_id" }),
        "Unable to store the encrypted wallet",
      );
      secretStored = true;
      const updated = await requireAssetsResult(
        supabase
          .from("asset_wallets")
          .update({
            public_address: publicAddress,
            provisioning_status: "active",
            signer_reference: walletReferenceId,
            updated_at: new Date().toISOString(),
          })
          .eq("wallet_id", wallet.wallet_id)
          .eq("group_id", group.group_id)
          .eq("user_id", userId)
          .select("wallet_id,group_id,user_id,wallet_index,public_address,provisioning_status,created_at,updated_at")
          .single(),
        "Unable to activate the generated wallet",
      );
      return updated;
    } catch (error) {
      if (secretStored) {
        const { error: cleanupError } = await supabase
          .from("asset_wallet_secrets")
          .delete()
          .eq("wallet_id", wallet.wallet_id)
          .eq("user_id", userId);
        if (cleanupError) {
          throw Object.assign(
            new Error("Wallet provisioning failed and secret cleanup could not be confirmed"),
            {
              status: 503,
              code: "WALLET_SECRET_ROLLBACK_FAILED",
              cause: error,
            },
          );
        }
      }
      throw error;
    } finally {
      solanaKeypair?.secretKey.fill(0);
      privateKey = "";
    }
  });
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
  return results.map((result) => result.value);
}

export function transferDecimalToLamports(value) {
  const [whole, fraction = ""] = String(value || "").split(".");
  const lamports = (BigInt(whole || "0") * 1_000_000_000n)
    + BigInt(fraction.padEnd(9, "0").slice(0, 9) || "0");
  return lamports;
}

export function transferLamportsToDecimal(value) {
  const whole = value / 1_000_000_000n;
  const fraction = String(value % 1_000_000_000n).padStart(9, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

const TRANSFER_FEE_RESERVE = 5_000n;

async function transferPreviewInput({ supabase, userId, body }) {
  const chain = String(body.chain || "solana");
  if (chain !== "solana") {
    throw Object.assign(new Error("Only Solana transfers are supported"), {
      status: 400,
      code: "TRANSFER_CHAIN_UNSUPPORTED",
    });
  }
  const source = body.source || {};
  const destination = body.destination || {};
  if (source.type !== "wallet_group" || !source.id) {
    throw Object.assign(new Error("Transfer source must be a wallet group"), {
      status: 400,
      code: "TRANSFER_SOURCE_INVALID",
    });
  }
  if (destination.type === "wallet_group") {
    if (!destination.id || destination.id === source.id) {
      throw Object.assign(new Error("Transfer destination wallet group is invalid"), {
        status: 400,
        code: "TRANSFER_DESTINATION_INVALID",
      });
    }
  } else if (destination.type === "login_wallet") {
    if (!destination.address || !validSolanaAddress(destination.address)) {
      throw Object.assign(new Error("Transfer destination address is invalid"), {
        status: 400,
        code: "TRANSFER_DESTINATION_INVALID",
      });
    }
  } else {
    throw Object.assign(new Error("Transfer destination must be a wallet group or external address"), {
      status: 400,
      code: "TRANSFER_DESTINATION_INVALID",
    });
  }
  const amountMode = String(body.amountMode || "amount");
  if (!["fraction", "amount"].includes(amountMode)) {
    throw Object.assign(new Error("amountMode must be fraction or amount"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,255}$/.test(idempotencyKey)) {
    throw Object.assign(new Error("idempotencyKey is invalid"), {
      status: 400,
      code: "VALIDATION_ERROR",
    });
  }
  return { chain, source, destination, amountMode, idempotencyKey, body };
}

async function transferPreview({ supabase, userId, body }) {
  const parsed = await transferPreviewInput({ supabase, userId, body });
  const sourceGroup = await ownedExecutionGroup(supabase, userId, parsed.source.id, null);
  const sourceWallets = sourceGroup.wallets;
  const connection = (await directLaunchPlanner()).pump.connection;
  const sourceRows = [];
  for (const wallet of sourceWallets) {
    const balanceAtomic = BigInt(await connection.getBalance(
      new (await solanaWeb3()).PublicKey(wallet.public_address),
      "confirmed",
    ));
    sourceRows.push({ ...wallet, balanceAtomic });
  }
  const destinationWallets = parsed.destination.type === "wallet_group"
    ? (await ownedExecutionGroup(supabase, userId, parsed.destination.id, null)).wallets
    : [];
  const spendableRows = sourceRows
    .map((wallet) => ({
      ...wallet,
      spendableAtomic: wallet.balanceAtomic > TRANSFER_FEE_RESERVE
        ? wallet.balanceAtomic - TRANSFER_FEE_RESERVE
        : 0n,
    }))
    .filter(({ spendableAtomic }) => spendableAtomic > 0n);
  if (spendableRows.length === 0) {
    throw Object.assign(new Error("No source wallet has spendable SOL balance"), {
      status: 400,
      code: "NO_FUNDED_SOURCE_WALLETS",
    });
  }
  const routes = [];
  if (parsed.destination.type !== "wallet_group") {
    for (const source of spendableRows) {
      routes.push({
        source,
        to: parsed.destination.address,
        destinationWalletId: null,
      });
    }
  } else if (destinationWallets.length === 1) {
    for (const source of spendableRows) {
      routes.push({
        source,
        to: destinationWallets[0].public_address,
        destinationWalletId: destinationWallets[0].wallet_id,
      });
    }
  } else {
    for (let index = 0; index < destinationWallets.length; index += 1) {
      routes.push({
        source: spendableRows[index % spendableRows.length],
        to: destinationWallets[index].public_address,
        destinationWalletId: destinationWallets[index].wallet_id,
      });
    }
  }
  const amounts = [];
  if (parsed.amountMode === "fraction") {
    for (const route of routes) {
      const requested = (route.source.balanceAtomic * BigInt(Number(body.fractionBps || 0))) / 10_000n;
      amounts.push(
        requested >= route.source.balanceAtomic ? route.source.spendableAtomic : requested,
      );
    }
  } else {
    const total = transferDecimalToLamports(body.amount);
    if (total <= 0n) {
      throw Object.assign(new Error("Transfer amount must be positive"), {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const perRoute = total / BigInt(routes.length);
    let remainder = total % BigInt(routes.length);
    for (let index = 0; index < routes.length; index += 1) {
      let amount = perRoute;
      if (remainder > 0n) { amount += 1n; remainder -= 1n; }
      amounts.push(amount);
    }
  }
  const allocations = routes
    .map((route, index) => ({
      pairIndex: index,
      sourceWalletId: route.source.wallet_id,
      from: route.source.public_address,
      to: route.to,
      destinationWalletId: route.destinationWalletId,
      amountLamports: amounts[index],
      amount: transferLamportsToDecimal(amounts[index]),
    }))
    .filter(({ amountLamports }) => amountLamports > 0n);
  if (allocations.length === 0) {
    throw Object.assign(new Error("Transfer amounts resolve to zero"), {
      status: 400,
      code: "TRANSFER_AMOUNT_TOO_SMALL",
    });
  }
  const now = new Date();
  const preview = {
    previewToken: randomUUID(),
    confirmationToken: randomUUID(),
    status: "requires_user_confirmation",
    executionMode: "live",
    chain: "solana",
    source: parsed.source,
    destination: parsed.destination,
    amountMode: parsed.amountMode,
    requestedAmount: parsed.amountMode === "amount" ? body.amount : null,
    fractionBps: parsed.amountMode === "fraction" ? Number(body.fractionBps || 0) : null,
    estimatedAmount: transferLamportsToDecimal(
      allocations.reduce((sum, allocation) => sum + allocation.amountLamports, 0n),
    ),
    currency: "SOL",
    distribution: "equal",
    pairingMode: parsed.destination.type !== "wallet_group"
      ? "wallet_group_to_external"
      : destinationWallets.length === 1
        ? "wallet_group_collect_to_single_destination"
        : "source_group_to_destination_group_distribution",
    pairCount: allocations.length,
    unmatchedSourceWalletIds: [],
    unmatchedDestinationWalletIds: [],
    allocations,
    requiresConfirmation: true,
    signingStatus: "awaiting_confirmation",
    broadcastingStatus: "not_started",
    executable: true,
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    createdAt: now.toISOString(),
  };
  await requireAssetsResult(
    supabase.from("asset_transfer_previews").upsert({
      preview_token: preview.previewToken,
      confirmation_token: preview.confirmationToken,
      user_id: userId,
      idempotency_key: parsed.idempotencyKey,
      source: parsed.source,
      destination: parsed.destination,
      amount_mode: parsed.amountMode,
      requested_amount: preview.requestedAmount,
      fraction_bps: preview.fractionBps,
      estimated_amount: preview.estimatedAmount,
      allocations: allocations.map((allocation) => ({
        pairIndex: allocation.pairIndex,
        sourceWalletId: allocation.sourceWalletId,
        from: allocation.from,
        to: allocation.to,
        destinationWalletId: allocation.destinationWalletId,
        amountLamports: allocation.amountLamports.toString(),
        amount: allocation.amount,
      })),
      expires_at: preview.expiresAt,
      created_at: preview.createdAt,
    }, { onConflict: "preview_token" }),
    "Unable to persist the transfer preview",
  );
  return { preview, idempotencyKey: parsed.idempotencyKey };
}

async function transferCreate({ supabase, userId, body, headerIdempotencyKey }) {
  const parsed = await transferPreviewInput({ supabase, userId, body });
  if (headerIdempotencyKey !== parsed.idempotencyKey) {
    throw Object.assign(new Error("Idempotency-Key header must equal body idempotencyKey"), {
      status: 400,
      code: "IDEMPOTENCY_KEY_MISMATCH",
    });
  }
  const previewToken = String(body.previewToken || "");
  const confirmationToken = String(body.confirmationToken || "");
  const existing = await requireAssetsResult(
    supabase
      .from("asset_transfer_previews")
      .select("*")
      .eq("preview_token", previewToken)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read the transfer preview",
  );
  if (!existing) {
    throw Object.assign(new Error("Transfer preview was not found"), {
      status: 400,
      code: "INVALID_TRANSFER_CONFIRMATION",
    });
  }
  if (existing.confirmation_token !== confirmationToken) {
    throw Object.assign(new Error("Transfer confirmation token is invalid"), {
      status: 400,
      code: "INVALID_TRANSFER_CONFIRMATION",
    });
  }
  if (Date.parse(existing.expires_at) <= Date.now()) {
    throw Object.assign(new Error("Transfer preview has expired"), {
      status: 410,
      code: "TRANSFER_PREVIEW_EXPIRED",
    });
  }
  const prior = await requireAssetsResult(
    supabase
      .from("asset_transfers")
      .select("*")
      .eq("idempotency_key", parsed.idempotencyKey)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read prior transfer",
  );
  if (prior) {
    return {
      transferId: prior.transfer_id,
      previewToken: prior.preview_token,
      status: prior.status,
      executionMode: "live",
      submitted: prior.submitted,
      confirmed: prior.confirmed,
      transactions: prior.transactions,
      txHash: prior.tx_hash,
      ...(prior.error ? { error: prior.error } : {}),
      createdAt: prior.created_at,
      updatedAt: prior.updated_at,
    };
  }
  const connection = (await directLaunchPlanner()).pump.connection;
  const password = walletVaultPassword();
  const allocations = (existing.allocations || []).map((allocation) => ({
    ...allocation,
    amountLamports: BigInt(String(allocation.amountLamports || "0")),
  }));
  const transactions = [];
  const currentBlockHeight = await connection.getBlockHeight("confirmed");
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const placeholderTxHash = bs58.encode(
    new Uint8Array(64).fill(Number(existing.preview_token.replace(/-/g, "").slice(0, 2), 16) || 1),
  );
  const transferShadow = await recordAssetTransferSemanticShadow({
    actorId: userId,
    walletGroupId: existing.source?.id,
    signer: allocations[0]?.from,
    to: allocations[0]?.to,
    amountLamports: allocations[0]?.amountLamports || 0n,
    estimatedFeeAtomic: "5000",
    maxFeeLamports: "5000",
    currentBlockHeight,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  });
  let transferRuntimeExecution = {
    enforced: false,
    reason: "transfer_enforcement_disabled",
  };
  if (
    process.env.AGENT_TRANSFER_ENFORCEMENT_ENABLED === "true"
    && transferShadow.recorded
  ) {
    transferRuntimeExecution = await prepareAssetTransferRuntimeExecution({
      actorId: userId,
      walletGroupId: existing.source?.id,
      shadowId: transferShadow.shadowId,
      executionId: transferShadow.executionId,
      intentDigest: transferShadow.intentDigest,
      approvalDualRun: transferShadow.approvalDualRun,
      messageHash: transferShadow.messageHash,
      signer: allocations[0]?.from,
      placeholderTxHash,
      currentBlockHeight,
    });
  }
  if (
    process.env.AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED === "true"
    && transferRuntimeExecution.enforced
    && transferRuntimeExecution.executionId
  ) {
    const gatewayResult = await submitAssetTransferViaGateway({
      executionId: transferRuntimeExecution.executionId,
      approvalId: transferShadow.approvalDualRun?.approvalId,
      expectedStateVersion: transferRuntimeExecution.stateVersion,
      envelopeDigest: transferShadow.envelopeDigest,
      intentDigest: transferShadow.intentDigest,
      actorId: userId,
      broadcast: async () => {
        const results = [];
        let firstTxHash = null;
        for (const allocation of allocations) {
          const secretEnvelope = await requireAssetsResult(
            supabase
              .from("asset_wallet_secrets")
              .select("encrypted_envelope")
              .eq("wallet_id", allocation.sourceWalletId)
              .eq("user_id", userId)
              .single(),
            "Unable to read the sender wallet secret",
          );
          let privateKey = await unsealAssetWalletSecret({
            envelope: secretEnvelope.encrypted_envelope,
            password,
          });
          try {
            const result = await broadcastSolanaTransfer({
              connection,
              from: allocation.from,
              to: allocation.to,
              lamports: allocation.amountLamports,
              privateKey,
            });
            firstTxHash = firstTxHash || result.txHash;
            results.push({
              sourceWalletId: allocation.sourceWalletId,
              destinationWalletId: allocation.destinationWalletId,
              from: allocation.from,
              to: allocation.to,
              amount: allocation.amount,
              ...result,
            });
          } catch (error) {
            results.push({
              sourceWalletId: allocation.sourceWalletId,
              destinationWalletId: allocation.destinationWalletId,
              from: allocation.from,
              to: allocation.to,
              amount: allocation.amount,
              status: "failed",
              error: { code: error.code || "TRANSFER_ALLOCATION_FAILED", message: error.message },
            });
          } finally {
            privateKey = "";
          }
        }
        transactions.push(...results);
        return {
          status: results.some(({ status }) => status === "confirmed") ? "submitted" : "failed",
          txHash: firstTxHash || placeholderTxHash,
          providerAccepted: Boolean(firstTxHash),
        };
      },
    });
    if (gatewayResult.enabled) {
      const succeeded = transactions.filter(({ status }) => status !== "failed");
      const failed = transactions.filter(({ status }) => status === "failed");
      const confirmed = succeeded.length > 0
        && succeeded.every(({ status }) => status === "confirmed")
        && failed.length === 0;
      const transfer = {
        transferId: randomUUID(),
        previewToken,
        status: failed.length === 0 ? (confirmed ? "confirmed" : "submitted") : succeeded.length > 0 ? "partially_failed" : "failed",
        executionMode: "live",
        submitted: succeeded.length > 0,
        confirmed,
        transactions,
        txHash: succeeded.length === 1 && transactions.length === 1 ? succeeded[0].txHash : null,
        ...(failed.length > 0
          ? { error: { code: "TRANSFER_ALLOCATIONS_FAILED", message: `${failed.length} transfer allocation(s) failed` } }
          : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await requireAssetsResult(
        supabase.from("asset_transfers").insert({
          transfer_id: transfer.transferId,
          user_id: userId,
          idempotency_key: parsed.idempotencyKey,
          preview_token: previewToken,
          status: transfer.status,
          submitted: transfer.submitted,
          confirmed: transfer.confirmed,
          transactions,
          tx_hash: transfer.txHash || null,
          error: transfer.error || null,
          created_at: transfer.createdAt,
          updated_at: transfer.updatedAt,
        }),
        "Unable to persist the transfer",
      );
      return transfer;
    }
  }
  for (const allocation of allocations) {
    const secretEnvelope = await requireAssetsResult(
      supabase
        .from("asset_wallet_secrets")
        .select("encrypted_envelope")
        .eq("wallet_id", allocation.sourceWalletId)
        .eq("user_id", userId)
        .single(),
      "Unable to read the sender wallet secret",
    );
    let privateKey = await unsealAssetWalletSecret({
      envelope: secretEnvelope.encrypted_envelope,
      password,
    });
    try {
      const result = await broadcastSolanaTransfer({
        connection,
        from: allocation.from,
        to: allocation.to,
        lamports: allocation.amountLamports,
        privateKey,
      });
      transactions.push({
        sourceWalletId: allocation.sourceWalletId,
        destinationWalletId: allocation.destinationWalletId,
        from: allocation.from,
        to: allocation.to,
        amount: allocation.amount,
        ...result,
      });
    } catch (error) {
      transactions.push({
        sourceWalletId: allocation.sourceWalletId,
        destinationWalletId: allocation.destinationWalletId,
        from: allocation.from,
        to: allocation.to,
        amount: allocation.amount,
        status: "failed",
        error: { code: error.code || "TRANSFER_ALLOCATION_FAILED", message: error.message },
      });
    } finally {
      privateKey = "";
    }
  }
  const succeeded = transactions.filter(({ status }) => status !== "failed");
  const failed = transactions.filter(({ status }) => status === "failed");
  const confirmed = succeeded.length > 0
    && succeeded.every(({ status }) => status === "confirmed")
    && failed.length === 0;
  const transfer = {
    transferId: randomUUID(),
    previewToken,
    status: failed.length === 0 ? (confirmed ? "confirmed" : "submitted") : succeeded.length > 0 ? "partially_failed" : "failed",
    executionMode: "live",
    submitted: succeeded.length > 0,
    confirmed,
    transactions,
    txHash: succeeded.length === 1 && transactions.length === 1 ? succeeded[0].txHash : null,
    ...(failed.length > 0
      ? { error: { code: "TRANSFER_ALLOCATIONS_FAILED", message: `${failed.length} transfer allocation(s) failed` } }
      : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await requireAssetsResult(
    supabase.from("asset_transfers").insert({
      transfer_id: transfer.transferId,
      user_id: userId,
      idempotency_key: parsed.idempotencyKey,
      preview_token: previewToken,
      status: transfer.status,
      submitted: transfer.submitted,
      confirmed: transfer.confirmed,
      transactions,
      tx_hash: transfer.txHash || null,
      error: transfer.error || null,
      created_at: transfer.createdAt,
      updated_at: transfer.updatedAt,
    }),
    "Unable to persist the transfer",
  );
  return transfer;
}

function publicWallet(wallet, network) {
  const isBound = wallet.provisioning_status === "active" && Boolean(wallet.public_address);
  return {
    walletId: wallet.wallet_id,
    groupId: wallet.group_id,
    label: `Wallet ${wallet.wallet_index}`,
    publicAddress: wallet.public_address,
    addresses: wallet.public_address
      ? { [network === "solana" ? "solana" : "bsc"]: wallet.public_address }
      : {},
    balances: {},
    balance: null,
    balanceAsset: null,
    custodyMode: isBound ? "narraops_encrypted_vault" : "provisioning",
    provisioningStatus: wallet.provisioning_status,
    exportEligible: false,
    createdAt: wallet.created_at,
    updatedAt: wallet.updated_at,
  };
}

function publicGroup(group, walletCount, activeWalletCount = 0) {
  return {
    groupId: group.group_id,
    name: group.name,
    purpose: group.purpose,
    network: group.network,
    walletCount,
    balances: {},
    totalBalance: null,
    balanceAsset: null,
    activeWalletCount,
    executionMode: activeWalletCount === walletCount && walletCount > 0 ? "encrypted_vault" : "provisioning",
    createdAt: group.created_at,
    updatedAt: group.updated_at,
  };
}

async function ownedGroup(supabase, userId, groupId) {
  const group = await requireAssetsResult(
    supabase
      .from("asset_wallet_groups")
      .select("group_id,user_id,name,purpose,network,created_at,updated_at")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read the wallet group",
  );
  if (!group) {
    throw Object.assign(new Error("Wallet group was not found"), {
      status: 404,
      code: "WALLET_GROUP_NOT_FOUND",
    });
  }
  return group;
}

async function listWalletGroups(supabase, userId) {
  const [groups, wallets] = await Promise.all([
    requireAssetsResult(
      supabase
        .from("asset_wallet_groups")
        .select("group_id,user_id,name,purpose,network,created_at,updated_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      "Unable to list wallet groups",
    ),
    requireAssetsResult(
      supabase
        .from("asset_wallets")
      .select("group_id,public_address,provisioning_status")
        .eq("user_id", userId),
      "Unable to count wallets",
    ),
  ]);
  const counts = new Map();
  const activeCounts = new Map();
  for (const wallet of wallets || []) {
    counts.set(wallet.group_id, (counts.get(wallet.group_id) || 0) + 1);
    if (wallet.provisioning_status === "active" && wallet.public_address) {
      activeCounts.set(wallet.group_id, (activeCounts.get(wallet.group_id) || 0) + 1);
    }
  }
  return (groups || []).map((group) =>
    publicGroup(group, counts.get(group.group_id) || 0, activeCounts.get(group.group_id) || 0),
  );
}

async function executePumpBoundBuys({ supabase, userId, draftId, draft, expected, connection }) {
  const allocations = expected.bundled_buy_allocation || [];
  if (!allocations.length) return [];
  const wallets = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,public_address")
      .eq("group_id", expected.bundled_wallet_group_id)
      .eq("user_id", userId)
      .eq("provisioning_status", "active")
      .order("wallet_index", { ascending: true }),
    "Unable to read bundled wallet group wallets",
  );
  const walletById = new Map((wallets || []).map((wallet) => [wallet.wallet_id, wallet]));
  const sdkModule = await import("@pump-fun/pump-sdk");
  const sdk = sdkModule.default || sdkModule;
  const { default: BN } = await import("bn.js");
  const web3 = await solanaWeb3();
  const PublicKey = web3.PublicKey;
  const Transaction = web3.Transaction;
  const onlineSdk = new sdk.OnlinePumpSdk(connection);
  const offlineSdk = sdk.PUMP_SDK;
  const wrappedSol = new PublicKey("So11111111111111111111111111111111111111112");
  const password = walletVaultPassword();
  const launchBlock = await connection.getBlockHeight("confirmed");
  const deadline = launchBlock + 5;
  while ((await connection.getBlockHeight("confirmed")) <= launchBlock) {
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const results = [];
  for (const allocation of allocations) {
    const wallet = walletById.get(allocation.wallet_id);
    const result = {
      wallet_id: allocation.wallet_id,
      wallet_address: wallet?.public_address || null,
      amount_lamports: allocation.amount_lamports,
      status: "failed",
    };
    if (!wallet?.public_address) {
      result.error = { code: "BOUND_BUY_WALLET_NOT_FOUND" };
      results.push(result);
      continue;
    }
    if ((await connection.getBlockHeight("confirmed")) > deadline) {
      result.error = { code: "BOUND_BUY_WINDOW_EXPIRED" };
      results.push(result);
      continue;
    }
    const secretEnvelope = await requireAssetsResult(
      supabase
        .from("asset_wallet_secrets")
        .select("encrypted_envelope")
        .eq("wallet_id", allocation.wallet_id)
        .eq("user_id", userId)
        .single(),
      "Unable to read bundled wallet secret",
    );
    let privateKey = await unsealAssetWalletSecret({
      envelope: secretEnvelope.encrypted_envelope,
      password,
    });
    try {
      const keyBytes = Buffer.from(privateKey, "base64");
      const signer = web3.Keypair.fromSecretKey(keyBytes);
      const mint = new PublicKey(expected.mint_address);
      const [global, feeConfig, state] = await Promise.all([
        onlineSdk.fetchGlobal(),
        onlineSdk.fetchFeeConfig(),
        onlineSdk.fetchBuyState(mint, signer.publicKey),
      ]);
      const quote = new BN(String(allocation.amount_lamports));
      const amount = sdk.getBuyTokenAmountFromSolAmount({
        global,
        feeConfig,
        mintSupply: null,
        bondingCurve: state.bondingCurve,
        amount: quote,
        quoteMint: wrappedSol,
      });
      const instructions = await offlineSdk.buyV2Instructions({
        global,
        ...state,
        mint,
        user: signer.publicKey,
        amount,
        quoteAmount: quote,
        slippage: 0.05,
      });
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: signer.publicKey, ...latest }).add(...instructions);
      transaction.sign(signer);
      const txHash = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      result.tx_hash = txHash;
      result.status = "submitted";
      const confirmation = await connection.confirmTransaction({ signature: txHash, ...latest }, "confirmed");
      if (confirmation.value.err) {
        result.status = "failed";
        result.error = { code: "BOUND_BUY_REJECTED", detail: confirmation.value.err };
      } else {
        result.status = "confirmed";
      }
    } catch (error) {
      result.error = { code: error.code || "BOUND_BUY_FAILED", message: error.message };
    } finally {
      privateKey = "";
    }
    results.push(result);
  }
  return results;
}

async function removeFailedWalletGroup(
  supabase,
  userId,
  groupId,
  failureMessage = "Wallet group creation failed and rollback could not be confirmed",
) {
  const { error } = await supabase
    .from("asset_wallet_groups")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) {
    throw Object.assign(
      new Error(failureMessage),
      {
        status: 503,
        code: "WALLET_GROUP_ROLLBACK_FAILED",
      },
    );
  }
}

async function openAssetWalletSecret(envelope, password) {
  if (
    !envelope ||
    envelope.format !== "narraops-wallet-vault-v1" ||
    envelope.kdf !== "scrypt-N32768-r8-p1" ||
    envelope.cipher !== "aes-256-gcm"
  ) {
    throw Object.assign(new Error("Unsupported wallet secret envelope"), {
      status: 503,
      code: "UNSUPPORTED_WALLET_SECRET",
    });
  }
  const key = await deriveAssetWalletKey(password, Buffer.from(envelope.salt, "base64url"));
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(
    Buffer.from(`${envelope.walletReferenceId}:${envelope.publicAddress}`, "utf8"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
  } catch {
    throw Object.assign(
      new Error("Wallet password is incorrect or encrypted material is damaged"),
      { status: 503, code: "WALLET_UNLOCK_FAILED" },
    );
  } finally {
    key.fill(0);
  }
}

async function createWalletGroup(supabase, userId, body) {
  const input = validateGroupInput(body);
  // Load crypto dependencies and vault configuration before the first database write.
  walletVaultPassword();
  if (input.network === "solana") {
    await solanaWeb3();
  }
  const group = await requireAssetsResult(
    supabase
      .from("asset_wallet_groups")
      .insert({
        user_id: userId,
        name: input.name,
        purpose: input.purpose,
        network: input.network,
      })
      .select("group_id,user_id,name,purpose,network,created_at,updated_at")
      .single(),
    "Unable to create the wallet group",
  );
  const walletRows = Array.from({ length: input.walletCount }, (_, index) => ({
    group_id: group.group_id,
    user_id: userId,
    wallet_index: index + 1,
    provisioning_status: "planned",
    public_address: null,
    signer_reference: null,
  }));
  const { data: createdWallets, error } = await supabase
    .from("asset_wallets")
    .insert(walletRows)
    .select("wallet_id,group_id,user_id,wallet_index,public_address,provisioning_status,created_at,updated_at");
  if (error) {
    await removeFailedWalletGroup(supabase, userId, group.group_id);
    assetsError(error, "Unable to create wallets");
  }
  try {
    const provisioned = await provisionAssetWallets(supabase, userId, group, createdWallets);
    return publicGroup(group, provisioned.length, provisioned.length);
  } catch (error) {
    await removeFailedWalletGroup(supabase, userId, group.group_id);
    throw error;
  }
}

async function listGroupWallets(supabase, userId, groupId) {
  const group = await ownedGroup(supabase, userId, groupId);
  const wallets = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select(
        "wallet_id,group_id,user_id,wallet_index,public_address,provisioning_status,created_at,updated_at",
      )
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .order("wallet_index", { ascending: true }),
    "Unable to list wallets",
  );
  return {
    mode: "supabase",
    balanceMode: "unavailable",
    group: publicGroup(
      group,
      wallets.length,
      wallets.filter((wallet) => wallet.provisioning_status === "active" && wallet.public_address).length,
    ),
    wallets: wallets.map((wallet) => publicWallet(wallet, group.network)),
  };
}

function requestHeader(request, name) {
  const target = String(name).toLowerCase();
  const entries = Object.entries(request.headers || {});
  return entries.find(([key]) => key.toLowerCase() === target)?.[1];
}

async function exportWalletGroup(supabase, userId, groupId, request, body) {
  if (body?.confirmExport !== true) {
    throw Object.assign(new Error("Explicit private-key export confirmation is required"), {
      status: 400,
      code: "EXPORT_CONFIRMATION_REQUIRED",
    });
  }
  const reason = String(body?.reason || "").trim();
  if (!reason) {
    throw Object.assign(new Error("An export reason is required"), {
      status: 400,
      code: "EXPORT_REASON_REQUIRED",
    });
  }
  const reauthenticatedAt = Date.parse(
    String(requestHeader(request, "x-reauthenticated-at") || ""),
  );
  const reauthAge = Date.now() - reauthenticatedAt;
  if (
    !Number.isFinite(reauthenticatedAt) ||
    reauthAge < -5_000 ||
    reauthAge > 5 * 60_000
  ) {
    throw Object.assign(
      new Error("Wallet export requires recent reauthentication"),
      { status: 401, code: "RECENT_REAUTHENTICATION_REQUIRED" },
    );
  }
  if (String(requestHeader(request, "x-mfa-verified") || "").toLowerCase() !== "true") {
    throw Object.assign(new Error("Wallet export requires a verified MFA challenge"), {
      status: 403,
      code: "MFA_REQUIRED",
    });
  }

  const password = walletVaultPassword();
  const group = await ownedGroup(supabase, userId, groupId);
  const wallets = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,wallet_index,public_address,provisioning_status")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .order("wallet_index", { ascending: true }),
    "Unable to read wallets for export",
  );
  if (!wallets.length) {
    throw Object.assign(new Error("Wallet group has no wallets to export"), {
      status: 409,
      code: "WALLET_GROUP_EMPTY",
    });
  }

  const blocks = [];
  for (const wallet of wallets) {
    if (wallet.provisioning_status !== "active" || !wallet.public_address) {
      throw Object.assign(new Error(`Wallet ${wallet.wallet_index} is not ready for export`), {
        status: 409,
        code: "WALLET_NOT_READY",
      });
    }
    const secret = await requireAssetsResult(
      supabase
        .from("asset_wallet_secrets")
        .select("encrypted_envelope")
        .eq("wallet_id", wallet.wallet_id)
        .eq("user_id", userId)
        .maybeSingle(),
      "Unable to read the encrypted wallet",
    );
    if (!secret?.encrypted_envelope) {
      throw Object.assign(new Error(`Encrypted material is missing for Wallet ${wallet.wallet_index}`), {
        status: 503,
        code: "WALLET_SECRET_NOT_FOUND",
      });
    }
    const plaintext = await openAssetWalletSecret(secret.encrypted_envelope, password);
    try {
      const privateKey = group.network === "solana"
        ? bs58.encode(Buffer.from(plaintext.toString("utf8"), "base64"))
        : plaintext.toString("utf8");
      blocks.push([
        `Wallet ${wallet.wallet_index}`,
        `${group.network === "solana" ? "Solana" : "EVM"} address: ${wallet.public_address}`,
        `${group.network === "solana" ? "Solana private key (base58)" : "EVM private key"}: ${privateKey}`,
      ].join("\n"));
    } finally {
      plaintext.fill(0);
    }
  }

  const safeName = String(group.name || "wallet-group").replace(/[\\/:*?"<>|]/g, "_");
  return {
    fileName: `${safeName}-${group.network}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
    content: [
      "NarraOps private-key export",
      `Group: ${group.name}`,
      `Network: ${group.network}`,
      "WARNING: Anyone with these private keys can control the wallets.",
      "",
      blocks.join("\n\n"),
      "",
    ].join("\n"),
    walletCount: wallets.length,
    keyFormat: group.network === "solana" ? "base58-secret-key" : "hex-private-key",
  };
}

async function addGroupWallets(supabase, userId, groupId, body) {
  const count = validateWalletCount(body);
  const group = await ownedGroup(supabase, userId, groupId);
  const existing = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,wallet_index")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .order("wallet_index", { ascending: true }),
    "Unable to read existing wallets",
  );
  if (group.purpose === "cooking") {
    throw Object.assign(
      new Error("A cooking wallet group can contain exactly one wallet"),
      { status: 400, code: "COOKING_WALLET_LIMIT_EXCEEDED" },
    );
  }
  if (existing.length + count > 200) {
    throw Object.assign(
      new Error("A wallet group can contain at most 200 wallets"),
      { status: 400, code: "WALLET_GROUP_LIMIT_EXCEEDED" },
    );
  }
  const start = existing.length
    ? Math.max(...existing.map(({ wallet_index }) => wallet_index)) + 1
    : 1;
  const rows = Array.from({ length: count }, (_, index) => ({
    group_id: groupId,
    user_id: userId,
    wallet_index: start + index,
    provisioning_status: "planned",
    public_address: null,
    signer_reference: null,
  }));
  const created = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .insert(rows)
      .select("wallet_id,group_id,user_id,wallet_index,public_address,provisioning_status,created_at,updated_at"),
    "Unable to add wallets",
  );
  await provisionAssetWallets(supabase, userId, group, created);
  return listGroupWallets(supabase, userId, groupId);
}

async function requireEmptyWalletBeforeDelete(group, wallet) {
  if (!wallet?.public_address || wallet.provisioning_status !== "active") return;
  try {
    let atomicBalance = 0n;
    if (group.network === "solana") {
      const web3 = await solanaWeb3();
      const Connection = web3.Connection || web3.default?.Connection;
      const PublicKey = web3.PublicKey || web3.default?.PublicKey;
      if (!Connection || !PublicKey) throw new Error("Solana balance module is unavailable");
      const connection = new Connection(
        process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
        "confirmed",
      );
      atomicBalance = BigInt(await connection.getBalance(new PublicKey(wallet.public_address), "confirmed"));
    } else {
      const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
      const rpcResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [wallet.public_address, "latest"],
        }),
      });
      const payload = await rpcResponse.json();
      if (!rpcResponse.ok || payload.error || typeof payload.result !== "string") {
        throw new Error(payload.error?.message || "BSC RPC balance lookup failed");
      }
      atomicBalance = BigInt(payload.result);
    }
    if (atomicBalance > 0n) {
      throw Object.assign(
        new Error("Transfer the wallet's native balance out before deleting it"),
        { status: 409, code: "WALLET_HAS_BALANCE" },
      );
    }
  } catch (error) {
    if (error?.code === "WALLET_HAS_BALANCE") throw error;
    throw Object.assign(
      new Error("Wallet balance could not be verified; deletion was blocked"),
      { status: 503, code: "WALLET_BALANCE_CHECK_FAILED", cause: error },
    );
  }
}

async function removeWalletGroup(supabase, userId, groupId) {
  const group = await ownedGroup(supabase, userId, groupId);
  const wallets = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,group_id,user_id,public_address,provisioning_status")
      .eq("group_id", groupId)
      .eq("user_id", userId),
    "Unable to read wallets before deleting the group",
  );
  await Promise.all(
    (wallets || []).map((wallet) => requireEmptyWalletBeforeDelete(group, wallet)),
  );
  await removeFailedWalletGroup(
    supabase,
    userId,
    groupId,
    "Wallet group could not be deleted",
  );
  return { groupId, deletedWalletCount: wallets.length, groupDeleted: true };
}

async function removeGroupWallet(supabase, userId, groupId, walletId) {
  const group = await ownedGroup(supabase, userId, groupId);
  const wallet = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,group_id,user_id,public_address,provisioning_status")
      .eq("wallet_id", walletId)
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read the wallet before deleting it",
  );
  if (!wallet) {
    throw Object.assign(new Error("Wallet was not found"), {
      status: 404,
      code: "WALLET_NOT_FOUND",
    });
  }
  await requireEmptyWalletBeforeDelete(group, wallet);
  const { error } = await supabase
    .from("asset_wallets")
    .delete()
    .eq("wallet_id", walletId)
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) assetsError(error, "Unable to delete the wallet");

  const remaining = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id")
      .eq("group_id", groupId)
      .eq("user_id", userId),
    "Unable to verify the remaining wallets",
  );
  if (!remaining.length) {
    await removeFailedWalletGroup(
      supabase,
      userId,
      groupId,
      "Empty wallet group cleanup could not be confirmed",
    );
  }
  return {
    walletId,
    groupId,
    groupDeleted: remaining.length === 0,
    remainingWalletCount: remaining.length,
  };
}

async function provisionGroupWallets(supabase, userId, groupId) {
  const group = await ownedGroup(supabase, userId, groupId);
  const wallets = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,group_id,user_id,wallet_index,public_address,provisioning_status,created_at,updated_at")
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .order("wallet_index", { ascending: true }),
    "Unable to read wallets for generation",
  );
  await provisionAssetWallets(supabase, userId, group, wallets);
  return listGroupWallets(supabase, userId, groupId);
}

export async function handleAssetsRoute({
  supabase,
  request,
  response,
  session,
}) {
  const path = requestPath(request);
  const userId = authenticatedUserId(session);
  if (request.method === "GET" && path === "/api/v1/wallet-groups") {
    const groups = await listWalletGroups(supabase, userId);
    sendJson(response, 200, {
      mode: "supabase",
      balanceMode: "unavailable",
      groups,
    });
    return true;
  }
  if (request.method === "POST" && path === "/api/v1/wallet-groups") {
    const group = await createWalletGroup(
      supabase,
      userId,
      await readBody(request),
    );
    sendJson(response, 201, group);
    return true;
  }
  const groupMatch = path.match(
    /^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})$/i,
  );
  if (groupMatch && request.method === "DELETE") {
    sendJson(response, 200, await removeWalletGroup(supabase, userId, groupMatch[1]));
    return true;
  }
  const exportMatch = path.match(
    /^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/exports$/i,
  );
  if (exportMatch && request.method === "POST") {
    sendJson(
      response,
      200,
      await exportWalletGroup(
        supabase,
        userId,
        exportMatch[1],
        request,
        await readBody(request),
      ),
      { "cache-control": "private, no-store" },
    );
    return true;
  }
  const singleWalletMatch = path.match(
    /^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets\/([0-9a-f-]{36})$/i,
  );
  if (singleWalletMatch && request.method === "DELETE") {
    sendJson(
      response,
      200,
      await removeGroupWallet(supabase, userId, singleWalletMatch[1], singleWalletMatch[2]),
    );
    return true;
  }
  const groupWalletsMatch = path.match(
    /^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets$/i,
  );
  if (groupWalletsMatch && request.method === "GET") {
    sendJson(
      response,
      200,
      await listGroupWallets(supabase, userId, groupWalletsMatch[1]),
    );
    return true;
  }
  if (groupWalletsMatch && request.method === "POST") {
    const result = await addGroupWallets(
      supabase,
      userId,
      groupWalletsMatch[1],
      await readBody(request),
    );
    sendJson(response, 201, result);
    return true;
  }
  const provisionWalletsMatch = path.match(
    /^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/provision$/i,
  );
  if (provisionWalletsMatch && request.method === "POST") {
    sendJson(
      response,
      200,
      await provisionGroupWallets(supabase, userId, provisionWalletsMatch[1]),
    );
    return true;
  }
  if (request.method === "GET" && path === "/api/v1/account/portfolio") {
    const period = new URL(
      request.url || "/",
      "https://narraops.invalid",
    ).searchParams.get("period") || "7d";
    if (!["1d", "7d", "30d", "all"].includes(period)) {
      throw Object.assign(new Error("period must be 1d, 7d, 30d, or all"), {
        status: 400,
        code: "INVALID_PORTFOLIO_PERIOD",
      });
    }
    const groups = await listWalletGroups(supabase, userId);
    sendJson(response, 200, {
      mode: "supabase",
      period,
      currency: "USD",
      totalBalance: null,
      turnover: null,
      realizedPnl: null,
      unrealizedPnl: null,
      pnlPercent: null,
      balances: {},
      history: [],
      walletGroupCount: groups.length,
      walletCount: groups.reduce((sum, group) => sum + group.walletCount, 0),
      dataStatus: "live_balance_provider_required",
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
  if (
    request.method === "GET" &&
    path === "/api/v1/account/login-wallet-assets"
  ) {
    sendJson(response, 200, {
      mode: "unavailable",
      wallets: session.user.identities.map((identity) => ({
        chain: identity.chain,
        address: identity.address,
        balances: {},
      })),
    });
    return true;
  }
  return false;
}

async function createChallenge(supabase, request, response) {
  const body = await readBody(request);
  const chain = String(body.chain || "").toLowerCase();
  const identity = normalizeIdentity(chain, body.address);
  const chainId =
    body.chainId == null || body.chainId === "" ? null : Number(body.chainId);
  if (chainId != null && !Number.isSafeInteger(chainId)) {
    return apiError(response, 400, "INVALID_CHAIN_ID", "chainId is invalid");
  }
  const origin = process.env.APP_ORIGIN || "https://www.narraops.xyz";
  const nonce = randomBytes(16).toString("hex");
  const message = challengeMessage({
    chain,
    address: identity.address,
    chainId,
    nonce,
    origin,
  });
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const challenge = await requireResult(
    supabase
      .from("web3_auth_challenges")
      .insert({
        chain,
        address: identity.address,
        address_normalized: identity.normalized,
        chain_id: chainId,
        message,
        expires_at: expiresAt,
      })
      .select("challenge_id")
      .single(),
    "Unable to create the wallet challenge",
  );
  sendJson(response, 201, {
    challengeId: challenge.challenge_id,
    message,
    expiresAt,
  });
}

async function resolveUser(supabase, challenge) {
  const identity = await requireResult(
    supabase
      .from("web3_identities")
      .select("user_id")
      .eq("chain", challenge.chain)
      .eq("address_normalized", challenge.address_normalized)
      .maybeSingle(),
    "Unable to resolve wallet identity",
  );
  if (identity) return identity.user_id;

  const user = await requireResult(
    supabase.from("web3_users").insert({}).select("user_id").single(),
    "Unable to create the Web3 user",
  );
  const { error } = await supabase.from("web3_identities").insert({
    user_id: user.user_id,
    chain: challenge.chain,
    address: challenge.address,
    address_normalized: challenge.address_normalized,
    chain_id: challenge.chain_id,
  });
  if (!error) return user.user_id;

  // A concurrent verification may have created the identity first.
  await supabase.from("web3_users").delete().eq("user_id", user.user_id);
  const existing = await requireResult(
    supabase
      .from("web3_identities")
      .select("user_id")
      .eq("chain", challenge.chain)
      .eq("address_normalized", challenge.address_normalized)
      .single(),
    "Unable to resolve the existing wallet identity",
  );
  return existing.user_id;
}

async function verifyChallenge(supabase, request, response) {
  const body = await readBody(request);
  const challengeId = String(body.challengeId || "").trim();
  const signature = String(body.signature || "").trim();
  if (!challengeId || !signature) {
    return apiError(
      response,
      400,
      "INVALID_VERIFICATION",
      "challengeId and signature are required",
    );
  }
  const challenge = await requireResult(
    supabase
      .from("web3_auth_challenges")
      .select("*")
      .eq("challenge_id", challengeId)
      .maybeSingle(),
    "Unable to read the wallet challenge",
  );
  if (
    !challenge ||
    challenge.used_at ||
    Date.parse(challenge.expires_at) <= Date.now()
  ) {
    return apiError(
      response,
      401,
      "CHALLENGE_INVALID",
      "Wallet challenge is invalid, expired, or already used",
    );
  }

  let valid = false;
  if (challenge.chain === "evm") {
    try {
      valid =
        getAddress(verifyMessage(challenge.message, signature)).toLowerCase() ===
        challenge.address_normalized;
    } catch {
      valid = false;
    }
  } else {
    try {
      valid = nacl.sign.detached.verify(
        Buffer.from(challenge.message, "utf8"),
        Buffer.from(signature, "base64"),
        bs58.decode(challenge.address),
      );
    } catch {
      valid = false;
    }
  }
  if (!valid) {
    return apiError(
      response,
      401,
      "SIGNATURE_INVALID",
      "Wallet signature is invalid",
    );
  }

  const consumed = await requireResult(
    supabase
      .from("web3_auth_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("challenge_id", challengeId)
      .is("used_at", null)
      .select("challenge_id")
      .maybeSingle(),
    "Unable to consume the wallet challenge",
  );
  if (!consumed) {
    return apiError(
      response,
      409,
      "CHALLENGE_REPLAYED",
      "Wallet challenge was already used",
    );
  }

  const userId = await resolveUser(supabase, challenge);
  const token = randomBytes(32).toString("base64url");
  await requireResult(
    supabase.from("web3_sessions").insert({
      user_id: userId,
      token_hash: tokenHash(token),
      expires_at: new Date(
        Date.now() + SESSION_TTL_SECONDS * 1000,
      ).toISOString(),
    }),
    "Unable to create the Web3 session",
  );
  const session = await loadSession(supabase, {
    headers: { cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
  });
  sendJson(response, 200, session, {
    "set-cookie": sessionCookie(token, SESSION_TTL_SECONDS),
  });
}

async function logout(supabase, request, response) {
  const token = parseCookie(request.headers.cookie);
  if (token) {
    await supabase
      .from("web3_sessions")
      .delete()
      .eq("token_hash", tokenHash(token));
  }
  sendJson(
    response,
    200,
    { authenticated: false, user: null },
    { "set-cookie": sessionCookie("", 0) },
  );
}

export default async function handler(request, response) {
  const path = requestPath(request);
  if (request.method === "GET" && path === "/api/v1/health") {
    return sendJson(response, 200, {
      service: "narraops-api",
      status: "ok",
      version: "v1",
      persistence: serverSupabase() ? "supabase" : "unconfigured",
      execution: "direct_wallet_signature",
      launch: "pump_direct_wallet_signature",
      gmgn_market: gmgnCredentialsConfigured() ? "read_only" : "not_configured",
      gmgn_trade: "read_only",
      direct_swap: "direct_wallet_signature",
    });
  }
  if (request.method === "GET" && path === "/api/v1/pulse") {
    return sendJson(response, 200, await pulseStatus(serverSupabase()), {
      "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
    });
  }
  if (request.method === "GET" && path === "/api/v1/pulse/market") {
    return sendJson(
      response,
      200,
      await loadPulseMarketResponse(serverSupabase()),
      {
        "cache-control":
          "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    );
  }
  if (request.method === "GET" && path === "/api/v1/pulse/dev-wallet-pnl") {
    return sendJson(
      response,
      200,
      await loadPulseDevWalletPnlResponse(serverSupabase()),
      {
        "cache-control":
          "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      },
    );
  }
  if (request.method === "GET" && path === "/api/v1/pulse/narratives") {
    const narrativeSupabase = serverSupabase();
    const narrativeSession = narrativeSupabase
      ? await loadSession(narrativeSupabase, request)
      : null;
    return sendJson(
      response,
      200,
      await loadPulseNarrativesResponse(
        narrativeSupabase,
        new Date(),
        narrativeSession?.user?.userId || null,
      ),
      {
        "cache-control":
          narrativeSession
            ? "private, no-store"
            : "public, max-age=0, s-maxage=60, stale-while-revalidate=120",
      },
    );
  }

  if (request.method === "GET" && path === "/api/v1/agent/capabilities") {
    try {
      const capabilities = await withHardTimeout(
        getAgentCapabilities(),
        4_000,
        "getAgentCapabilities",
      );
      return sendJson(response, 200, capabilities, {
        "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      });
    } catch (error) {
      return apiError(
        response,
        error.status || 503,
        error.code || "AGENT_CAPABILITIES_UNAVAILABLE",
        error.message || "Unable to load Agent capabilities",
      );
    }
  }


  if (request.method === "POST" && path === "/api/v1/agent/conversations") {
    try {
      const body = await readBody(request);
      const authSupabase = serverSupabase();
      const session = authSupabase ? await loadSession(authSupabase, request) : null;
      const { userId: _ignoredUserId, user_id: _ignoredSnakeUserId, ...clientContext } = body.context || {};
      const userId = authenticatedUserId(session);
      const conversation = await withHardTimeout(
        createAgentConversation({
          ...body,
          context: { ...clientContext, ...(userId ? { userId } : {}) },
        }),
        6_000,
        "createAgentConversation",
      );
      return sendJson(response, 201, conversation, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "INTERNAL_ERROR",
        error.message || "Unable to create agent conversation",
      );
    }
  }

  if (request.method === "GET" && path.startsWith("/api/v1/agent/conversations/")) {
    try {
      const conversationId = path.slice("/api/v1/agent/conversations/".length);
      if (!conversationId || conversationId.includes("/")) {
        // allow message subpath to fall through if needed
      }
      if (conversationId && !conversationId.includes("/")) {
        const authSupabase = serverSupabase();
        const session = authSupabase ? await loadSession(authSupabase, request) : null;
        const userId = authenticatedUserId(session);
        const conversation = await getAgentConversation(conversationId);
        if (!conversation) {
          return apiError(response, 404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
        }
        assertAgentConversationAccess(conversation, userId);
        return sendJson(response, 200, conversation, { "cache-control": "private, no-store" });
      }
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "INTERNAL_ERROR",
        error.message || "Unable to load agent conversation",
      );
    }
  }

  if (request.method === "POST" && /^\/api\/v1\/agent\/conversations\/[^/]+\/messages$/.test(path)) {
    try {
      const conversationId = path.split("/")[5];
      const body = await readBody(request);
      const authSupabase = serverSupabase();
      const session = authSupabase ? await loadSession(authSupabase, request) : null;
      const { userId: _ignoredUserId, user_id: _ignoredSnakeUserId, ...clientContext } = body.context || {};
      const userId = authenticatedUserId(session);
      const conversation = await getAgentConversation(conversationId);
      if (!conversation) {
        return apiError(response, 404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
      }
      assertAgentConversationAccess(conversation, userId);
      const requestedTimeout = Number(body.timeout_ms || body.timeoutMs || 8_000);
      const waitTimeout = Math.min(Math.max(requestedTimeout, 1_000), 30_000);
      const result = await withHardTimeout(
        postAgentConversationMessage(conversationId, {
          ...body,
          channel: body.channel || "web",
          wait: body.wait !== false,
          timeout_ms: waitTimeout,
          context: { ...clientContext, ...(userId ? { userId } : {}) },
        }),
        waitTimeout + 8_000,
        "postAgentConversationMessage",
      );
      return sendJson(response, 200, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "INTERNAL_ERROR",
        error.message || "Unable to process agent message",
      );
    }
  }

  if (request.method === "POST" && path === "/api/v1/agent/tasks") {
    try {
      const body = await readBody(request);
      const authSupabase = serverSupabase();
      const session = authSupabase ? await loadSession(authSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const context = body.context || body.parameters?.context || {};
      const { userId: _ignoredUserId, user_id: _ignoredSnakeUserId, ...clientContext } = context;
      const result = await createAgentTask({
        ...body,
        context: { ...clientContext, ...(userId ? { userId } : {}) },
        parameters: { ...(body.parameters || {}), context: { ...clientContext, ...(userId ? { userId } : {}) } },
      });
      return sendJson(response, 202, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "INTERNAL_ERROR",
        error.message || "Unable to create agent task",
      );
    }
  }

  if (request.method === "PATCH" && path.startsWith("/api/v1/go/launch-drafts/")) {
    try {
      const draftId = path.slice("/api/v1/go/launch-drafts/".length);
      if (!draftId) {
        return apiError(response, 400, "VALIDATION_ERROR", "launch draft id is required");
      }
      const draftSupabase = serverSupabase();
      const session = draftSupabase ? await loadSession(draftSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const owned = await ownedLaunchDraft(draftSupabase, userId, draftId);
      if (!owned) return apiError(response, 404, "LAUNCH_DRAFT_NOT_FOUND", "The launch draft was not found");
      const body = await readBody(request);
      const result = await updateAgentLaunchDraft(draftId, body);
      return sendJson(response, 200, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "INTERNAL_ERROR",
        error.message || "Unable to update launch draft",
      );
    }
  }

  if (request.method === "POST" && /^\/api\/v1\/go\/launch-drafts\/[0-9a-f-]{36}\/execute$/i.test(path)) {
    try {
      const body = await readBody(request);
      if (body.confirm !== true) {
        return apiError(response, 409, "LAUNCH_CONFIRMATION_REQUIRED", "Set confirm=true after reviewing the launch fields and wallet groups");
      }
      const launchSupabase = serverSupabase();
      const session = launchSupabase ? await loadSession(launchSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const draftId = path.split("/")[5];
      const approvalDraft = await ownedLaunchDraft(launchSupabase, userId, draftId);
      if (!approvalDraft) {
        return apiError(response, 404, "LAUNCH_DRAFT_NOT_FOUND", "The launch draft was not found");
      }
      await recordAgentApprovalShadow({
        actorId: userId,
        action: "launch.prepare",
        resourceType: "go_launch_draft",
        resourceId: draftId,
        parameters: launchApprovalParameters(approvalDraft),
        status: "approved",
        legacyConfirmationKind: "explicit_boolean",
        legacyRequestId: request.headers["x-request-id"] || undefined,
      });
      const result = await executeLiveLaunchDraft({ supabase: launchSupabase, userId, draftId });
      return sendJson(response, 200, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "LIVE_LAUNCH_FAILED",
        error.message || "Unable to complete the live Pump launch",
      );
    }
  }

  if (request.method === "GET" && /^\/api\/v1\/agent\/tasks\/[0-9a-f-]{36}$/i.test(path)) {
    try {
      const taskId = path.split("/").pop();
      const taskSupabase = serverSupabase();
      const session = taskSupabase ? await loadSession(taskSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const task = await getAgentTask(taskId, userId);
      if (!task) return apiError(response, 404, "TASK_NOT_FOUND", "Agent task was not found");
      return sendJson(response, 200, {
        task_id: task.taskId || task.task_id,
        type: task.type,
        status: task.status,
        progress: task.progress,
        requires_confirmation: Boolean(task.requiresConfirmation || task.requires_confirmation),
        execution_mode: task.executionMode || task.execution_mode || "live",
        ...(task.result !== undefined ? { result: task.result } : {}),
        ...(task.failure !== undefined ? { failure: task.failure } : {}),
      }, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(response, error.status || 500, error.code || "TASK_READ_FAILED", error.message || "Unable to read agent task");
    }
  }

  if (request.method === "GET" && path === "/api/v1/agent/events") {
    try {
      const eventSupabase = serverSupabase();
      const session = eventSupabase ? await loadSession(eventSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const url = new URL(request.url || "/", "https://narraops.invalid");
      const taskId = String(url.searchParams.get("taskId") || "");
      if (!/^[0-9a-f-]{36}$/i.test(taskId)) {
        return apiError(response, 400, "VALIDATION_ERROR", "taskId is required");
      }
      const afterSequence = Math.max(0, Number(url.searchParams.get("cursor") || 0) || 0);
      const events = await listAgentTaskEvents(taskId, userId, { afterSequence, limit: 200 });
      if (!events) return apiError(response, 404, "TASK_NOT_FOUND", "Agent task was not found");
      const nextCursor = events.length
        ? String(events.at(-1).sequence || afterSequence)
        : String(afterSequence);
      return sendJson(response, 200, {
        schema_version: "agent.events.v1",
        task_id: taskId,
        events,
        next_cursor: nextCursor,
      }, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(response, error.status || 500, error.code || "EVENT_READ_FAILED", error.message || "Unable to read Agent events");
    }
  }

  if (
    process.env.AGENT_APPROVAL_API_ENABLED === "true"
    && /^\/api\/v1\/agent\/approvals\/[0-9a-f-]{36}(?:\/(?:approve|reject))?$/i.test(path)
  ) {
    try {
      const approvalSupabase = serverSupabase();
      const session = approvalSupabase ? await loadSession(approvalSupabase, request) : null;
      await handleAgentApprovalRoute({ request, response, session });
      return;
    } catch (error) {
      return apiError(
        response,
        approvalErrorStatus(error),
        error.code || "APPROVAL_REQUEST_FAILED",
        error.message || "Unable to process approval",
      );
    }
  }

  if (
    process.env.AGENT_MEMORY_API_ENABLED === "true"
    && (
      path === "/api/v1/agent/memories"
      || path === "/api/v1/agent/memories/proposals"
      || /^\/api\/v1\/agent\/memories\/[0-9a-f-]{36}\/(?:confirm|reject|forget)$/i.test(path)
    )
  ) {
    try {
      const memorySupabase = serverSupabase();
      const session = memorySupabase ? await loadSession(memorySupabase, request) : null;
      await handleAgentMemoryRoute({ request, response, session });
      return;
    } catch (error) {
      return apiError(
        response,
        memoryErrorStatus(error),
        error.code || "AGENT_MEMORY_REQUEST_FAILED",
        error.message || "Unable to process Agent memory",
      );
    }
  }

  if (request.method === "POST" && /^\/api\/v1\/agent\/tasks\/[0-9a-f-]{36}\/cancel$/i.test(path)) {
    try {
      const taskSupabase = serverSupabase();
      const session = taskSupabase ? await loadSession(taskSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const taskId = path.split("/")[5];
      const body = await readBody(request);
      const task = await cancelAgentTask(taskId, userId, body.reason);
      if (!task) return apiError(response, 404, "TASK_NOT_FOUND", "Agent task was not found");
      return sendJson(response, 200, {
        task_id: task.taskId,
        status: task.status,
        progress: task.progress,
        updated_at: task.updatedAt,
        ...(task.failure ? { failure: task.failure } : {}),
      }, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(response, error.status || 500, error.code || "TASK_CANCEL_FAILED", error.message || "Unable to cancel Agent task");
    }
  }

  if (request.method === "POST" && /^\/api\/v1\/go\/launch-drafts\/[0-9a-f-]{36}\/submit$/i.test(path)) {
    try {
      const body = await readBody(request);
      const launchSupabase = serverSupabase();
      const session = launchSupabase ? await loadSession(launchSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const draftId = path.split("/")[5];
      const approvalDraft = await ownedLaunchDraft(launchSupabase, userId, draftId);
      if (!approvalDraft) {
        return apiError(response, 404, "LAUNCH_DRAFT_NOT_FOUND", "The launch draft was not found");
      }
      const result = await submitDirectLaunchDraft({
        supabase: launchSupabase,
        userId,
        draftId,
        signedTransactionBase64: body.signedTransactionBase64 || body.signed_transaction_base64,
      });
      const expected = approvalDraft.metadata?.direct_execution || {};
      await recordAgentApprovalShadow({
        actorId: userId,
        action: "launch.broadcast",
        resourceType: "go_launch_draft",
        resourceId: draftId,
        parameters: {
          message_hash: expected.message_hash || null,
          mint_address: expected.mint_address || null,
          cooking_wallet_group_id:
            expected.cooking_wallet_group_id
            || approvalDraft.metadata?.cooking_wallet_group_id
            || null,
        },
        status: "consumed",
        legacyConfirmationKind: "verified_wallet_signature",
        legacyRequestId: request.headers["x-request-id"] || undefined,
      });
      return sendJson(response, 200, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "DIRECT_LAUNCH_SUBMIT_FAILED",
        error.message || "Unable to submit the signed Pump launch",
      );
    }
  }

  if (request.method === "POST" && path === "/api/v1/swaps/submit") {
    try {
      const body = await readBody(request);
      const swapSupabase = serverSupabase();
      const session = swapSupabase ? await loadSession(swapSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const result = await submitDirectSwap({
        supabase: swapSupabase,
        userId,
        walletGroupId: body.walletGroupId || body.wallet_group_id,
        signedTransactionBase64: body.signedTransactionBase64 || body.signed_transaction_base64,
        messageHash: body.messageHash || body.message_hash,
      });
      const encoded = String(body.signedTransactionBase64 || body.signed_transaction_base64 || "");
      await recordAgentApprovalShadow({
        actorId: userId,
        action: "swap.broadcast",
        resourceType: "asset_wallet_group",
        resourceId: body.walletGroupId || body.wallet_group_id,
        parameters: {
          message_hash: body.messageHash || body.message_hash || null,
          signed_transaction_digest: createHash("sha256").update(encoded).digest("hex"),
          provider: "jupiter",
        },
        status: "consumed",
        legacyConfirmationKind: "verified_wallet_signature",
        legacyRequestId: request.headers["x-request-id"] || undefined,
      });
      return sendJson(response, 200, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "DIRECT_SWAP_SUBMIT_FAILED",
        error.message || "Unable to complete the direct Swap",
      );
    }
  }

  if (request.method === "POST" && path === "/api/v1/transfers/preview") {
    try {
      const body = await readBody(request);
      const transferSupabase = serverSupabase();
      const session = transferSupabase ? await loadSession(transferSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const { preview } = await transferPreview({
        supabase: transferSupabase,
        userId,
        body,
      });
      return sendJson(response, 201, preview, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "TRANSFER_PREVIEW_FAILED",
        error.message || "Unable to preview the transfer",
      );
    }
  }

  if (request.method === "POST" && path === "/api/v1/transfers") {
    try {
      const body = await readBody(request);
      const transferSupabase = serverSupabase();
      const session = transferSupabase ? await loadSession(transferSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const result = await transferCreate({
        supabase: transferSupabase,
        userId,
        body,
        headerIdempotencyKey: request.headers["idempotency-key"],
      });
      return sendJson(response, 202, result, { "cache-control": "private, no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "TRANSFER_SUBMIT_FAILED",
        error.message || "Unable to complete the transfer",
      );
    }
  }

  if (request.method === "POST" && path === "/api/v1/telegram/webhook") {
    try {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
      if (secret) {
        const provided =
          request.headers["x-telegram-bot-api-secret-token"] ||
          request.headers["x-narraops-telegram-secret"] ||
          "";
        if (provided !== secret) {
          return apiError(response, 401, "TELEGRAM_WEBHOOK_UNAUTHORIZED", "Invalid Telegram webhook secret");
        }
      }
      const body = await readBody(request);
      const result = await handleTelegramWebhook(body);
      return sendJson(response, 200, result, { "cache-control": "no-store" });
    } catch (error) {
      return apiError(
        response,
        error.status || 500,
        error.code || "INTERNAL_ERROR",
        error.message || "Unable to handle Telegram webhook",
      );
    }
  }

  if (request.method === "POST" && path === "/api/v1/go/plan") {
    const body = await readBody(request);
    const directAgentInput = [
      body.command,
      body.message,
      typeof body.input === "string" ? body.input : null,
    ].find((value) => typeof value === "string" && value.trim());
    if (/^\s*\/(?:analyze-meme|analyze)\b/i.test(String(directAgentInput || ""))) {
      try {
        const agentResult = await getSharedAgentRuntime().handleMessage({
          channel: "web",
          message: String(directAgentInput).trim(),
          command: String(directAgentInput).trim(),
          context: body.context || { language: "zh", currentView: "go" },
          wait: true,
          timeoutMs: Number(body.timeoutMs || 20_000),
        });
        return sendJson(
          response,
          200,
          {
            ...agentResult,
            card: agentResult.cards?.[0] || null,
          },
          { "cache-control": "private, no-store" },
        );
      } catch (error) {
        return apiError(
          response,
          error.status || 500,
          error.code || "AGENT_RUNTIME_ERROR",
          error.message || "Unable to analyze the meme contract",
        );
      }
    }
    const snapshotId = body.snapshotId || body.snapshot_id || null;
    if (snapshotId) {
      const narrativeSupabase = serverSupabase();
      if (!narrativeSupabase) {
        return apiError(
          response,
          503,
          "SUPABASE_SERVER_NOT_CONFIGURED",
          "Server-side Supabase persistence is not configured",
        );
      }
      try {
        if (
          typeof snapshotId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            snapshotId,
          )
        ) {
          return apiError(
            response,
            400,
            "INVALID_NARRATIVE_SNAPSHOT_ID",
            "Narrative snapshot id must be a UUID",
          );
        }
        const narrativeSession = await loadSession(narrativeSupabase, request);
        const userId = authenticatedUserId(narrativeSession);
        const snapshot = await requireResult(
          narrativeSupabase
            .from("pulse_narrative_snapshots")
            .select(
              "snapshot_id,narrative_id,category,platform,source_type,author_name,original_text,source_url,media_type,media_urls,video_thumbnail_url,source_published_at,source_expires_at,created_at",
            )
            .eq("snapshot_id", snapshotId)
            .eq("user_id", userId)
            .maybeSingle(),
          "Unable to read the private narrative snapshot",
        );
        if (!snapshot) {
          return apiError(
            response,
            404,
            "NARRATIVE_SNAPSHOT_NOT_FOUND",
            "Narrative snapshot was not found",
          );
        }
        return sendJson(
          response,
          200,
          buildNarrativeSnapshotPlanResponse(snapshot),
          { "cache-control": "private, no-store" },
        );
      } catch (error) {
        return apiError(
          response,
          error.status || 500,
          error.code || "INTERNAL_ERROR",
          error.message || "Unable to load the private narrative snapshot",
        );
      }
    }
    const result = buildPulsePlanResponse(await pulseStatus(serverSupabase()), {
      opportunityId: body.opportunityId || body.opportunity_id || null,
      message: body.message || body.input || null,
      command: body.command || null,
    });
    if (!result.ok) {
      return apiError(response, result.status, result.code, result.message);
    }
    return sendJson(response, 200, result.body, {
      "cache-control": "no-store",
    });
  }

  const supabase = serverSupabase();
  if (!supabase) {
    return apiError(
      response,
      503,
      "SUPABASE_SERVER_NOT_CONFIGURED",
      "Server-side Supabase persistence is not configured",
    );
  }

  try {
    if (
      request.method === "POST" &&
      path === "/api/v1/auth/web3/challenge"
    ) {
      return await createChallenge(supabase, request, response);
    }
    if (
      request.method === "POST" &&
      path === "/api/v1/auth/web3/verify"
    ) {
      return await verifyChallenge(supabase, request, response);
    }
    if (request.method === "GET" && path === "/api/v1/auth/session") {
      const session = await loadSession(supabase, request);
      return sendJson(
        response,
        200,
        session || { authenticated: false, user: null },
      );
    }
    if (request.method === "POST" && path === "/api/v1/auth/logout") {
      return await logout(supabase, request, response);
    }
    if (request.method === "POST" && path === "/api/v1/auth/onboarding/complete") {
      const session = await loadSession(supabase, request);
      const userId = authenticatedUserId(session);
      const { error } = await supabase
        .from("web3_users")
        .update({ onboarding_completed: true })
        .eq("user_id", userId);
      if (error) {
        return apiError(
          response,
          500,
          error.code || "ONBOARDING_UPDATE_FAILED",
          error.message || "Unable to complete onboarding",
        );
      }
      return sendJson(response, 200, { onboardingCompleted: true });
    }
    if (
      request.method === "POST" &&
      path === "/api/v1/pulse/narratives/state"
    ) {
      const session = await loadSession(supabase, request);
      const userId = authenticatedUserId(session);
      const body = await readBody(request);
      const narrativeId = String(body.narrative_id || "").trim();
      const state = String(body.state || "").trim();
      if (!narrativeId || !["dismissed", "used"].includes(state)) {
        return apiError(
          response,
          400,
          "INVALID_NARRATIVE_STATE",
          "narrative_id and state (dismissed or used) are required",
        );
      }
      if (state === "dismissed") {
        return sendJson(
          response,
          200,
          await dismissPulseNarrative(supabase, userId, narrativeId),
          { "cache-control": "private, no-store" },
        );
      }
      return sendJson(
        response,
        201,
        { snapshot: await usePulseNarrative(supabase, userId, narrativeId) },
        { "cache-control": "private, no-store" },
      );
    }
    if (
      path === "/api/v1/wallet-groups" ||
      path === "/api/v1/account/portfolio" ||
      path === "/api/v1/account/login-wallet-assets" ||
      /^\/api\/v1\/wallet-groups\/[0-9a-f-]{36}\/wallets$/i.test(path) ||
      /^\/api\/v1\/wallet-groups\/[0-9a-f-]{36}$/i.test(path) ||
      /^\/api\/v1\/wallet-groups\/[0-9a-f-]{36}\/exports$/i.test(path) ||
      /^\/api\/v1\/wallet-groups\/[0-9a-f-]{36}\/wallets\/[0-9a-f-]{36}$/i.test(path) ||
      /^\/api\/v1\/wallet-groups\/[0-9a-f-]{36}\/wallets\/[0-9a-f-]{36}\/bind$/i.test(path)
    ) {
      const session = await loadSession(supabase, request);
      if (
        await handleAssetsRoute({
          supabase,
          request,
          response,
          session,
        })
      ) {
        return;
      }
    }
    return apiError(response, 404, "ROUTE_NOT_FOUND", "API route was not found");
  } catch (error) {
    console.error("api_request_failed", {
      path,
      code: error?.code || "INTERNAL_ERROR",
      status: error?.status || 500,
      message: error?.message || String(error),
      stack: error?.stack || null,
    });
    const status = Number(error?.status) || 500;
    const code = error?.code || "INTERNAL_ERROR";
    const message = String(error?.message || error || "Unexpected API error");
    return apiError(response, status, code, message);
  }
}
