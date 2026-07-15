import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionError, ExecutionService, InMemoryAuditLog } from "../index.js";

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

test("plans an execution without submitting real transactions", async () => {
  const service = new ExecutionService();
  const result = await service.execute(request());
  assert.equal(result.status, "planned");
  assert.equal(result.submittedCount, 0);
  assert.equal(result.confirmedCount, 0);
  assert.deepEqual(result.transactions, []);
});

test("same idempotency key and payload returns the original result", async () => {
  const service = new ExecutionService();
  const first = await service.execute(request());
  const second = await service.execute(request());
  assert.equal(second.executionId, first.executionId);
  assert.equal(second.idempotentReplay, true);
});

test("same idempotency key with a different payload is rejected", async () => {
  const service = new ExecutionService();
  await service.execute(request());
  await assert.rejects(() => service.execute(request({ amounts: ["0.2"] })), (error) => error instanceof ExecutionError && error.code === "IDEMPOTENCY_CONFLICT");
});

test("submitted is never reported when real execution is disabled", async () => {
  const service = new ExecutionService();
  const result = await service.execute(request({ operation: "transfer.multi" }));
  assert.notEqual(result.status, "submitted");
  assert.equal(result.submittedAt, null);
});

test("audit log strips secret-shaped fields", () => {
  const log = new InMemoryAuditLog();
  log.append({ executionId: "exec-1", status: "planned", privateKey: "must-not-leak", mnemonic: "must-not-leak" });
  const [event] = log.list("exec-1");
  assert.equal(event.privateKey, undefined);
  assert.equal(event.mnemonic, undefined);
});

