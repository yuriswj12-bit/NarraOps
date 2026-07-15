import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.mjs";
import { createLogger } from "../src/security.mjs";
import { AGENT_DOMAIN_EVENTS } from "../../agents/task-manager.mjs";

const testConfig = {
  bodyLimitBytes: 100_000,
  taskStepDelayMs: 5,
  sseHeartbeatMs: 1_000,
};

async function startApi(configOverrides = {}) {
  const application = createApplication({ config: { ...testConfig, ...configOverrides }, logger: createLogger("silent") });
  await new Promise((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  const { port } = application.server.address();
  return { application, baseUrl: `http://127.0.0.1:${port}` };
}

async function post(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function waitForTask(baseUrl, taskId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/agent/tasks/${taskId}`);
    const task = await response.json();
    if (["succeeded", "failed", "cancelled"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Task did not reach a terminal state");
}

test("health describes v1 mock mode and all requested adapters", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.version, "v1");
  assert.equal(body.mode, "mock");
  assert.deepEqual(body.integrations.map(({ name }) => name), ["X/Twitter", "TikTok", "Douyin", "Instagram", "Telegram", "GMGN", "Solana", "BSC"]);
});

test("narrative scan returns queued task and simulated result", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/narratives/scan", {
    query: "agent meme trend",
    sources: [{ platform: "X", handle: "@narraops", focus: "agent launches" }],
  }, { "x-request-id": "test-scan-request" });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-request-id"), "test-scan-request");
  const queued = await response.json();
  assert.equal(queued.type, "narrative.scan");
  assert.equal(queued.status, "queued");
  assert.equal(queued.progress, 0);
  const completed = await waitForTask(baseUrl, queued.taskId);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.progress, 100);
  assert.equal(completed.result.mode, "mock");
  assert.equal(completed.result.signals.length, 1);
});

test("generate, launch package, and generic task endpoints use async contract", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const cases = [
    ["/api/v1/narratives/generate", { brief: "Robots discover memes" }, "narrative.generate"],
    ["/api/v1/launch/packages", { narrativeId: "nar_test", chain: "solana" }, "launch.package"],
    ["/api/v1/agent/tasks", { type: "narrative.generate", input: { brief: "Generic task" } }, "narrative.generate"],
  ];
  for (const [path, input, expectedType] of cases) {
    const response = await post(baseUrl, path, input);
    assert.equal(response.status, 202);
    const task = await response.json();
    assert.equal(task.type, expectedType);
    assert.equal((await waitForTask(baseUrl, task.taskId || task.task_id)).status, "succeeded");
  }
});

test("Go command catalog exposes all requested categories and safe execution policies", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await fetch(`${baseUrl}/api/v1/agent/commands`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.categories, ["narrative", "meme", "wallet", "launch", "trade", "funds", "market", "analysis", "summary"]);
  assert.ok(body.commands.some(({ command }) => command === "/meme"));
  for (const command of body.commands.filter(({ category }) => ["launch", "trade", "funds"].includes(category))) {
    assert.equal(command.requires_confirmation, true);
    assert.equal(command.execution_mode, "disabled");
  }
});

test("Go accepts natural language and slash commands with snake_case task contract", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());

  const memeResponse = await post(baseUrl, "/api/v1/agent/tasks", { input: "帮我创建一个关于 AI 宠物的 meme" });
  assert.equal(memeResponse.status, 202);
  const memeTask = await memeResponse.json();
  assert.equal(memeTask.type, "meme.create");
  assert.equal(memeTask.requires_confirmation, false);
  assert.equal(memeTask.execution_mode, "mock");
  const memeCompleted = await waitForTask(baseUrl, memeTask.task_id);
  assert.equal(memeCompleted.status, "succeeded");
  assert.equal(memeCompleted.result.publishable, false);

  const transferResponse = await post(baseUrl, "/api/v1/agent/tasks", { command: "/transfer 1 SOL wallet-demo" });
  assert.equal(transferResponse.status, 202);
  const transferTask = await transferResponse.json();
  assert.equal(transferTask.type, "funds.transfer");
  assert.equal(transferTask.requires_confirmation, true);
  assert.equal(transferTask.execution_mode, "disabled");
  const transferCompleted = await waitForTask(baseUrl, transferTask.task_id);
  assert.equal(transferCompleted.status, "succeeded");
  assert.equal(transferCompleted.result.executable, false);
  assert.equal(transferCompleted.result.submitted, false);
  assert.equal(transferCompleted.result.reason, "real_execution_disabled");
});

test("Pulse, launch platforms, and invite summary return explicit mock data", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const [pulse, platforms, invite] = await Promise.all([
    fetch(`${baseUrl}/api/v1/pulse`).then((response) => response.json()),
    fetch(`${baseUrl}/api/v1/launch/platforms`).then((response) => response.json()),
    fetch(`${baseUrl}/api/v1/invite/summary`).then((response) => response.json()),
  ]);
  assert.equal(pulse.mode, "mock");
  assert.ok(pulse.opportunities.every(({ heat, sources, recommended_chain, risk_level }) => (
    Number.isInteger(heat) && Array.isArray(sources) && recommended_chain && risk_level
  )));
  assert.equal(platforms.execution_enabled, false);
  assert.ok(platforms.platforms.every(({ execution_mode }) => execution_mode === "disabled"));
  assert.equal(invite.mode, "mock");
  assert.match(invite.current_revenue_share, /^\d+\.\d+$/);
  assert.match(invite.cumulative_revenue_share, /^\d+\.\d+$/);
});

test("Settings and execution capabilities keep signing and broadcasting disabled", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const [settings, capabilities] = await Promise.all([
    fetch(`${baseUrl}/api/v1/settings`).then((response) => response.json()),
    fetch(`${baseUrl}/api/v1/execution/capabilities`).then((response) => response.json()),
  ]);
  assert.equal(settings.safety.real_execution_enabled, false);
  assert.equal(settings.safety.private_key_custody, "disabled");
  assert.equal(settings.safety.signing, "signing_disabled");
  assert.equal(settings.safety.broadcasting, "broadcasting_disabled");
  assert.equal(capabilities.execution_enabled, false);
  assert.deepEqual(capabilities.simulation_types, [
    "wallet_group_create_simulation",
    "transfer_simulation",
    "withdraw_simulation",
    "launch_simulation",
    "batch_buy_simulation",
    "batch_sell_simulation",
  ]);
  assert.deepEqual(capabilities.statuses, [
    "planned",
    "validating",
    "simulated",
    "requires_user_confirmation",
    "signing_disabled",
    "broadcasting_disabled",
    "failed_simulation",
    "cancelled",
  ]);
});

test("all six execution simulations use the unified state model without execution", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const cases = [
    ["/wallet-group demo 12", "wallet_group_create_simulation", "simulation", "simulated", false],
    ["/transfer 1 SOL wallet-demo", "transfer_simulation", "disabled", "requires_user_confirmation", true],
    ["/withdraw 1 SOL wallet-demo", "withdraw_simulation", "disabled", "requires_user_confirmation", true],
    ["/launch meme-demo", "launch_simulation", "disabled", "requires_user_confirmation", true],
    ["/buy TOKEN 1 SOL group-a", "batch_buy_simulation", "disabled", "requires_user_confirmation", true],
    ["/sell TOKEN 50% group-a", "batch_sell_simulation", "disabled", "requires_user_confirmation", true],
  ];

  for (const [command, simulationType, mode, executionStatus, requiresConfirmation] of cases) {
    const response = await post(baseUrl, "/api/v1/agent/tasks", { command });
    assert.equal(response.status, 202);
    const accepted = await response.json();
    const completed = await waitForTask(baseUrl, accepted.task_id);
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.result.simulation_type, simulationType);
    assert.equal(completed.result.execution_mode, mode);
    assert.equal(completed.result.execution_status, executionStatus);
    assert.equal(completed.result.requires_user_confirmation, requiresConfirmation);
    assert.equal(completed.result.signing_status, "signing_disabled");
    assert.equal(completed.result.broadcasting_status, "broadcasting_disabled");
    assert.equal(completed.result.executable, false);
    assert.equal(completed.result.submitted, false);
    assert.equal(completed.result.tx_hash, null);
    assert.deepEqual(completed.result.safety, {
      private_keys_read: false,
      private_keys_generated: false,
      transaction_signed: false,
      transaction_broadcast: false,
    });
  }
});

test("validation and missing routes use the unified error shape", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/narratives/scan", {});
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(typeof body.error.message, "string");
  assert.equal(typeof body.error.requestId, "string");

  const missing = await fetch(`${baseUrl}/api/v1/nope`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "ROUTE_NOT_FOUND");
});

test("HTTP API rejects private keys instead of accepting or logging them", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/agent/tasks", {
    type: "launch.package",
    input: { privateKey: "test-value-that-must-never-be-accepted" },
  });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error.code, "SENSITIVE_INPUT_REJECTED");
  assert.doesNotMatch(JSON.stringify(body), /test-value-that-must-never-be-accepted/);
});

test("SSE emits created, progress, and completed events", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/v1/events`, { signal: controller.signal });
  assert.equal(streamResponse.status, 200);
  assert.match(streamResponse.headers.get("content-type"), /text\/event-stream/);
  const reader = streamResponse.body.getReader();
  const eventsPromise = (async () => {
    let text = "";
    while (!text.includes("event: task.completed")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    return text;
  })();
  const taskResponse = await post(baseUrl, "/api/v1/narratives/generate", { brief: "SSE test" });
  assert.equal(taskResponse.status, 202);
  const eventText = await eventsPromise;
  assert.match(eventText, /event: task.created/);
  assert.match(eventText, /event: task.progress/);
  assert.match(eventText, /event: task.completed/);
  controller.abort();
});

test("SSE covers Go domain events and execution-disabled actions", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  assert.deepEqual(AGENT_DOMAIN_EVENTS, [
    "agent_task_created",
    "command_parsed",
    "narrative_detected",
    "meme_draft_ready",
    "wallet_group_plan_ready",
    "launch_plan_ready",
    "transfer_simulated",
    "trade_simulated",
    "execution_disabled",
    "revenue_share_updated",
    "agent.started",
    "agent.delta",
    "agent.card",
    "agent.completed",
    "agent.failed",
  ]);

  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/v1/events`, { signal: controller.signal });
  const reader = streamResponse.body.getReader();
  const eventsPromise = (async () => {
    let text = "";
    while (!text.includes("event: execution_disabled")) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    return text;
  })();
  const response = await post(baseUrl, "/api/v1/agent/tasks", { command: "/buy TOKEN 1 SOL group-a" });
  assert.equal(response.status, 202);
  const eventText = await eventsPromise;
  assert.match(eventText, /event: agent_task_created/);
  assert.match(eventText, /event: command_parsed/);
  assert.match(eventText, /event: trade_simulated/);
  assert.match(eventText, /event: execution_disabled/);
  controller.abort();
});

test("SSE can publish revenue share updates without exposing an execution route", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/v1/events`, { signal: controller.signal });
  const reader = streamResponse.body.getReader();
  const eventPromise = reader.read();
  await eventPromise;
  application.taskManager.publishDomainEvent("revenue_share_updated", {
    mode: "mock",
    current_revenue_share: "0.05",
  });
  let text = "";
  while (!text.includes("event: revenue_share_updated")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  assert.match(text, /event: revenue_share_updated/);
  assert.match(text, /"mode":"mock"/);
  controller.abort();
});

test("SSE taskId filter emits the selected Go card and excludes unrelated tasks", async (t) => {
  const { application, baseUrl } = await startApi({ taskStepDelayMs: 80 });
  t.after(() => application.close());
  const selectedResponse = await post(baseUrl, "/api/v1/agent/tasks", { command: "/recent-summary" });
  const selected = await selectedResponse.json();
  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/v1/events?taskId=${selected.task_id}`, { signal: controller.signal });
  const reader = streamResponse.body.getReader();
  const unrelatedResponse = await post(baseUrl, "/api/v1/agent/tasks", { command: "/dev-market" });
  const unrelated = await unrelatedResponse.json();
  let eventText = "";
  while (!eventText.includes("event: agent.completed")) {
    const { value, done } = await reader.read();
    if (done) break;
    eventText += new TextDecoder().decode(value);
  }
  assert.match(eventText, /event: agent\.card/);
  assert.match(eventText, new RegExp(selected.task_id));
  assert.doesNotMatch(eventText, new RegExp(unrelated.task_id));
  controller.abort();
});

test("SSE replays a completed task so a late EventSource still receives its card", async (t) => {
  const { application, baseUrl } = await startApi({ taskStepDelayMs: 5 });
  t.after(() => application.close());
  const taskResponse = await post(baseUrl, "/api/v1/agent/tasks", { command: "/recent-summary" });
  const task = await taskResponse.json();
  await waitForTask(baseUrl, task.task_id);

  const controller = new AbortController();
  const streamResponse = await fetch(`${baseUrl}/api/v1/events?taskId=${task.task_id}`, { signal: controller.signal });
  const reader = streamResponse.body.getReader();
  let eventText = "";
  while (!eventText.includes("event: agent.completed")) {
    const { value, done } = await reader.read();
    if (done) break;
    eventText += new TextDecoder().decode(value);
  }

  assert.match(eventText, /event: agent\.card/);
  assert.match(eventText, /event: agent\.completed/);
  const eventIds = [...eventText.matchAll(/^id: (.+)$/gm)].map((match) => match[1]);
  assert.equal(new Set(eventIds).size, eventIds.length);
  controller.abort();
});

test("Go conversation contract accepts a quick action and stores the resulting card", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const createdResponse = await post(baseUrl, "/api/v1/agent/conversations", {
    context: { language: "zh", currentView: "go", projectId: "project-test" },
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();

  const messageResponse = await post(baseUrl, `/api/v1/agent/conversations/${created.conversationId}/messages`, {
    message: "查看 Dev 钱包行情",
    command: "/dev-market",
    context: { language: "zh", currentView: "go", projectId: "project-test" },
  });
  assert.equal(messageResponse.status, 202);
  const accepted = await messageResponse.json();
  assert.equal(accepted.conversationId, created.conversationId);
  assert.equal(accepted.status, "queued");
  const task = await waitForTask(baseUrl, accepted.taskId);
  assert.equal(task.status, "succeeded");
  assert.equal(task.result.card.type, "dev_market");
  assert.equal(task.result.data_source, "gmgn");
  assert.equal(task.result.data_source_status, "disabled");
  assert.deepEqual(task.result.dev_wallets, []);

  const conversation = await fetch(`${baseUrl}/api/v1/agent/conversations/${created.conversationId}`).then((response) => response.json());
  assert.equal(conversation.messages.length, 2);
  assert.equal(conversation.messages[0].role, "user");
  assert.equal(conversation.messages[1].role, "assistant");
  assert.equal(conversation.messages[1].blocks[0].type, "dev_market");
});

test("market scan exposes explicit GMGN data gaps without fabricated Dev wallets", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/market/dev-wallets/scan", { chain: "solana", limit: 10 });
  assert.equal(response.status, 202);
  const accepted = await response.json();
  const completed = await waitForTask(baseUrl, accepted.task_id);
  assert.equal(completed.result.data_source, "gmgn");
  assert.equal(completed.result.data_source_status, "disabled");
  const wallets = await fetch(`${baseUrl}/api/v1/market/dev-wallets?chain=solana`).then((item) => item.json());
  assert.deepEqual(wallets.wallets, []);
});

test("launch drafts map Solana, BSC, and Robinhood to the required platforms", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const cases = [
    ["solana", "pump", "Pump.fun"],
    ["bsc", "fourmeme", "FourMeme"],
    ["robinhood", "noxa", "Noxa.fun"],
  ];
  for (const [chain, platform, expectedName] of cases) {
    const response = await post(baseUrl, "/api/v1/launch/drafts", {
      chain,
      platform,
      narrative_url: "https://example.com/story",
      token: { name: "Example Meme", symbol: "EXAMPLE", description: "Example narrative", image_url: "https://example.com/image.png" },
    });
    assert.equal(response.status, 201);
    const draft = await response.json();
    assert.equal(draft.platform.name, expectedName);
    assert.equal(draft.preparation_status, "ready_for_user_review");
    assert.equal(draft.execution_mode, "disabled");
    assert.equal(draft.signing_status, "signing_disabled");
    assert.equal(draft.broadcasting_status, "broadcasting_disabled");
  }
});

test("Go /launch turns a narrative link into a review-only launch draft card", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/agent/tasks", {
    command: "/launch https://example.com/story robinhood noxa",
  });
  const accepted = await response.json();
  const completed = await waitForTask(baseUrl, accepted.task_id);
  assert.equal(completed.result.card.type, "launch_draft");
  assert.equal(completed.result.platform.id, "noxa");
  assert.equal(completed.result.narrative.url, "https://example.com/story");
  assert.equal(completed.result.requires_user_confirmation, true);
  assert.equal(completed.result.execution_mode, "disabled");
  assert.equal(completed.result.submitted, false);
});

test("wallet capabilities expose references only and never backend key custody", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const capabilities = await fetch(`${baseUrl}/api/v1/wallets/capabilities`).then((response) => response.json());
  assert.equal(capabilities.raw_private_keys_accepted, false);
  assert.equal(capabilities.raw_private_keys_stored, false);
  assert.equal(capabilities.signing, "signing_disabled");
  assert.equal(capabilities.providers.find(({ id }) => id === "privy_embedded").status, "provider_configuration_required");
});
