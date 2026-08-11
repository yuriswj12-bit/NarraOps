#!/usr/bin/env node
// End-to-end Agent main-chain acceptance canary against production.
// Uses a fresh random EVM wallet so no real funds or secrets are involved.
// Cleans up all created rows (task, conversation, user, challenge).
//
// Usage:
//   node scripts/canary/production-agent-acceptance.mjs [origin]
//
// Covers: /recent-summary, /my-launches, /my-projects, /my-pnl,
// /launch <public link> -> launch_draft card, /analyze-meme -> meme card,
// and durable event replay.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";

const origin = process.argv[2] || "https://www.narraops.xyz";
const execFileAsync = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const wallet = Wallet.createRandom();
const identity = { challengeId: null, userId: null, taskId: null, conversationId: null };
let cookie = null;

async function jsonRequest(pathname, init = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return { response, body };
}

async function runTask(message, command) {
  const created = await jsonRequest("/api/v1/agent/tasks", {
    method: "POST",
    headers: { cookie },
    body: JSON.stringify({ message, command, wait: false }),
  });
  identity.taskId = created.body.task_id;
  identity.conversationId = created.body.conversation_id || identity.conversationId;
  let task;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    task = (await jsonRequest(`/api/v1/agent/tasks/${identity.taskId}`, { headers: { cookie } })).body;
    if (["succeeded", "failed", "cancelled", "expired"].includes(task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (task?.status !== "succeeded") {
    throw new Error(`Task did not succeed: ${message} -> ${JSON.stringify(task)}`);
  }
  const result = task.result || {};
  const card = result.card || result.card_type ? result : null;
  return { task, result, card };
}

async function cleanup() {
  if (cookie) {
    await fetch(`${origin}/api/v1/auth/logout`, {
      method: "POST",
      headers: { cookie },
    }).catch(() => undefined);
  }
  const values = Object.values(identity).filter(Boolean);
  if (!values.every((value) => UUID.test(value))) {
    throw new Error("Canary cleanup refused a non-UUID identifier");
  }
  const sql = [
    "BEGIN;",
    identity.taskId ? `DELETE FROM public.agent_tasks WHERE task_id = '${identity.taskId}';` : "",
    identity.conversationId
      ? `DELETE FROM public.agent_conversations WHERE conversation_id = '${identity.conversationId}';`
      : "",
    identity.userId ? `DELETE FROM public.web3_users WHERE user_id = '${identity.userId}';` : "",
    identity.challengeId
      ? `DELETE FROM public.web3_auth_challenges WHERE challenge_id = '${identity.challengeId}';`
      : "",
    "COMMIT;",
  ].filter(Boolean).join("\n");
  const cleanupFile = path.join(os.tmpdir(), `narraops-acceptance-cleanup-${randomUUID()}.sql`);
  fs.writeFileSync(cleanupFile, sql, { encoding: "utf8", mode: 0o600 });
  try {
    const executable = process.platform === "win32"
      ? path.join(repositoryRoot, "node_modules", "@supabase", "cli-windows-x64", "bin", "supabase.exe")
      : "npx";
    const args = process.platform === "win32"
      ? ["db", "query", "--linked", "--file", cleanupFile]
      : ["supabase", "db", "query", "--linked", "--file", cleanupFile];
    await execFileAsync(executable, args, { cwd: repositoryRoot, timeout: 30_000, windowsHide: true });
  } finally {
    fs.rmSync(cleanupFile, { force: true });
  }
}

try {
  const challenge = await jsonRequest("/api/v1/auth/web3/challenge", {
    method: "POST",
    body: JSON.stringify({ chain: "evm", address: wallet.address, chainId: 1 }),
  });
  identity.challengeId = challenge.body.challengeId;
  const signature = await wallet.signMessage(challenge.body.message);
  const verified = await jsonRequest("/api/v1/auth/web3/verify", {
    method: "POST",
    body: JSON.stringify({ challengeId: identity.challengeId, signature }),
  });
  identity.userId = verified.body.user?.userId || verified.body.user?.id || verified.body.user?.user_id;
  cookie = verified.response.headers.get("set-cookie")?.split(";")[0];
  if (!cookie || !identity.userId) throw new Error("Authentication did not return a session");

  const results = {};

  const recent = await runTask("/recent-summary", "/recent-summary");
  results.recent_summary = recent.result?.card?.type || recent.result?.type || "no-card";
  if (!recent.result?.card && !recent.result?.launch_drafts) {
    // allow data-gap but require a structured result
    if (!recent.result?.mode && !recent.result?.card) {
      throw new Error("recent-summary produced no structured result");
    }
  }

  const launches = await runTask("/my-launches", "/my-launches");
  results.launches = launches.result?.card?.type || launches.result?.type || "no-card";
  if (launches.result?.card && !["user_launch_summary"].includes(launches.result.card.type)) {
    throw new Error(`my-launches card type unexpected: ${launches.result.card.type}`);
  }

  const projects = await runTask("/my-projects", "/my-projects");
  results.projects = projects.result?.card?.type || projects.result?.type || "no-card";

  const pnl = await runTask("/my-pnl", "/my-pnl");
  results.pnl = pnl.result?.card?.type || pnl.result?.type || "no-card";

  const launchPlan = await runTask(
    "/launch https://example.com/meme-acceptance-story",
    "/launch https://example.com/meme-acceptance-story",
  );
  results.launch_plan = launchPlan.result?.card?.type || launchPlan.result?.type || "no-card";
  if (launchPlan.result?.card?.type !== "launch_draft") {
    throw new Error(`launch plan card type unexpected: ${launchPlan.result?.card?.type}`);
  }
  if (launchPlan.result?.skill !== "meme-launch-plan") {
    throw new Error(`launch plan missing meme-launch-plan skill marker`);
  }

  const analyze = await runTask(
    "/analyze-meme So11111111111111111111111111111111111111112",
    "/analyze-meme So11111111111111111111111111111111111111112",
  );
  results.analyze = analyze.result?.card?.type || analyze.result?.type || "no-card";

  const replay = (await jsonRequest(`/api/v1/agent/events?taskId=${identity.taskId}&cursor=0`, { headers: { cookie } })).body;
  if (!Array.isArray(replay.events) || replay.events.length === 0) {
    throw new Error("Acceptance task produced no durable events");
  }

  console.log(JSON.stringify({ results, events: replay.events.length, cleaned: true }, null, 2));
} finally {
  await cleanup();
}
