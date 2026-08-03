// @ts-nocheck
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { getAddress, verifyMessage } from "ethers";
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
  getAgentConversation,
  handleTelegramWebhook,
  getSharedAgentRuntime,
  postAgentConversationMessage,
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
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "image/*" },
    });
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
  const session = await requireResult(
    supabase
      .from("web3_sessions")
      .select("session_id,user_id,expires_at")
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

function assetsError(error, fallbackMessage) {
  console.error("supabase_assets_operation_failed", {
    code: error?.code,
    message: error?.message,
  });
  const persistenceNotReady = ["42P01", "PGRST204", "PGRST205"].includes(
    error?.code,
  );
  throw Object.assign(
    new Error(
      persistenceNotReady
        ? "Assets persistence has not been migrated yet"
        : fallbackMessage,
    ),
    {
      status: 503,
      code: persistenceNotReady
        ? "ASSETS_PERSISTENCE_NOT_READY"
        : "ASSETS_PERSISTENCE_UNAVAILABLE",
    },
  );
}

async function requireAssetsResult(promise, fallbackMessage) {
  const { data, error } = await promise;
  if (error) assetsError(error, fallbackMessage);
  return data;
}

function gmgnCredentialsConfigured() {
  return Boolean(
    String(process.env.GMGN_API_KEY || "").trim(),
  );
}

function gmgnTradeCapability() {
  return process.env.GMGN_TRADE_ENABLED === "true"
    ? "authorized_wallets_only"
    : "not_enabled";
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

function launchPlatformId(platform) {
  if (platform && typeof platform === "object") return String(platform.id || platform.name || "").toLowerCase();
  return String(platform || "").toLowerCase();
}

function nestedGmgnValue(result, keys) {
  const roots = [result, result?.data, result?.data?.report, result?.report];
  for (const root of roots) {
    if (!root || typeof root !== "object") continue;
    for (const key of keys) {
      const value = root[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value);
    }
  }
  return null;
}

function gmgnOrderId(result) {
  return nestedGmgnValue(result, ["order_id", "orderId"]);
}

function gmgnTokenAddress(result) {
  return nestedGmgnValue(result, ["output_token", "outputToken", "token_address", "tokenAddress", "mint_address", "mintAddress"]);
}

function gmgnTxHash(result) {
  return nestedGmgnValue(result, ["hash", "tx_hash", "txHash", "transaction_hash", "transactionHash"]);
}

function gmgnStatus(result) {
  return String(
    result?.data?.status || result?.data?.state || result?.data?.order_status || result?.data?.report?.status || result?.status || "",
  ).toLowerCase();
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
      .select("wallet_id,public_address,provisioning_status,wallet_index,signer_reference")
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
  const bundleBuy = token.bundle_buy_per_wallet ? positiveDecimal(token.bundle_buy_per_wallet, "bundle_buy_per_wallet") : null;
  if (!token.name || !token.symbol || !token.description || !token.image_url) {
    throw Object.assign(new Error("Complete token name, symbol, description, and image URL before launching"), {
      status: 400,
      code: "LAUNCH_DRAFT_INCOMPLETE",
    });
  }
  if (bundleBuy) {
    throw Object.assign(new Error("Bundled buys need a signer for every selected wallet. GMGN is not used for Pump launch execution, and this wallet group is not yet connected to a direct signer."), {
      status: 409,
      code: "DIRECT_BUNDLED_BUY_REQUIRES_SIGNER",
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
      bundled_wallet_count: 0,
    };
  }
  if (existing.status === "requires_user_signature" && existing.transaction_base64 && existing.message_hash) {
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
      bundled_wallet_count: 0,
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
  const execution = {
    provider: "pump.fun",
    launchpad: "pump",
    execution_mode: "client_signed",
    status: "requires_user_signature",
    mint_address: plan.mintAddress,
    metadata_uri: plan.metadataUri,
    transaction_base64: plan.transactionBase64,
    message_hash: createHash("sha256").update(Transaction.from(Buffer.from(plan.transactionBase64, "base64")).serializeMessage()).digest("hex"),
    last_valid_block_height: plan.lastValidBlockHeight,
    cooking_wallet_group_id: cookingId,
    bundled_wallet_group_id: bundledId,
    bundled_wallet_count: 0,
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
    message: "Pump transaction prepared. Sign it with the selected Cooking wallet to broadcast it.",
  };
}

async function submitDirectLaunchDraft({ supabase, userId, draftId, signedTransactionBase64 }) {
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
  const connection = (await directLaunchPlanner()).pump.connection;
  let txHash;
  try {
    txHash = await connection.sendRawTransaction(Buffer.from(encoded, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
    const confirmation = await connection.confirmTransaction(txHash, "confirmed");
    if (confirmation?.value?.err) throw new Error("Pump launch transaction failed on-chain");
  } catch (error) {
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
  const execution = { ...expected, status: "confirmed", tx_hash: txHash, token_address: expected.mint_address, updated_at: new Date().toISOString() };
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
  return {
    schema_version: "go.launch_execution.v1",
    status: "confirmed",
    provider: "pump.fun",
    execution_mode: "client_signed",
    launchpad: "pump",
    tx_hash: txHash,
    token_address: expected.mint_address,
    cooking_wallet_group_id: cookingId,
    bundled_wallet_group_id: expected.bundled_wallet_group_id || draft.metadata?.bundled_wallet_group_id || null,
    bundled_wallet_count: 0,
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
    custodyMode: isBound ? "provider_bound" : "unprovisioned",
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
    executionMode: activeWalletCount > 0 ? "live_ready" : "provider_binding_required",
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

async function createWalletGroup(supabase, userId, body) {
  const input = validateGroupInput(body);
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
  const { error } = await supabase.from("asset_wallets").insert(walletRows);
  if (error) {
    await supabase
      .from("asset_wallet_groups")
      .delete()
      .eq("group_id", group.group_id)
      .eq("user_id", userId);
    assetsError(error, "Unable to create planned wallets");
  }
  return publicGroup(group, input.walletCount);
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
  await requireAssetsResult(
    supabase.from("asset_wallets").insert(rows),
    "Unable to add planned wallets",
  );
  return listGroupWallets(supabase, userId, groupId);
}

async function bindWalletAddress(supabase, userId, groupId, walletId, body) {
  const group = await ownedGroup(supabase, userId, groupId);
  if (group.network !== "solana") {
    throw Object.assign(new Error("Only Solana provider wallets can be bound to live Go execution right now"), {
      status: 400,
      code: "WALLET_NETWORK_UNSUPPORTED",
    });
  }
  const publicAddress = String(body?.publicAddress || body?.public_address || "").trim();
  if (!validSolanaAddress(publicAddress)) {
    throw Object.assign(new Error("publicAddress must be a valid Solana address"), {
      status: 400,
      code: "INVALID_PUBLIC_ADDRESS",
    });
  }
  const wallet = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id,group_id,user_id")
      .eq("wallet_id", walletId)
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .maybeSingle(),
    "Unable to read the wallet to bind",
  );
  if (!wallet) {
    throw Object.assign(new Error("Wallet was not found in the selected group"), {
      status: 404,
      code: "WALLET_NOT_FOUND",
    });
  }
  const duplicate = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .select("wallet_id")
      .eq("user_id", userId)
      .eq("public_address", publicAddress)
      .neq("wallet_id", walletId)
      .maybeSingle(),
    "Unable to verify the wallet address",
  );
  if (duplicate) {
    throw Object.assign(new Error("This Solana address is already bound to another wallet in your account"), {
      status: 409,
      code: "PUBLIC_ADDRESS_ALREADY_BOUND",
    });
  }
  const signerReference = String(body?.signerReference || body?.signer_reference || "").trim();
  const updated = await requireAssetsResult(
    supabase
      .from("asset_wallets")
      .update({
        public_address: publicAddress,
        provisioning_status: "active",
        signer_reference: signerReference || null,
        updated_at: new Date().toISOString(),
      })
      .eq("wallet_id", walletId)
      .eq("group_id", groupId)
      .eq("user_id", userId)
      .select("wallet_id,group_id,user_id,wallet_index,public_address,provisioning_status,created_at,updated_at")
      .single(),
    "Unable to bind the provider wallet",
  );
  const listing = await listGroupWallets(supabase, userId, groupId);
  return {
    mode: "live",
    provider: "external_wallet",
    group: listing.group,
    wallet: publicWallet(updated, group.network),
    wallets: listing.wallets,
    note: "Only the public address and optional provider reference were stored. Private keys are never accepted by this endpoint.",
  };
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
  const bindWalletMatch = path.match(
    /^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets\/([0-9a-f-]{36})\/bind$/i,
  );
  if (bindWalletMatch && request.method === "POST") {
    const result = await bindWalletAddress(
      supabase,
      userId,
      bindWalletMatch[1],
      bindWalletMatch[2],
      await readBody(request),
    );
    sendJson(response, 200, result);
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
      gmgn_trade: gmgnTradeCapability(),
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


  if (request.method === "POST" && path === "/api/v1/agent/conversations") {
    try {
      const body = await readBody(request);
      const authSupabase = serverSupabase();
      const session = authSupabase ? await loadSession(authSupabase, request) : null;
      const { userId: _ignoredUserId, user_id: _ignoredSnakeUserId, ...clientContext } = body.context || {};
      const userId = authenticatedUserId(session);
      const conversation = await createAgentConversation({
        ...body,
        context: { ...clientContext, ...(userId ? { userId } : {}) },
      });
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
    const conversationId = path.slice("/api/v1/agent/conversations/".length);
    if (!conversationId || conversationId.includes("/")) {
      // allow message subpath to fall through if needed
    }
    if (conversationId && !conversationId.includes("/")) {
      const conversation = await getAgentConversation(conversationId);
      if (!conversation) {
        return apiError(response, 404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
      }
      return sendJson(response, 200, conversation, { "cache-control": "private, no-store" });
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
      const result = await postAgentConversationMessage(conversationId, {
        ...body,
        channel: body.channel || "web",
        wait: body.wait !== false,
        context: { ...clientContext, ...(userId ? { userId } : {}) },
      });
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

  if (request.method === "POST" && /^\/api\/v1\/go\/launch-drafts\/[0-9a-f-]{36}\/submit$/i.test(path)) {
    try {
      const body = await readBody(request);
      const launchSupabase = serverSupabase();
      const session = launchSupabase ? await loadSession(launchSupabase, request) : null;
      const userId = authenticatedUserId(session);
      const draftId = path.split("/")[5];
      const result = await submitDirectLaunchDraft({
        supabase: launchSupabase,
        userId,
        draftId,
        signedTransactionBase64: body.signedTransactionBase64 || body.signed_transaction_base64,
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
      code: error.code || "INTERNAL_ERROR",
      message: error.message,
    });
    return apiError(
      response,
      error.status || 500,
      error.code || "INTERNAL_ERROR",
      error.status ? error.message : "Unexpected API error",
    );
  }
}
