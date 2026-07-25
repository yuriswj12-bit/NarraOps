// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { LaunchConfirmationProvider } from "../launch-confirmation-provider.ts";

test("enters the T1-T5 window at the earliest available Solana slot", async () => {
  const slots = [100, 101];
  const provider = new LaunchConfirmationProvider({
    solanaConnection: { getSlot: async () => slots.shift() },
    maxPolls: 3,
    pollIntervalMs: 0,
  });
  const result = await provider.waitForBoundBuyWindow({ platform: "pump", launchBlockNumber: 100 });
  assert.deepEqual(result, { earliestBlock: "101", latestBlock: "105", observedBlock: "101", actualOffset: 1 });
});

test("expires when the first observed block is later than T5", async () => {
  const provider = new LaunchConfirmationProvider({ solanaConnection: { getSlot: async () => 106 }, maxPolls: 1, pollIntervalMs: 0 });
  await assert.rejects(provider.waitForBoundBuyWindow({ platform: "pump", launchBlockNumber: 100 }), { code: "BOUND_BUY_WINDOW_EXPIRED" });
});
