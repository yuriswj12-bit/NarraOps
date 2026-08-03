// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionError, ExecutionService, InMemoryAuditLog } from "../index.ts";

function request(overrides = {}) {
  return {
    requestId: "req-001",
    operation: "trade.batchBuy",
    chain: "solana",
    walletGroupId: "group-alpha",
    tokenAddress: "TokenAddressPlaceholder",
    amountMode: "fixed",
    amounts: ["0.1"],
    slippageBps: 100,
    priorityFee: "0.0001",
    idempotencyKey: "launch:req-001",
    ...overrides,
  };
}

function liveAdapter() {
  return {
    execute: async () => ({
      status: "confirmed",
      submittedCount: 1,
      confirmedCount: 1,
      transactions: ["provider-test-tx"],
      submittedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    }),
  };
}

test("executes through an injected live provider adapter", async () => {
  const service = new ExecutionService({ adapters: new Map([["solana", liveAdapter()]]) });
  const result = await service.execute(request());
  assert.equal(result.status, "confirmed");
  assert.equal(result.submittedCount, 1);
  assert.equal(result.confirmedCount, 1);
  assert.deepEqual(result.transactions, ["provider-test-tx"]);
});

test("same idempotency key and payload returns the original result", async () => {
  const service = new ExecutionService({ adapters: new Map([["solana", liveAdapter()]]) });
  const first = await service.execute(request());
  const second = await service.execute(request());
  assert.equal(second.executionId, first.executionId);
  assert.equal(second.idempotentReplay, true);
});

test("same idempotency key with a different payload is rejected", async () => {
  const service = new ExecutionService({ adapters: new Map([["solana", liveAdapter()]]) });
  await service.execute(request());
  await assert.rejects(() => service.execute(request({ amounts: ["0.2"] })), (error) => error instanceof ExecutionError && error.code === "IDEMPOTENCY_CONFLICT");
});

test("missing provider is reported instead of fabricating an execution result", async () => {
  const service = new ExecutionService();
  await assert.rejects(() => service.execute(request({ operation: "transfer.multi" })), { code: "ADAPTER_NOT_CONFIGURED" });
});

test("audit log strips secret-shaped fields", () => {
  const log = new InMemoryAuditLog();
  log.append({ executionId: "exec-1", status: "planned", privateKey: "must-not-leak", mnemonic: "must-not-leak" });
  const [event] = log.list("exec-1");
  assert.equal(event.privateKey, undefined);
  assert.equal(event.mnemonic, undefined);
});

