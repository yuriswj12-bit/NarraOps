import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.mjs";
import { createLogger } from "../src/security.mjs";

const config = { bodyLimitBytes: 9_000_000, taskStepDelayMs: 0, sseHeartbeatMs: 1_000 };

async function start(launchService, overrides = {}) {
  const application = createApplication({ config, logger: createLogger("silent"), launchService, ...overrides });
  await new Promise((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  return { application, baseUrl: `http://127.0.0.1:${application.server.address().port}` };
}

function post(baseUrl, path, body) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("Four.Meme nonce is returned for browser-wallet login signing", async (t) => {
  const launchService = { requestFourMemeLogin: async ({ address }) => ({ address, nonce: "42", message: "You are sign in Meme 42" }) };
  const { application, baseUrl } = await start(launchService);
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/launch/auth/fourmeme/nonce", { address: "0x2222222222222222222222222222222222222222" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).message, "You are sign in Meme 42");
});

test("internal Cooking-wallet launch uses prepare then explicit confirmation", async (t) => {
  const calls = [];
  const launchCoordinator = {
    prepare: async (input) => { calls.push(["prepare", input]); return { executionId: "11111111-1111-4111-8111-111111111111", status: "requires_user_confirmation", confirmationToken: "confirm-token" }; },
    confirm: async (input) => { calls.push(["confirm", input]); return { executionId: input.executionId, status: "submitted", transactionHash: "0xhash" }; },
  };
  const { application, baseUrl } = await start(null, { launchCoordinator });
  t.after(() => application.close());
  const prepared = await post(baseUrl, "/api/v1/launch/executions/prepare", { platform: "pump", cookingWalletGroupId: "cook-group", boundBuy: { enabled: true, walletGroupId: "buy-group", allocation: { mode: "PER_WALLET_EQUAL", amountPerWallet: "0.1" }, slippageBps: 500 }, name: "Narra", symbol: "NARRA", imageBase64: Buffer.from("image").toString("base64"), developerBuyAmount: "0.1" });
  assert.equal(prepared.status, 201);
  const confirmed = await post(baseUrl, "/api/v1/launch/executions/11111111-1111-4111-8111-111111111111/confirm", { confirmationToken: "confirm-token" });
  assert.equal(confirmed.status, 202);
  assert.equal((await confirmed.json()).status, "submitted");
  assert.deepEqual(calls.map(([name]) => name), ["prepare", "confirm"]);
  assert.deepEqual(calls[0][1].boundBuy.window, { earliestBlockOffset: 1, latestBlockOffset: 5 });
});

test("launch-bound buys accept a fixed-total random allocation", async (t) => {
  let received;
  const { application, baseUrl } = await start(null, { launchCoordinator: { prepare: async (input) => { received = input; return { executionId: "random-preview" }; } } });
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/launch/executions/prepare", { platform: "pump", cookingWalletGroupId: "cook-group", boundBuy: { enabled: true, walletGroupId: "buy-group", allocation: { mode: "TOTAL_RANDOM", totalAmount: "10" } }, name: "Narra", symbol: "NARRA", imageBase64: Buffer.from("image").toString("base64"), developerBuyAmount: "0.1" });
  assert.equal(response.status, 201);
  assert.equal(received.boundBuy.allocation.totalAmount, "10");
});

test("launch plan returns an unsigned client-confirmation payload", async (t) => {
  let received;
  const launchService = { plan: async (input) => { received = input; return { platform: input.platform, transactionBase64: "unsigned" }; } };
  const { application, baseUrl } = await start(launchService);
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/launch/transactions/plan", {
    platform: "pump",
    walletAddress: "11111111111111111111111111111111",
    name: "Narra",
    symbol: "NARRA",
    imageBase64: Buffer.from("image").toString("base64"),
    developerBuyAmount: "0.25",
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, "requires_user_signature");
  assert.equal(body.broadcastByNarraOps, false);
  assert.equal(received.developerBuyAmount, "0.25");
});

test("Four.Meme planning requires the wallet login signature", async (t) => {
  const { application, baseUrl } = await start({ plan: async () => ({}) });
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/launch/transactions/plan", {
    platform: "fourmeme",
    walletAddress: "0x2222222222222222222222222222222222222222",
    name: "Narra",
    symbol: "NARRA",
    imageBase64: Buffer.from("image").toString("base64"),
    developerBuyAmount: "0",
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "VALIDATION_ERROR");
});
