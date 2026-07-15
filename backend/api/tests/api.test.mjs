import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.mjs";
import { createLogger } from "../src/security.mjs";

const testConfig = {
  bodyLimitBytes: 100_000,
  taskStepDelayMs: 5,
  sseHeartbeatMs: 1_000,
};

async function startApi() {
  const application = createApplication({ config: testConfig, logger: createLogger("silent") });
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
  assert.deepEqual(body.integrations.map(({ name }) => name), ["X/Twitter", "TikTok", "Instagram", "Telegram", "GMGN", "Solana", "BSC"]);
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
    assert.equal((await waitForTask(baseUrl, task.taskId)).status, "succeeded");
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
