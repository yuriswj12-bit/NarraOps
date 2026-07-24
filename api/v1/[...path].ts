// @ts-nocheck
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { getAddress, verifyMessage } from "ethers";

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

function requestPath(request) {
  return new URL(request.url || "/", "https://narraops.invalid").pathname;
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
      execution: "disabled",
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
