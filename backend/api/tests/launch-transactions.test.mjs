import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.mjs";
import { createLogger } from "../src/security.mjs";

const config = { bodyLimitBytes: 9_000_000, taskStepDelayMs: 0, sseHeartbeatMs: 1_000 };

async function start(launchService) {
  const application = createApplication({ config, logger: createLogger("silent"), launchService });
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
