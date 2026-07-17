import test from "node:test";
import assert from "node:assert/strict";
import { LaunchConfirmationProvider } from "../launch-confirmation-provider.js";

test("waits until the requested Solana T1-T5 slot", async () => {
  const slots = [101, 102, 103];
  const provider = new LaunchConfirmationProvider({
    solanaConnection: { getSlot: async () => slots.shift() },
    maxPolls: 3,
    pollIntervalMs: 0,
  });
  const result = await provider.waitForBoundBuyBlock({ platform: "pump", launchBlockNumber: 100, blockOffset: 3 });
  assert.deepEqual(result, { targetBlock: "103", observedBlock: "103" });
});

test("rejects T0 because it requires a configured bundle relay", async () => {
  const provider = new LaunchConfirmationProvider();
  await assert.rejects(provider.waitForBoundBuyBlock({ platform: "pump", launchBlockNumber: 100, blockOffset: 0 }), { code: "BOUND_BUY_BLOCK_OFFSET_INVALID" });
});
