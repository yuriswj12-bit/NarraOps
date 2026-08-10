import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Wallet } from "ethers";

const origin = process.argv[2] || "https://www.narraops.xyz";
const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wallet = Wallet.createRandom();
let challengeId;
let userId;
let taskId;
let conversationId;
let cookie;

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return { response, body };
}

async function cleanup() {
  if (cookie) {
    await fetch(`${origin}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie },
    }).catch(() => undefined);
  }
  const identities = [taskId, conversationId, userId, challengeId].filter(Boolean);
  if (!identities.every((value) => UUID.test(value))) {
    throw new Error("Canary cleanup refused a non-UUID identifier");
  }
  const sql = [
    "BEGIN;",
    taskId ? `DELETE FROM public.agent_tasks WHERE task_id = '${taskId}';` : "",
    conversationId
      ? `DELETE FROM public.agent_conversations WHERE conversation_id = '${conversationId}';`
      : "",
    userId ? `DELETE FROM public.web3_users WHERE user_id = '${userId}';` : "",
    challengeId
      ? `DELETE FROM public.web3_auth_challenges WHERE challenge_id = '${challengeId}';`
      : "",
    "COMMIT;",
  ].filter(Boolean).join("\n");
  const cleanupFile = path.join(os.tmpdir(), `narraops-canary-cleanup-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(cleanupFile, sql, { encoding: "utf8", mode: 0o600 });
  try {
    const executable = process.platform === "win32"
      ? path.join(
        repositoryRoot,
        "node_modules",
        "@supabase",
        "cli-windows-x64",
        "bin",
        "supabase.exe",
      )
      : "npx";
    const arguments_ = process.platform === "win32"
      ? ["db", "query", "--linked", "--file", cleanupFile]
      : ["supabase", "db", "query", "--linked", "--file", cleanupFile];
    await execFileAsync(executable, arguments_, {
      cwd: repositoryRoot,
      timeout: 30_000,
      windowsHide: true,
    });
  } finally {
    fs.rmSync(cleanupFile, { force: true });
  }
}

try {
  const challenge = await jsonRequest("/api/v1/auth/web3/challenge", {
    method: "POST",
    body: JSON.stringify({
      chain: "evm",
      address: wallet.address,
      chainId: 1,
    }),
  });
  challengeId = challenge.body.challengeId;
  const signature = await wallet.signMessage(challenge.body.message);
  const verified = await jsonRequest("/api/v1/auth/web3/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId, signature }),
  });
  userId =
    verified.body.user?.userId
    || verified.body.user?.id
    || verified.body.user?.user_id;
  cookie = verified.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || !userId) throw new Error("Authentication did not return a session");

  const created = await jsonRequest("/api/v1/agent/tasks", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ message: "/recent-summary", wait: false }),
  });
  taskId = created.body.task_id;
  conversationId = created.body.conversation_id;

  let task;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    task = (
      await jsonRequest(`/api/v1/agent/tasks/${taskId}`, {
        headers: { cookie },
      })
    ).body;
    if (["succeeded", "failed", "cancelled", "expired"].includes(task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (task?.status !== "succeeded") {
    throw new Error(`Canary task did not succeed: ${JSON.stringify(task)}`);
  }

  const replay = (
    await jsonRequest(`/api/v1/agent/events?taskId=${taskId}&cursor=0`, {
      headers: { cookie },
    })
  ).body;
  const emptyReplay = (
    await jsonRequest(
      `/api/v1/agent/events?taskId=${taskId}&cursor=${replay.next_cursor}`,
      { headers: { cookie } },
    )
  ).body;
  if (!Array.isArray(replay.events) || replay.events.length === 0) {
    throw new Error("Canary task produced no durable events");
  }
  if (!Array.isArray(emptyReplay.events) || emptyReplay.events.length !== 0) {
    throw new Error("Durable cursor replay returned duplicate events");
  }

  console.log(
    JSON.stringify({
      status: task.status,
      events: replay.events.length,
      emptyReplay: emptyReplay.events.length,
      cleaned: true,
    }),
  );
} finally {
  await cleanup();
}
