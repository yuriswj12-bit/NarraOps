import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryAuditLog } from "../audit-log.js";
import { extractLaunchedTokenAddress, PonsFollowBuyService } from "../pons-follow-buy-service.js";

const hash = (char) => `0x${char.repeat(64)}`;
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const zeroTopic = `0x${"0".repeat(64)}`;
const token = "0x432c99bbd9dc1d9040087598d7cf40502d7cc20b";

function launchReceipt() {
  return { status: "0x1", blockNumber: "0x10", logs: [
    { address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73", topics: [transferTopic, zeroTopic] },
    { address: token, topics: [transferTopic, zeroTopic] },
  ] };
}

test("extracts the launched token while excluding WETH mint events", () => {
  assert.equal(extractLaunchedTokenAddress(launchReceipt()), token);
});

test("executes one-confirmation batch signing and reconciles every accepted transaction", async () => {
  const auditLog = new InMemoryAuditLog();
  let batchCalls = 0;
  const service = new PonsFollowBuyService({
    auditLog,
    receiptProvider: { waitForReceipt: async (transactionHash) => transactionHash === hash("a") ? launchReceipt() : { status: "0x1", blockNumber: "0x11", logs: [] } },
    quoteProvider: { buildPonsBuyBatch: async ({ allocations }) => allocations.map((allocation) => ({ ...allocation, to: "0x1111111111111111111111111111111111111111", data: "0x1234", value: allocation.amountWei })) },
    batchSigner: { signAndBroadcastBatch: async ({ transactions, confirmationToken }) => { batchCalls += 1; assert.equal(confirmationToken, "confirm-once"); return transactions.map((_, index) => ({ walletReferenceId: `wallet-${index + 1}`, transactionHash: hash(String(index + 1)) })); } },
  });
  const result = await service.execute({
    launchTransactionHash: hash("a"), totalAmountWei: "101", slippageBps: 500, confirmationToken: "confirm-once",
    wallets: [{ walletReferenceId: "wallet-1", publicAddress: "0x1" }, { walletReferenceId: "wallet-2", publicAddress: "0x2" }],
  });
  assert.equal(batchCalls, 1);
  assert.equal(result.status, "confirmed");
  assert.equal(result.confirmedCount, 2);
  assert.equal(result.tokenAddress, token);
  assert.deepEqual(auditLog.list(result.executionId).map(({ type }) => type), ["follow_buy.planned", "follow_buy.launch_confirmed", "follow_buy.batch_signing_requested", "follow_buy.submitted", "follow_buy.reconciled"]);
});

test("retries quote construction with bounded attempts", async () => {
  let attempts = 0;
  const service = new PonsFollowBuyService({
    maxAttempts: 2,
    receiptProvider: { waitForReceipt: async (transactionHash) => transactionHash === hash("a") ? launchReceipt() : { status: "0x1", blockNumber: "0x12", logs: [] } },
    quoteProvider: { buildPonsBuyBatch: async ({ allocations }) => { attempts += 1; if (attempts === 1) throw new Error("temporary"); return allocations.map((allocation) => ({ ...allocation })); } },
    batchSigner: { signAndBroadcastBatch: async () => [{ transactionHash: hash("b") }] },
  });
  const result = await service.execute({ launchTransactionHash: hash("a"), totalAmountWei: "1", slippageBps: 100, confirmationToken: "once", wallets: [{ walletReferenceId: "wallet-1", publicAddress: "0x1" }] });
  assert.equal(attempts, 2);
  assert.equal(result.status, "confirmed");
});
