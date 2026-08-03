// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../src/app.ts";
import { createLogger } from "../src/security.ts";
import { LaunchExecutionCoordinator } from "../src/launch-execution-coordinator.ts";
import { InMemoryLaunchDraftRepository } from "../src/repositories/in-memory-launch-draft-repository.ts";

const config = { bodyLimitBytes: 9_000_000, taskStepDelayMs: 0, sseHeartbeatMs: 1_000 };

async function start(launchService, overrides = {}, configOverrides = {}) {
  const application = createApplication({ config: { ...config, ...configOverrides }, logger: createLogger("silent"), launchService, ...overrides });
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

test("Go launch draft button converts the edited card into a confirmed Pump execution", async (t) => {
  const draftRepository = new InMemoryLaunchDraftRepository();
  const draft = await draftRepository.create({
    platform: { id: "pump", name: "Pump.fun" },
    chain: "solana",
    token: {
      name: "Narra",
      symbol: "NARRA",
      description: "A reviewed narrative",
      image_url: "data:image/png;base64,aW1hZ2U=",
      initial_buy: "0.05",
    },
    cooking_wallet_group_id: "cook-group",
    bundled_wallet_group_id: "bundle-group",
  });
  const calls = [];
  const launchCoordinator = {
    prepare: async (input) => { calls.push(["prepare", input]); return { executionId: "22222222-2222-4222-8222-222222222222", confirmationToken: "token" }; },
    confirm: async (input) => { calls.push(["confirm", input]); return { status: "confirmed", tokenAddress: "Mint111111111111111111111111111111111111111" }; },
  };
  const { application, baseUrl } = await start({}, { launchCoordinator, launchDraftRepository: draftRepository }, { realExecutionEnabled: true });
  t.after(() => application.close());
  const response = await post(baseUrl, `/api/v1/go/launch-drafts/${draft.launch_draft_id}/execute`, {});
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "confirmed");
  assert.equal(body.token_address, "Mint111111111111111111111111111111111111111");
  assert.deepEqual(calls.map(([name]) => name), ["prepare", "confirm"]);
  assert.equal(calls[0][1].boundBuy.enabled, false);
});

test("launch-bound buys accept a fixed-total random allocation", async (t) => {
  let received;
  const { application, baseUrl } = await start(null, { launchCoordinator: { prepare: async (input) => { received = input; return { executionId: "random-preview" }; } } });
  t.after(() => application.close());
  const response = await post(baseUrl, "/api/v1/launch/executions/prepare", { platform: "pump", cookingWalletGroupId: "cook-group", boundBuy: { enabled: true, walletGroupId: "buy-group", allocation: { mode: "TOTAL_RANDOM", totalAmount: "10" } }, name: "Narra", symbol: "NARRA", imageBase64: Buffer.from("image").toString("base64"), developerBuyAmount: "0.1" });
  assert.equal(response.status, 201);
  assert.equal(received.boundBuy.allocation.totalAmount, "10");
});

test("confirmed Pump launch still returns mint and tx when bound buys fail", async () => {
  const records = new Map();
  const repository = {
    create(execution) { records.set(execution.executionId, structuredClone(execution)); return structuredClone(execution); },
    get(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
    update(id, patch) {
      const current = records.get(id);
      Object.assign(current, structuredClone(patch));
      records.set(id, current);
      return structuredClone(current);
    },
  };
  const walletGroupRepository = {
    getSigningWallet() { return { publicAddress: "Cook111111111111111111111111111111111111111", walletReferenceId: "cook:solana" }; },
    getExecutionWallets() {
      return [
        { walletId: "w1", publicAddress: "Buy1111111111111111111111111111111111111111", walletReferenceId: "w1:solana" },
        { walletId: "w2", publicAddress: "Buy2222222222222222222222222222222222222222", walletReferenceId: "w2:solana" },
      ];
    },
  };
  const coordinator = new LaunchExecutionCoordinator({
    launchService: { pump: {}, plan: async () => ({ mintAddress: "Mint111111111111111111111111111111111111111", transactionBase64: "tx" }) },
    signingService: { signAndBroadcast: async () => ({ transactionHash: "launchTx", mintAddress: "Mint111111111111111111111111111111111111111" }) },
    walletGroupRepository,
    vaultPassword: "test-password",
    confirmationProvider: {
      wait: async () => ({ tokenAddress: "Mint111111111111111111111111111111111111111", blockNumber: 100 }),
      waitForBoundBuyWindow: async () => ({ earliestBlock: 101, latestBlock: 105, observedBlock: 101, actualOffset: 1 }),
    },
    followBuyExecutor: {
      prepareAllocation: ({ wallets }) => wallets.map((wallet) => ({ walletId: wallet.walletId, amountAtomic: "1000000" })),
      execute: async () => { throw new Error("follow buy failed"); },
    },
    repository,
    now: () => 1_000,
  });
  const prepared = await coordinator.prepare({
    platform: "pump",
    cookingWalletGroupId: "cook",
    boundBuy: { enabled: true, walletGroupId: "buy", allocation: { mode: "PER_WALLET_EQUAL", amountPerWallet: "0.001" }, slippageBps: 500 },
    name: "Narra",
    symbol: "NARRA",
    developerBuyAmount: "0.001",
  });
  const confirmed = await coordinator.confirm({ executionId: prepared.executionId, confirmationToken: prepared.confirmationToken });
  assert.equal(confirmed.transactionHash, "launchTx");
  assert.equal(confirmed.tokenAddress, "Mint111111111111111111111111111111111111111");
  assert.equal(confirmed.status, "bound_buys_failed");
  assert.equal(confirmed.boundBuys.length, 2);
});

test("Pump launch-bound buys are blocked before launch when selected wallets lack SOL", async () => {
  const records = new Map();
  const repository = {
    create(execution) { records.set(execution.executionId, structuredClone(execution)); return structuredClone(execution); },
    get(id) { return records.has(id) ? structuredClone(records.get(id)) : null; },
    update(id, patch) {
      const current = records.get(id);
      Object.assign(current, structuredClone(patch));
      records.set(id, current);
      return structuredClone(current);
    },
  };
  const cookingAddress = "DkmH6KpuEhExZEwpbgNy8t4KY47TqDziXh1geZERTAYo";
  const buyAddress = "DmGzGQsLvTdg2oq9afStbaHNSoN5GFodvg9L2zo4Qmmj";
  const coordinator = new LaunchExecutionCoordinator({
    launchService: {
      pump: {
        connection: {
          getBalance: async (address) => String(address) === cookingAddress ? 1_000_000_000 : 18_000_000,
        },
      },
      plan: async () => {
        throw new Error("plan should not run when bound-buy funds are insufficient");
      },
    },
    signingService: {},
    walletGroupRepository: {
      getSigningWallet() { return { publicAddress: cookingAddress, walletReferenceId: "cook:solana" }; },
      getExecutionWallets() { return [{ walletId: "w1", publicAddress: buyAddress, walletReferenceId: "w1:solana" }]; },
    },
    vaultPassword: "test-password",
    confirmationProvider: {},
    followBuyExecutor: {
      prepareAllocation: () => [{ walletId: "w1", amountAtomic: "30000000" }],
    },
    repository,
    now: () => 1_000,
  });
  await assert.rejects(
    () => coordinator.prepare({
      platform: "pump",
      cookingWalletGroupId: "cook",
      boundBuy: { enabled: true, walletGroupId: "buy", allocation: { mode: "PER_WALLET_EQUAL", amountPerWallet: "0.03" }, slippageBps: 500 },
      name: "Narra",
      symbol: "NARRA",
      developerBuyAmount: "0.001",
    }),
    { code: "BOUND_BUY_WALLET_INSUFFICIENT_SOL" },
  );
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
