import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const origin = process.argv[2] || "https://www.narraops.xyz";
const expectApprovalDualRun = process.argv.includes("--expect-approval-dual-run");
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const supabase = path.join(
  repositoryRoot,
  "node_modules",
  "@supabase",
  "cli-windows-x64",
  "bin",
  "supabase.exe",
);
const execFileAsync = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wallet = Wallet.createRandom();
let challengeId;
let userId;
let cookie;
let conversationId;
let draftId;
const groupIds = [];

async function request(pathname, init = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return { response, body };
}

function findValue(value, names, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const name of names) {
    if (typeof value[name] === "string" && value[name]) return value[name];
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findValue(child, names, seen);
    if (found) return found;
  }
  return null;
}

async function cleanup() {
  if (cookie) {
    await fetch(`${origin}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie },
    }).catch(() => undefined);
  }
  const ids = [challengeId, userId, conversationId, draftId, ...groupIds].filter(Boolean);
  if (!ids.every((id) => UUID.test(id))) {
    throw new Error("Pump canary cleanup refused a non-UUID identifier");
  }
  const actorCleanup = userId
    ? [
      `DELETE FROM public.agent_semantic_shadows WHERE actor_id = '${userId}';`,
      `DELETE FROM public.agent_tasks WHERE actor_id = '${userId}';`,
      `DELETE FROM public.go_launch_drafts WHERE user_id = '${userId}';`,
      `DELETE FROM public.asset_wallet_groups WHERE user_id = '${userId}';`,
      `DELETE FROM public.agent_conversations WHERE user_id = '${userId}';`,
      `DELETE FROM public.web3_users WHERE user_id = '${userId}';`,
    ]
    : [];
  const sql = [
    "BEGIN;",
    ...actorCleanup,
    `DELETE FROM public.web3_auth_challenges WHERE address_normalized = lower('${wallet.address}');`,
    "COMMIT;",
  ].join("\n");
  const file = path.join(os.tmpdir(), `narraops-pump-canary-cleanup-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(file, sql, { encoding: "utf8", mode: 0o600 });
  try {
    await execFileAsync(supabase, ["db", "query", "--linked", "--file", file], {
      cwd: repositoryRoot,
      timeout: 30_000,
      windowsHide: true,
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

try {
  const challenge = await request("/api/v1/auth/web3/challenge", {
    method: "POST",
    body: JSON.stringify({
      chain: "evm",
      address: wallet.address,
      chainId: 1,
    }),
  });
  challengeId = challenge.body.challengeId;
  const signature = await wallet.signMessage(challenge.body.message);
  const verified = await request("/api/v1/auth/web3/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, signature }),
  });
  userId = verified.body.user?.userId;
  cookie = verified.response.headers.get("set-cookie")?.split(";")[0];
  if (!userId || !cookie) throw new Error("Pump canary authentication failed");

  for (const [purpose, name] of [
    ["cooking", "Pump semantic canary cooking"],
    ["general", "Pump semantic canary bundled"],
  ]) {
    const group = await request("/api/v1/wallet-groups", {
      method: "POST",
      body: JSON.stringify({
        name,
        purpose,
        network: "solana",
        walletCount: 1,
      }),
    });
    const groupId = findValue(group.body, ["groupId", "group_id"]);
    if (!groupId) throw new Error(`Pump canary ${purpose} group has no id`);
    groupIds.push(groupId);
  }

  const conversation = await request("/api/v1/agent/conversations", {
    method: "POST",
    body: JSON.stringify({
      channel: "api",
      context: { language: "en", currentView: "go" },
    }),
  });
  conversationId = findValue(conversation.body, ["conversationId", "conversation_id"]);
  if (!conversationId) throw new Error("Pump canary conversation has no id");

  const launch = await request(
    `/api/v1/agent/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "/launch Runtime semantic shadow production canary",
        wait: true,
        timeout_ms: 20_000,
        context: { language: "en", currentView: "go" },
      }),
    },
  );
  draftId = findValue(launch.body, ["launch_draft_id", "launchDraftId"]);
  if (!draftId) throw new Error("Pump canary launch response has no draft id");

  await request(`/api/v1/go/launch-drafts/${draftId}`, {
    method: "PATCH",
    body: JSON.stringify({
      chain: "solana",
      platform: { id: "pump", name: "Pump.fun" },
      token: {
        name: "NarraOps Runtime Canary",
        symbol: "NRCAN",
        description: "Unsigned production semantic-shadow canary. Never broadcast.",
        image_url: `${origin}/assets/narraops-mark.png`,
        initial_buy: null,
        bundle_buy_per_wallet: null,
      },
      cooking_wallet_group_id: groupIds[0],
      bundled_wallet_group_id: groupIds[1],
    }),
  });

  const prepared = await request(`/api/v1/go/launch-drafts/${draftId}/execute`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
  if (
    prepared.body.status !== "requires_user_signature"
    || prepared.body.runtime?.recorded !== true
    || !prepared.body.runtime?.shadowId
    || prepared.body.runtime?.approvalDualRun?.requested !== expectApprovalDualRun
  ) {
    throw new Error(`Pump semantic shadow assertion failed: ${JSON.stringify({
      status: prepared.body.status,
      runtime: prepared.body.runtime,
    })}`);
  }
  console.log(JSON.stringify({
    status: prepared.body.status,
    semanticShadowRecorded: true,
    approvalDualRunRequested: expectApprovalDualRun,
    signed: false,
    broadcast: false,
    cleaned: true,
  }));
} finally {
  await cleanup();
}
