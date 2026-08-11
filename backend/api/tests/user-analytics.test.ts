// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { createUserAnalyticsService } from "../../agents/user-analytics.ts";

function fakeSupabase(rows = {}) {
  const store = {
    go_launch_drafts: rows.launches || [],
    asset_transfers: rows.transfers || [],
  };
  return {
    from(tableName) {
      let current = [...(store[tableName] || [])];
      const query = {
        select() { return query; },
        eq(field, value) {
          current = current.filter((row) => row[field] === value);
          return query;
        },
        gte(field, value) {
          current = current.filter((row) => row[field] >= value);
          return query;
        },
        order() { return query; },
        limit() { return query; },
        then(resolve) {
          resolve({ data: current, error: null });
          return undefined;
        },
      };
      return query;
    },
  };
}

test("user analytics aggregates actor-scoped launch history", async () => {
  const service = createUserAnalyticsService(fakeSupabase({
    launches: [
      {
        launch_draft_id: "d1",
        user_id: "user-1",
        confirmation_status: "confirmed",
        status: "confirmed",
        chain: "solana",
        token: { name: "Alpha", symbol: "ALPHA", initial_buy: "1" },
        metadata: {
          cooking_wallet_group_id: "cook-1",
          direct_execution: {
            tx_hash: "tx1",
            token_address: "mint1",
            bundled_buy_total: "5",
            bundled_buys: [{ status: "confirmed" }, { status: "confirmed" }],
          },
        },
        created_at: "2026-08-10T00:00:00.000Z",
      },
      {
        launch_draft_id: "d2",
        user_id: "user-1",
        confirmation_status: "requires_user_signature",
        status: "requires_user_signature",
        chain: "solana",
        token: { name: "Beta", symbol: "BETA" },
        metadata: { cooking_wallet_group_id: "cook-1", direct_execution: {} },
        created_at: "2026-08-11T00:00:00.000Z",
      },
      {
        launch_draft_id: "d3",
        user_id: "user-2",
        confirmation_status: "confirmed",
        status: "confirmed",
        chain: "solana",
        token: { name: "Other", symbol: "OTH" },
        metadata: { direct_execution: { tx_hash: "tx3" } },
        created_at: "2026-08-11T00:00:00.000Z",
      },
    ],
    transfers: [],
  }));

  const summary = await service.launchSummary("user-1");
  assert.equal(summary.total_launches, 2);
  assert.equal(summary.confirmed_launches, 1);
  assert.equal(summary.pending_launches, 1);
  assert.equal(summary.unique_wallet_groups, 1);
  assert.equal(summary.launches_with_bundled_buys, 1);
  assert.equal(summary.recent.length, 2);

  const performance = await service.projectPerformance("user-1");
  assert.equal(performance.projects.length, 1);
  assert.equal(performance.projects[0].bundled_buy_confirmed, 2);
  assert.equal(performance.projects[0].token_symbol, "ALPHA");
});

test("user analytics returns empty for a user with no launches", async () => {
  const service = createUserAnalyticsService(fakeSupabase({ launches: [], transfers: [] }));
  const summary = await service.launchSummary("user-x");
  assert.equal(summary.total_launches, 0);
  assert.equal(summary.data_status, "empty");
});

test("user analytics requires a configured client", () => {
  assert.equal(createUserAnalyticsService(null), null);
});

test("analytics handlers return data-gap without actor or service", async () => {
  const { createAgentHandlers } = await import("../../agents/agent-handlers.ts");
  const handlers = createAgentHandlers({}, { userAnalytics: null });
  const base = { requestId: "r1", taskId: "t1", emitEvent() {} };
  const missingUser = await handlers["account.launches.summary"]({ prompt: "我发射过几个" }, { ...base, userId: null });
  assert.equal(missingUser.mode, "data-gap");
  assert.equal(missingUser.code, "USER_ANALYTICS_UNAVAILABLE");

  const withUser = await handlers["account.launches.summary"](
    { prompt: "我发射过几个" },
    { ...base, userId: "user-1", context: { userId: "user-1" } },
  );
  assert.equal(withUser.mode, "data-gap");
});
