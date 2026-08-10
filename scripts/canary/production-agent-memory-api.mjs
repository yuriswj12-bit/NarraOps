import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const appOrigin = process.env.APP_ORIGIN || "https://www.narraops.xyz";

if (!supabaseUrl || !supabaseSecret) {
  throw new Error("Server-only Supabase credentials are required");
}

const supabase = createClient(supabaseUrl, supabaseSecret, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

const actors = [randomUUID(), randomUUID()];
const sessions = actors.map(() => ({
  sessionId: randomUUID(),
  token: randomBytes(32).toString("base64url"),
}));
const idempotencyKey = `canary:memory-api:${randomUUID()}`;
const walletGroupId = randomUUID();
const walletId = randomUUID();
let memoryId;
let conversationId;
let completedChecks = [];

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookie(index) {
  return `narraops_session=${encodeURIComponent(sessions[index].token)}`;
}

async function request(path, {
  method = "GET",
  actor = 0,
  origin,
  body,
  headers = {},
} = {}) {
  const response = await fetch(`${appOrigin}${path}`, {
    method,
    headers: {
      cookie: cookie(actor),
      ...(origin ? { origin } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function requireSupabase(operation, label) {
  const { error } = await operation;
  if (error) throw new Error(`${label}: ${error.message}`);
}

async function cleanupWithRetry(factory, label) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const { error } = await factory();
    if (!error) return;
    lastError = error;
    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw new Error(`${label}: ${lastError?.message || "unknown cleanup error"}`);
}

try {
  await requireSupabase(
    supabase.from("web3_users").insert(actors.map((userId) => ({
      user_id: userId,
      display_name: "Agent Memory API Canary",
      onboarding_completed: true,
    }))),
    "Unable to create canary users",
  );
  await requireSupabase(
    supabase.from("web3_sessions").insert(sessions.map((session, index) => ({
      session_id: session.sessionId,
      user_id: actors[index],
      token_hash: tokenHash(session.token),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }))),
    "Unable to create canary sessions",
  );
  if (process.env.EXPECT_ASSETS_TOOL === "true") {
    await requireSupabase(
      supabase.from("asset_wallet_groups").insert({
        group_id: walletGroupId,
        user_id: actors[0],
        name: "Canary",
        purpose: "general",
        network: "solana",
      }),
      "Unable to create canary wallet group",
    );
    await requireSupabase(
      supabase.from("asset_wallets").insert({
        wallet_id: walletId,
        group_id: walletGroupId,
        user_id: actors[0],
        wallet_index: 1,
        public_address: "11111111111111111111111111111111",
        provisioning_status: "active",
        signer_reference: "canary:no-signer",
      }),
      "Unable to create canary public wallet projection",
    );
  }

  const capabilities = await request("/api/v1/agent/capabilities");
  const capabilitiesJson = JSON.stringify(capabilities.payload);
  const expectedAgentVersion = Number(process.env.EXPECT_AGENT_VERSION || 1);
  const marketSkill = capabilities.payload?.skills?.find(
    (skill) => skill.slug === "market-research",
  );
  if (
    capabilities.response.status !== 200
    || capabilities.payload?.schema_version !== "agent.capabilities.v1"
    || capabilities.payload?.agent?.slug !== "narraops-agent"
    || capabilities.payload?.agent?.version !== expectedAgentVersion
    || capabilities.payload?.skills?.length !== 4
    || !Array.isArray(capabilities.payload?.published_financial_tools)
    || capabilities.payload.published_financial_tools.length !== 0
    || (
      process.env.EXPECT_MARKET_TOOL_V2 === "true"
      && (
        marketSkill?.required_tools?.[0]?.name !== "market.gmgn.trending"
        || marketSkill?.required_tools?.[0]?.version !== "2.0.0"
      )
    )
    || [
      "systemInstructions",
      "checksum",
      "agentVersionId",
      "skillVersionId",
      "instructions",
      "inputSchema",
      "binding",
      "config",
    ].some((field) => capabilitiesJson.includes(`"${field}"`))
  ) {
    throw new Error(
      `Public Agent capabilities canary failed with ${capabilities.response.status}`,
    );
  }

  const proposed = await request("/api/v1/agent/memories/proposals", {
    method: "POST",
    origin: appOrigin,
    headers: { "idempotency-key": idempotencyKey },
    body: {
      kind: "user_preference",
      content: "Production canary prefers Chinese responses.",
    },
  });
  if (
    proposed.response.status !== 201
    || proposed.payload?.item?.status !== "proposed"
    || proposed.payload?.idempotentReplay !== false
  ) {
    throw new Error(`Memory proposal failed with ${proposed.response.status}`);
  }
  memoryId = proposed.payload.item.memoryId;

  const replay = await request("/api/v1/agent/memories/proposals", {
    method: "POST",
    origin: appOrigin,
    headers: { "idempotency-key": idempotencyKey },
    body: {
      kind: "user_preference",
      content: "Production canary prefers Chinese responses.",
    },
  });
  if (replay.response.status !== 200 || replay.payload?.idempotentReplay !== true) {
    throw new Error("Memory proposal idempotent replay failed");
  }

  const beforeConfirmation = await request("/api/v1/agent/memories");
  if (
    beforeConfirmation.response.status !== 200
    || beforeConfirmation.payload?.memories?.length !== 0
  ) {
    throw new Error("Proposed Memory was visible before confirmation");
  }

  const reviewBefore = await request("/api/v1/agent/memories?review=true&limit=20");
  if (
    reviewBefore.response.status !== 200
    || reviewBefore.payload?.memories?.length !== 1
    || reviewBefore.payload.memories[0]?.memoryId !== memoryId
    || reviewBefore.payload.memories[0]?.status !== "proposed"
  ) {
    throw new Error("Proposed Memory was not available for explicit review");
  }

  const crossActor = await request(
    `/api/v1/agent/memories/${memoryId}/confirm`,
    {
      method: "POST",
      actor: 1,
      origin: appOrigin,
      body: { expectedStateVersion: 1 },
    },
  );
  if (crossActor.response.status !== 404) {
    throw new Error(`Cross-actor decision returned ${crossActor.response.status}`);
  }

  const confirmed = await request(
    `/api/v1/agent/memories/${memoryId}/confirm`,
    {
      method: "POST",
      origin: appOrigin,
      body: { expectedStateVersion: 1 },
    },
  );
  if (
    confirmed.response.status !== 200
    || confirmed.payload?.status !== "active"
    || confirmed.payload?.stateVersion !== 2
  ) {
    throw new Error("Explicit Memory confirmation failed");
  }

  const active = await request("/api/v1/agent/memories");
  if (
    active.response.status !== 200
    || active.payload?.memories?.length !== 1
    || active.payload.memories[0]?.memoryId !== memoryId
  ) {
    throw new Error("Confirmed Memory retrieval failed");
  }

  if (process.env.EXPECT_AGENT_KNOWLEDGE === "true") {
    const conversation = await request("/api/v1/agent/conversations", {
      method: "POST",
      origin: appOrigin,
      body: {
        channel: "web",
        context: { language: "en", currentView: "go" },
      },
    });
    if (conversation.response.status !== 201) {
      throw new Error(`Agent conversation creation failed with ${conversation.response.status}`);
    }
    conversationId =
      conversation.payload?.conversation_id || conversation.payload?.conversationId;
    if (!conversationId) throw new Error("Agent conversation id was not returned");

    const reply = await request(
      `/api/v1/agent/conversations/${conversationId}/messages`,
      {
        method: "POST",
        origin: appOrigin,
        body: {
          message: "What can you do?",
          wait: true,
          timeout_ms: 15_000,
          context: { language: "en", currentView: "go" },
        },
      },
    );
    const knowledge = reply.payload?.agent?.knowledge;
    if (
      reply.response.status !== 200
      || reply.payload?.status !== "succeeded"
      || knowledge?.agent_slug !== "narraops-agent"
      || knowledge?.agent_version !== Number(process.env.EXPECT_AGENT_VERSION || 1)
      || knowledge?.memory_count !== 1
    ) {
      throw new Error("Runtime knowledge compatibility canary failed");
    }

    const pulseTool = await request(
      `/api/v1/agent/conversations/${conversationId}/messages`,
      {
        method: "POST",
        origin: appOrigin,
        body: {
          message: "/narrative production-canary",
          command: "/narrative production-canary",
          wait: true,
          timeout_ms: 15_000,
          context: { language: "en", currentView: "go" },
        },
      },
    );
    if (
      pulseTool.response.status !== 200
      || pulseTool.payload?.status !== "succeeded"
      || pulseTool.payload?.task?.result?.tool?.name !== "pulse.narratives.list"
      || pulseTool.payload?.task?.result?.tool?.version !== "1.0.0"
    ) {
      throw new Error("Runtime Pulse Tool Registry canary failed");
    }

    if (process.env.EXPECT_MARKET_TOOL_V2 === "true") {
      const marketTool = await request(
        `/api/v1/agent/conversations/${conversationId}/messages`,
        {
          method: "POST",
          origin: appOrigin,
          body: {
            message: "/market-trending solana",
            command: "/market-trending solana",
            wait: true,
            timeout_ms: 20_000,
            context: { language: "en", currentView: "go" },
          },
        },
      );
      if (
        marketTool.response.status !== 200
        || marketTool.payload?.status !== "succeeded"
        || marketTool.payload?.task?.result?.tool?.name !== "market.gmgn.trending"
        || marketTool.payload?.task?.result?.tool?.version !== "2.0.0"
      ) {
        throw new Error("Runtime GMGN Tool Registry v2 canary failed");
      }
    }

    if (process.env.EXPECT_ASSETS_TOOL === "true") {
      const assetsTool = await request(
        `/api/v1/agent/conversations/${conversationId}/messages`,
        {
          method: "POST",
          origin: appOrigin,
          body: {
            message: "/buy So11111111111111111111111111111111111111112 1 SOL wallet group Canary",
            command: "/buy So11111111111111111111111111111111111111112 1 SOL wallet group Canary",
            wait: true,
            timeout_ms: 15_000,
            context: { language: "en", currentView: "go" },
          },
        },
      );
      if (
        assetsTool.response.status !== 200
        || assetsTool.payload?.status !== "succeeded"
        || assetsTool.payload?.task?.result?.wallet_context_tool?.name
          !== "assets.wallet_groups.list"
        || assetsTool.payload?.task?.result?.wallet_context_tool?.version
          !== "1.0.0"
        || assetsTool.payload?.task?.result?.wallet_group_id !== walletGroupId
        || assetsTool.payload?.task?.result?.status !== "requires_user_confirmation"
      ) {
        throw new Error("Runtime Assets Tool Registry canary failed");
      }
    }
  }

  const untrustedOrigin = await request(
    `/api/v1/agent/memories/${memoryId}/forget`,
    {
      method: "POST",
      origin: "https://attacker.invalid",
      body: { expectedStateVersion: 2 },
    },
  );
  if (untrustedOrigin.response.status !== 403) {
    throw new Error(`Untrusted origin returned ${untrustedOrigin.response.status}`);
  }

  const forgotten = await request(
    `/api/v1/agent/memories/${memoryId}/forget`,
    {
      method: "POST",
      origin: appOrigin,
      body: { expectedStateVersion: 2 },
    },
  );
  if (
    forgotten.response.status !== 200
    || forgotten.payload?.status !== "deleted"
    || forgotten.payload?.content !== "[deleted]"
  ) {
    throw new Error("Memory forget/redaction failed");
  }

  completedChecks = [
    "public_agent_capabilities",
    "proposal_not_active",
    "proposal_reviewable",
    "idempotent_replay",
    "actor_isolation",
    "explicit_confirmation",
    "active_retrieval",
    "same_origin",
    "forget_redaction",
    ...(process.env.EXPECT_AGENT_KNOWLEDGE === "true"
      ? [
          "runtime_knowledge_legacy_response",
          "runtime_pulse_tool_registry",
          ...(process.env.EXPECT_MARKET_TOOL_V2 === "true"
            ? ["runtime_gmgn_tool_registry_v2"]
            : []),
          ...(process.env.EXPECT_ASSETS_TOOL === "true"
            ? ["runtime_assets_tool_registry"]
            : []),
        ]
      : []),
  ];
} finally {
  await cleanupWithRetry(
    () => supabase.from("agent_tasks").delete().in("actor_id", actors),
    "Task cleanup failed",
  );
  await cleanupWithRetry(
    () => supabase.from("agent_conversations").delete().in("user_id", actors),
    "Conversation cleanup failed",
  );
  await cleanupWithRetry(
    () => supabase.from("agent_memory_items").delete().in("actor_id", actors),
    "Memory cleanup failed",
  );
  await cleanupWithRetry(
    () => supabase.from("web3_users").delete().in("user_id", actors),
    "User cleanup failed",
  );
  const remaining = await supabase
    .from("web3_users")
    .select("user_id")
    .in("user_id", actors);
  if (remaining.error || remaining.data?.length) {
    throw new Error(
      `Canary cleanup verification failed: ${
        remaining.error?.message || `${remaining.data.length} users remain`
      }`,
    );
  }
}

console.log(JSON.stringify({ ok: true, checks: completedChecks }));
