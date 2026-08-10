import assert from "node:assert/strict";
import test from "node:test";
import handlerModule, {
  buildDirectPumpExecutionResponse,
  handleAgentApprovalRoute,
  handleAgentMemoryRoute,
  handleAssetsRoute,
  transferDecimalToLamports,
  transferLamportsToDecimal,
} from "../../../api/v1/[...path].ts";
import goPlanHandlerModule from "../../../api/v1/go/plan.ts";
import { buildPulseMarketResponse } from "../../../api/v1/pulse-market.ts";
import { buildPulseDevWalletPnlResponse } from "../../../api/v1/pulse-dev-wallet-pnl.ts";
import { buildPulseNarrativesResponse } from "../../../api/v1/pulse-narratives.ts";
import { buildNarrativeSnapshotPlanResponse } from "../../../api/v1/go/narrative-snapshot-plan.ts";

const handler =
  typeof handlerModule === "function"
    ? handlerModule
    : (handlerModule as { default: typeof handlerModule }).default;
const goPlanHandler =
  typeof goPlanHandlerModule === "function"
    ? goPlanHandlerModule
    : (goPlanHandlerModule as { default: typeof goPlanHandlerModule }).default;

test("Pump runtime metadata is additive to the legacy Go execution response", () => {
  const input = {
    status: "confirmed",
    txHash: "pump-signature",
    tokenAddress: "pump-mint",
    cookingWalletGroupId: "cooking-group",
    bundledWalletGroupId: "bundled-group",
  };
  const legacy = buildDirectPumpExecutionResponse(input);
  const protectedResponse = buildDirectPumpExecutionResponse({
    ...input,
    runtimeExecutionId: "runtime-execution",
  });
  const { runtime_execution_id: runtimeExecutionId, ...legacyProjection } =
    protectedResponse;

  assert.equal(runtimeExecutionId, "runtime-execution");
  assert.deepEqual(legacyProjection, legacy);
  assert.deepEqual(Object.keys(legacy), [
    "schema_version",
    "status",
    "provider",
    "execution_mode",
    "launchpad",
    "tx_hash",
    "token_address",
    "cooking_wallet_group_id",
    "bundled_wallet_group_id",
    "bundled_wallet_count",
  ]);
});

test("private narrative snapshot plan preserves source evidence without inventing analysis", () => {
  const response = buildNarrativeSnapshotPlanResponse({
    snapshot_id: "846b9ae8-a679-463c-a31d-d98374134b53",
    narrative_id: "nar_source_1",
    category: "events",
    platform: "rss",
    source_type: "news",
    author_name: "Example News",
    original_text: "A newly reported event with meme potential.",
    source_url: "https://example.com/source",
    media_type: "image",
    media_urls: ["https://example.com/image.jpg"],
    video_thumbnail_url: null,
    source_published_at: "2026-07-30T08:00:00.000Z",
    source_expires_at: "2026-07-30T09:00:00.000Z",
    created_at: "2026-07-30T08:10:00.000Z",
  });

  assert.equal(response.mode, "pulse_narrative_snapshot");
  assert.equal(response.data_status, "private_snapshot");
  assert.equal(response.execution, "live_confirmation_required");
  assert.equal(response.card.type, "narrative_snapshot");
  assert.equal(response.plan.executable, false);
  assert.equal(response.plan.requires_user_confirmation, true);
  assert.equal(response.source.original_text, "A newly reported event with meme potential.");
  assert.equal(response.source.source_url, "https://example.com/source");
  assert.equal("score" in response.plan, false);
  assert.equal("risk" in response.plan, false);
});

test("Pulse market response keeps decimal values as strings", () => {
  const response = buildPulseMarketResponse([
    {
      observed_at: "2026-07-26T00:00:00.000Z",
      launched_tokens_24h: 26426,
      graduated_tokens_24h: 1049,
      active_wallets_24h: 120000,
      launch_score: "65.00",
      graduation_score: "75.00",
      active_wallet_score: "80.00",
      market_activity_index_raw: "75.0001",
      market_activity_index_display: 75,
      baseline_sample_count: 720,
      history_coverage: "1.0000",
      history_status: "ready",
    },
    {
      observed_at: "2026-07-25T00:00:00.000Z",
      market_activity_index_raw: "73.4000",
      market_activity_index_display: 73,
      history_status: "ready",
    },
  ]);
  assert.equal(response.data_status, "ready");
  assert.equal(response.index.value, "75");
  assert.equal(response.index.raw_value, "75.0001");
  assert.equal(response.index.change_24h, "2.00");
  assert.equal(response.schema_version, "pulse.market.v3");
  assert.equal(response.index.components.active_wallets_24h.raw_value, "120000");
  assert.equal(response.sparkline.length, 2);
});

test("Pulse market response never fabricates an index without observations", () => {
  const response = buildPulseMarketResponse([]);
  assert.equal(response.data_status, "awaiting_market_observation");
  assert.equal(response.index.value, null);
  assert.equal(response.index.change_24h, null);
  assert.deepEqual(response.sparkline, []);
});

test("Pulse market response keeps the last real index during warm-up", () => {
  const response = buildPulseMarketResponse([
    {
      observed_at: "2026-07-29T12:00:00.000Z",
      market_activity_index_display: null,
      market_activity_index: null,
      history_status: "warming_up",
    },
    {
      observed_at: "2026-07-28T12:00:00.000Z",
      market_activity_index_display: 90,
      market_activity_index_raw: "89.75",
      history_status: "ready",
    },
  ]);
  assert.equal(response.data_status, "warming_up");
  assert.equal(response.observed_at, "2026-07-29T12:00:00.000Z");
  assert.equal(response.displayed_observed_at, "2026-07-28T12:00:00.000Z");
  assert.equal(response.index.value, "90");
  assert.equal(response.index.raw_value, "89.75");
  assert.deepEqual(response.sparkline, [
    { observed_at: "2026-07-28T12:00:00.000Z", value: "90" },
  ]);
});

test("Pulse market response preserves every available aggregate observation", () => {
  const rows = Array.from({ length: 96 }, (_, index) => ({
    observed_at: new Date(Date.UTC(2026, 6, 1, index * 3)).toISOString(),
    market_activity_index: String(40 + (index % 20)),
    calculation_status: "ready",
  }));
  const response = buildPulseMarketResponse(rows);
  assert.equal(response.sparkline.length, 96);
  assert.equal(response.sparkline[0].observed_at, rows[0].observed_at);
  assert.equal(
    response.sparkline.at(-1).observed_at,
    rows.at(-1).observed_at,
  );
});

test("Dev wallet PnL response exposes latest real amount and real history by range", () => {
  const response = buildPulseDevWalletPnlResponse([
    {
      snapshot_at: "2026-07-29T03:00:00.000Z",
      timeframe: "24h",
      total_realized_pnl_usd: "13876.03",
      source_status: "partial",
    },
    {
      snapshot_at: "2026-07-29T02:00:00.000Z",
      timeframe: "24h",
      total_realized_pnl_usd: "9200.10",
      source_status: "partial",
    },
    {
      snapshot_at: "2026-07-29T03:00:00.000Z",
      timeframe: "7d",
      total_realized_pnl_usd: "70250.55",
      source_status: "partial",
    },
  ]);
  assert.equal(response.schema_version, "pulse.dev-wallet-pnl.v1");
  assert.equal(response.data_status, "partial");
  assert.equal(response.ranges["24h"].value, "13876.03");
  assert.equal(response.ranges["24h"].history.length, 2);
  assert.equal(response.ranges["24h"].history[0].value, "9200.10");
  assert.equal(response.ranges["7d"].value, "70250.55");
  assert.equal(response.ranges["30d"].value, null);
  assert.deepEqual(response.ranges["30d"].history, []);
});

test("Dev wallet PnL response never fabricates missing values", () => {
  const response = buildPulseDevWalletPnlResponse([]);
  assert.equal(response.ranges["24h"].value, null);
  assert.deepEqual(response.ranges["24h"].history, []);
});

test("Pulse narratives returns only unexpired real source cards by category", () => {
  const now = new Date("2026-07-30T09:00:00.000Z");
  const response = buildPulseNarrativesResponse([
    {
      narrative_id: "nar_live",
      category: "events",
      platform: "news",
      source_type: "trend_discovery",
      author_name: "source",
      original_text: "Original source text",
      source_url: "https://example.com/live",
      media_urls: [],
      published_at: "2026-07-30T08:45:00.000Z",
      expires_at: "2026-07-30T09:15:00.000Z",
    },
    {
      narrative_id: "nar_expired",
      category: "events",
      platform: "rss",
      source_type: "public_feed",
      author_name: "source",
      original_text: "Expired source text",
      source_url: "https://example.com/expired",
      media_urls: [],
      published_at: "2026-07-30T08:00:00.000Z",
      expires_at: "2026-07-30T08:30:00.000Z",
    },
  ], now, new Set(), {
    started_at: "2026-07-30T08:59:00.000Z",
    completed_at: "2026-07-30T08:59:20.000Z",
    status: "completed",
    source_count: 10,
    successful_source_count: 10,
    collected_item_count: 2,
    eligible_item_count: 1,
  });
  assert.equal(response.schema_version, "pulse.narratives.v1");
  assert.equal(response.data_status, "live");
  assert.equal(response.total, 1);
  assert.equal(response.columns.events[0].original_text, "Original source text");
  assert.equal(response.columns.events.length, 1);
  assert.equal(response.columns.ai_tech, undefined);
});


test("Pulse narratives marks collector_stale when no fresh cards and last run is old", () => {
  const now = new Date("2026-07-30T09:00:00.000Z");
  const response = buildPulseNarrativesResponse(
    [],
    now,
    new Set(),
    {
      started_at: "2026-07-30T08:40:00.000Z",
      completed_at: "2026-07-30T08:40:12.000Z",
      status: "completed",
      source_count: 40,
      successful_source_count: 38,
      collected_item_count: 0,
      eligible_item_count: 0,
    },
  );
  assert.equal(response.data_status, "collector_stale");
  assert.equal(response.collector.stale, true);
  assert.equal(response.collector.source_count, 40);
});

test("Pulse narratives hides dismissed or used cards for a signed-in user", () => {
  const now = new Date("2026-07-30T09:00:00.000Z");
  const rows = ["visible", "dismissed", "used"].map((id, index) => ({
    narrative_id: id,
    category: "events",
    platform: "news",
    source_type: "public_feed",
    author_name: "source",
    original_text: `Source ${id}`,
    source_url: `https://example.com/${id}`,
    media_urls: [],
    published_at: `2026-07-30T08:${40 + index}:00.000Z`,
    expires_at: "2026-07-30T09:15:00.000Z",
  }));
  const response = buildPulseNarrativesResponse(
    rows,
    now,
    new Set(["dismissed", "used"]),
  );
  assert.equal(response.total, 1);
  assert.equal(response.columns.events[0].narrative_id, "visible");
});

function responseRecorder() {
  const headers = new Map<string, unknown>();
  let body = "";
  return {
    response: {
      statusCode: 200,
      setHeader(name: string, value: unknown) {
        headers.set(name.toLowerCase(), value);
      },
      end(value = "") {
        body += value;
      },
    },
    result() {
      return {
        status: this.response.statusCode,
        headers,
        body: body ? JSON.parse(body) : null,
      };
    },
  };
}

function fakeSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let one = false;
      const query = {
        select() {
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        order() {
          return query;
        },
        maybeSingle() {
          one = true;
          return query;
        },
        then(resolve: (result: unknown) => unknown) {
          const rows = (tables[table] || []).filter((row) =>
            filters.every(([column, value]) => row[column] === value),
          );
          return Promise.resolve(
            resolve({ data: one ? rows[0] || null : rows, error: null }),
          );
        },
      };
      return query;
    },
  };
}

function mutableAssetsSupabase({
  failWalletActivationAt = Number.POSITIVE_INFINITY,
}: {
  failWalletActivationAt?: number;
} = {}) {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    asset_wallet_groups: [],
    asset_wallets: [],
    asset_wallet_secrets: [],
  };
  let nextGroup = 1;
  let nextWallet = 1;
  let walletActivations = 0;

  const client = {
    tables,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let operation: "select" | "insert" | "upsert" | "update" | "delete" = "select";
      let payload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
      let one = false;
      const query = {
        select() {
          return query;
        },
        insert(value: Record<string, unknown> | Array<Record<string, unknown>>) {
          operation = "insert";
          payload = value;
          return query;
        },
        upsert(value: Record<string, unknown>) {
          operation = "upsert";
          payload = value;
          return query;
        },
        update(value: Record<string, unknown>) {
          operation = "update";
          payload = value;
          return query;
        },
        delete() {
          operation = "delete";
          return query;
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return query;
        },
        order() {
          return query;
        },
        single() {
          one = true;
          return query;
        },
        maybeSingle() {
          one = true;
          return query;
        },
        then(resolve: (result: unknown) => unknown) {
          const matches = (row: Record<string, unknown>) =>
            filters.every(([column, value]) => row[column] === value);
          let data: Array<Record<string, unknown>> = [];
          let error: Record<string, unknown> | null = null;

          if (operation === "insert") {
            const rows = (Array.isArray(payload) ? payload : [payload]).map((value) => {
              const row = { ...value } as Record<string, unknown>;
              if (table === "asset_wallet_groups") {
                row.group_id ||= `30000000-0000-4000-8000-${String(nextGroup++).padStart(12, "0")}`;
              }
              if (table === "asset_wallets") {
                row.wallet_id ||= `40000000-0000-4000-8000-${String(nextWallet++).padStart(12, "0")}`;
              }
              row.created_at ||= "2026-08-09T00:00:00.000Z";
              row.updated_at ||= row.created_at;
              tables[table].push(row);
              return row;
            });
            data = rows;
          } else if (operation === "upsert") {
            const value = { ...(payload as Record<string, unknown>) };
            const index = tables[table].findIndex(({ wallet_id }) => wallet_id === value.wallet_id);
            if (index >= 0) tables[table][index] = { ...tables[table][index], ...value };
            else tables[table].push(value);
            data = [value];
          } else if (operation === "update") {
            if (table === "asset_wallets" && ++walletActivations === failWalletActivationAt) {
              error = { code: "TEST_ACTIVATION_FAILURE", message: "Injected activation failure" };
            } else {
              data = tables[table].filter(matches);
              for (const row of data) Object.assign(row, payload);
            }
          } else if (operation === "delete") {
            const removed = tables[table].filter(matches);
            tables[table] = tables[table].filter((row) => !matches(row));
            if (table === "asset_wallet_groups") {
              const groupIds = new Set(removed.map(({ group_id }) => group_id));
              const walletIds = new Set(
                tables.asset_wallets
                  .filter(({ group_id }) => groupIds.has(group_id))
                  .map(({ wallet_id }) => wallet_id),
              );
              tables.asset_wallets = tables.asset_wallets.filter(
                ({ group_id }) => !groupIds.has(group_id),
              );
              tables.asset_wallet_secrets = tables.asset_wallet_secrets.filter(
                ({ wallet_id }) => !walletIds.has(wallet_id),
              );
            } else if (table === "asset_wallets") {
              const walletIds = new Set(removed.map(({ wallet_id }) => wallet_id));
              tables.asset_wallet_secrets = tables.asset_wallet_secrets.filter(
                ({ wallet_id }) => !walletIds.has(wallet_id),
              );
            }
          } else {
            data = tables[table].filter(matches);
          }

          return Promise.resolve(resolve({ data: one ? data[0] || null : data, error }));
        },
      };
      return query;
    },
  };
  return client;
}

test("Vercel health endpoint works without database credentials", async () => {
  const recorder = responseRecorder();
  await handler(
    {
      method: "GET",
      url: "/api/v1/health",
      headers: {},
    },
    recorder.response,
  );
  assert.equal(recorder.result().status, 200);
  assert.equal(recorder.result().body.status, "ok");
  assert.equal(recorder.result().body.execution, "direct_wallet_signature");
  assert.equal(recorder.result().body.gmgn_trade, "read_only");
  assert.equal(recorder.result().body.direct_swap, "direct_wallet_signature");
});

test("Vercel Pulse publishes only reviewed evidence without investment scoring", async () => {
  const recorder = responseRecorder();
  await handler(
    {
      method: "GET",
      url: "/api/v1/pulse",
      headers: {},
    },
    recorder.response,
  );
  const result = recorder.result();
  assert.equal(result.status, 200);
  assert.equal(result.body.schema_version, "pulse.v1");
  assert.match(result.body.data_status, /collector_stale|no_fresh_narratives|live/);
  assert.equal(Array.isArray(result.body.opportunities), true);
  assert.equal(result.body.execution, "live_confirmation_required");
  assert.match(String(result.headers.get("cache-control")), /s-maxage=60/);
});

test("Vercel Assets lists only wallet groups owned by the Web3 session", async () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  const groupA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const groupB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const supabase = fakeSupabase({
    asset_wallet_groups: [
      {
        group_id: groupA,
        user_id: userA,
        name: "User A",
        purpose: "general",
        network: "solana",
        created_at: "2026-07-24T00:00:00.000Z",
        updated_at: "2026-07-24T00:00:00.000Z",
      },
      {
        group_id: groupB,
        user_id: userB,
        name: "User B",
        purpose: "general",
        network: "evm",
        created_at: "2026-07-24T00:00:00.000Z",
        updated_at: "2026-07-24T00:00:00.000Z",
      },
    ],
    asset_wallets: [
      { group_id: groupA, user_id: userA },
      { group_id: groupB, user_id: userB },
    ],
  });
  const recorder = responseRecorder();
  await handleAssetsRoute({
    supabase,
    request: {
      method: "GET",
      url: "/api/v1/wallet-groups",
      headers: {},
    },
    response: recorder.response,
    session: { user: { userId: userA, identities: [] } },
  });
  assert.equal(recorder.result().status, 200);
  assert.deepEqual(
    recorder.result().body.groups.map(({ groupId }) => groupId),
    [groupA],
  );
  assert.equal(recorder.result().body.groups[0].walletCount, 1);
});

test("Vercel Assets rejects anonymous and cross-user wallet-group access", async () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  const groupB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const supabase = fakeSupabase({
    asset_wallet_groups: [
      {
        group_id: groupB,
        user_id: userB,
        name: "User B",
        purpose: "general",
        network: "evm",
      },
    ],
  });
  await assert.rejects(
    handleAssetsRoute({
      supabase,
      request: {
        method: "GET",
        url: "/api/v1/wallet-groups",
        headers: {},
      },
      response: responseRecorder().response,
      session: null,
    }),
    ({ code }: { code: string }) => code === "AUTHENTICATION_REQUIRED",
  );
  await assert.rejects(
    handleAssetsRoute({
      supabase,
      request: {
        method: "GET",
        url: `/api/v1/wallet-groups/${groupB}/wallets`,
        headers: {},
      },
      response: responseRecorder().response,
      session: { user: { userId: userA, identities: [] } },
    }),
    ({ code }: { code: string }) => code === "WALLET_GROUP_NOT_FOUND",
  );
});

test("Agent approval API is actor-scoped, same-origin, versioned, and uses server session auth time", async () => {
  const actorId = "11111111-1111-4111-8111-111111111111";
  const approvalId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const authenticatedAt = new Date().toISOString();
  const approval = {
    schemaVersion: "agent.approval.v1",
    approvalId,
    actorId,
    status: "requested",
    stateVersion: 1,
  };
  let decisionInput;
  const readRecorder = responseRecorder();
  await handleAgentApprovalRoute({
    request: {
      method: "GET",
      url: `/api/v1/agent/approvals/${approvalId}`,
      headers: {},
    },
    response: readRecorder.response,
    session: { authenticatedAt, user: { userId: actorId } },
    readApproval: async (observedApprovalId, observedActorId) => {
      assert.equal(observedApprovalId, approvalId);
      assert.equal(observedActorId, actorId);
      return approval;
    },
  });
  assert.equal(readRecorder.result().status, 200);
  assert.equal(readRecorder.result().body.approvalId, approvalId);
  assert.equal(readRecorder.result().headers.get("cache-control"), "private, no-store");

  await assert.rejects(
    handleAgentApprovalRoute({
      request: {
        method: "POST",
        url: `/api/v1/agent/approvals/${approvalId}/approve`,
        headers: { origin: "https://attacker.example" },
        body: { expectedStateVersion: 1 },
      },
      response: responseRecorder().response,
      session: { authenticatedAt, user: { userId: actorId } },
      decideApproval: async () => approval,
    }),
    ({ code }: { code: string }) => code === "UNTRUSTED_REQUEST_ORIGIN",
  );

  const decisionRecorder = responseRecorder();
  await handleAgentApprovalRoute({
    request: {
      method: "POST",
      url: `/api/v1/agent/approvals/${approvalId}/approve`,
      headers: { origin: "https://www.narraops.xyz" },
      body: {
        expectedStateVersion: 1,
        recentAuthAt: "2099-01-01T00:00:00.000Z",
      },
    },
    response: decisionRecorder.response,
    session: { authenticatedAt, user: { userId: actorId } },
    decideApproval: async (input) => {
      decisionInput = input;
      return { ...approval, status: "approved", stateVersion: 2 };
    },
  });
  assert.equal(decisionRecorder.result().status, 200);
  assert.equal(decisionInput.actorId, actorId);
  assert.equal(decisionInput.decision, "approved");
  assert.equal(decisionInput.expectedStateVersion, 1);
  assert.equal(decisionInput.recentAuthAt, authenticatedAt);
});

test("Agent Memory API is actor-scoped, same-origin, proposal-first, and explicitly confirmed", async () => {
  const actorId = "11111111-1111-4111-8111-111111111111";
  const memoryId = "77777777-7777-4777-8777-777777777777";
  const session = { user: { userId: actorId } };
  let proposalInput;
  const proposalRecorder = responseRecorder();
  await handleAgentMemoryRoute({
    request: {
      method: "POST",
      url: "/api/v1/agent/memories/proposals",
      headers: {
        origin: "https://www.narraops.xyz",
        "idempotency-key": "memory:user-language:1",
      },
      body: {
        kind: "user_preference",
        content: "Prefer Chinese responses.",
      },
    },
    response: proposalRecorder.response,
    session,
    proposeMemory: async (observedActorId, input) => {
      assert.equal(observedActorId, actorId);
      proposalInput = input;
      return {
        item: {
          schemaVersion: "agent.memory_item.v1",
          memoryId,
          actorId,
          status: "proposed",
          stateVersion: 1,
        },
        idempotentReplay: false,
      };
    },
  });
  assert.equal(proposalRecorder.result().status, 201);
  assert.equal(proposalInput.scope, "user");
  assert.equal(proposalInput.source.type, "user_message");
  assert.equal(proposalInput.idempotencyKey, "memory:user-language:1");

  let decisionInput;
  const confirmRecorder = responseRecorder();
  await handleAgentMemoryRoute({
    request: {
      method: "POST",
      url: `/api/v1/agent/memories/${memoryId}/confirm`,
      headers: { origin: "https://www.narraops.xyz" },
      body: { expectedStateVersion: 1 },
    },
    response: confirmRecorder.response,
    session,
    decideMemory: async (observedActorId, input) => {
      assert.equal(observedActorId, actorId);
      decisionInput = input;
      return {
        schemaVersion: "agent.memory_item.v1",
        memoryId,
        actorId,
        status: "active",
        stateVersion: 2,
      };
    },
  });
  assert.equal(confirmRecorder.result().status, 200);
  assert.equal(decisionInput.confirmation, "user_explicit");
  assert.equal(decisionInput.expectedStateVersion, 1);

  const listRecorder = responseRecorder();
  await handleAgentMemoryRoute({
    request: {
      method: "GET",
      url: "/api/v1/agent/memories?limit=10",
      headers: {},
    },
    response: listRecorder.response,
    session,
    listMemories: async (observedActorId, input) => {
      assert.equal(observedActorId, actorId);
      assert.deepEqual(input.scopes, ["user"]);
      return [{ memoryId, actorId, status: "active" }];
    },
  });
  assert.equal(listRecorder.result().body.memories.length, 1);
  assert.equal(listRecorder.result().headers.get("cache-control"), "private, no-store");

  const reviewRecorder = responseRecorder();
  await handleAgentMemoryRoute({
    request: {
      method: "GET",
      url: "/api/v1/agent/memories?review=true&limit=20",
      headers: {},
    },
    response: reviewRecorder.response,
    session,
    listMemories: async (observedActorId, input) => {
      assert.equal(observedActorId, actorId);
      assert.deepEqual(input.statuses, ["proposed", "active"]);
      return [
        { memoryId, actorId, status: "proposed" },
        { memoryId: "88888888-8888-4888-8888-888888888888", actorId, status: "active" },
      ];
    },
  });
  assert.equal(reviewRecorder.result().body.memories.length, 2);

  await assert.rejects(
    handleAgentMemoryRoute({
      request: {
        method: "POST",
        url: `/api/v1/agent/memories/${memoryId}/forget`,
        headers: { origin: "https://attacker.example" },
        body: { expectedStateVersion: 2 },
      },
      response: responseRecorder().response,
      session,
      forgetMemory: async () => null,
    }),
    ({ code }: { code: string }) => code === "UNTRUSTED_REQUEST_ORIGIN",
  );
});

test("Vercel Assets creates three real encrypted Solana wallets", async () => {
  const previousPassword = process.env.WALLET_VAULT_PASSWORD;
  process.env.WALLET_VAULT_PASSWORD = "test-only-wallet-vault-password";
  const supabase = mutableAssetsSupabase();
  const recorder = responseRecorder();
  try {
    await handleAssetsRoute({
      supabase,
      request: {
        method: "POST",
        url: "/api/v1/wallet-groups",
        headers: {},
        body: {
          name: "Three Solana Wallets",
          network: "solana",
          purpose: "general",
          walletCount: 3,
        },
      },
      response: recorder.response,
      session: {
        user: {
          userId: "11111111-1111-4111-8111-111111111111",
          identities: [],
        },
      },
    });
    assert.equal(recorder.result().status, 201);
    assert.equal(recorder.result().body.walletCount, 3);
    assert.equal(recorder.result().body.activeWalletCount, 3);
    assert.equal(supabase.tables.asset_wallet_groups.length, 1);
    assert.equal(supabase.tables.asset_wallets.length, 3);
    assert.equal(supabase.tables.asset_wallet_secrets.length, 3);
    assert.equal(
      new Set(supabase.tables.asset_wallets.map(({ public_address }) => public_address)).size,
      3,
    );
    for (const secret of supabase.tables.asset_wallet_secrets) {
      assert.equal(
        (secret.encrypted_envelope as { format: string }).format,
        "narraops-wallet-vault-v1",
      );
      assert.equal(JSON.stringify(secret).includes("secretKey"), false);
    }
  } finally {
    if (previousPassword === undefined) delete process.env.WALLET_VAULT_PASSWORD;
    else process.env.WALLET_VAULT_PASSWORD = previousPassword;
  }
});

test("Vercel Assets exports decrypted Solana private keys through the catch-all route", async () => {
  const previousPassword = process.env.WALLET_VAULT_PASSWORD;
  process.env.WALLET_VAULT_PASSWORD = "test-only-wallet-vault-password";
  const userId = "11111111-1111-4111-8111-111111111111";
  const supabase = mutableAssetsSupabase();
  try {
    const createRecorder = responseRecorder();
    await handleAssetsRoute({
      supabase,
      request: {
        method: "POST",
        url: "/api/v1/wallet-groups",
        headers: {},
        body: {
          name: "Export Solana Wallets",
          network: "solana",
          purpose: "general",
          walletCount: 3,
        },
      },
      response: createRecorder.response,
      session: { user: { userId, identities: [] } },
    });
    const groupId = createRecorder.result().body.groupId;

    await assert.rejects(
      handleAssetsRoute({
        supabase,
        request: {
          method: "POST",
          url: `/api/v1/wallet-groups/${groupId}/exports`,
          headers: {},
          body: { confirmExport: true, reason: "test export" },
        },
        response: responseRecorder().response,
        session: { user: { userId, identities: [] } },
      }),
      ({ code }: { code: string }) => code === "RECENT_REAUTHENTICATION_REQUIRED",
    );

    const exportRecorder = responseRecorder();
    await handleAssetsRoute({
      supabase,
      request: {
        method: "POST",
        url: `/api/v1/wallet-groups/${groupId}/exports`,
        headers: {
          "x-reauthenticated-at": new Date().toISOString(),
          "x-mfa-verified": "true",
        },
        body: { confirmExport: true, reason: "test export" },
      },
      response: exportRecorder.response,
      session: { user: { userId, identities: [] } },
    });
    const result = exportRecorder.result();
    assert.equal(result.status, 200);
    assert.equal(result.body.walletCount, 3);
    assert.equal(result.body.keyFormat, "base58-secret-key");
    assert.match(result.body.fileName, /^Export Solana Wallets-solana-/);
    assert.equal(String(result.headers.get("cache-control")), "private, no-store");
    for (const wallet of supabase.tables.asset_wallets) {
      assert.match(result.body.content, new RegExp(String(wallet.public_address)));
    }
    assert.equal(
      (result.body.content.match(/Solana private key \(base58\): [1-9A-HJ-NP-Za-km-z]{80,100}/g) || []).length,
      3,
    );
    assert.equal(result.body.content.includes("ciphertext"), false);
    assert.equal(result.body.content.includes("encrypted_envelope"), false);
  } finally {
    if (previousPassword === undefined) delete process.env.WALLET_VAULT_PASSWORD;
    else process.env.WALLET_VAULT_PASSWORD = previousPassword;
  }
});

test("Vercel Assets removes wallet groups, wallets, and secrets after provisioning failure", async () => {
  const previousPassword = process.env.WALLET_VAULT_PASSWORD;
  process.env.WALLET_VAULT_PASSWORD = "test-only-wallet-vault-password";
  const supabase = mutableAssetsSupabase({ failWalletActivationAt: 2 });
  try {
    await assert.rejects(
      handleAssetsRoute({
        supabase,
        request: {
          method: "POST",
          url: "/api/v1/wallet-groups",
          headers: {},
          body: {
            name: "Rollback Solana Wallets",
            network: "solana",
            purpose: "general",
            walletCount: 3,
          },
        },
        response: responseRecorder().response,
        session: {
          user: {
            userId: "11111111-1111-4111-8111-111111111111",
            identities: [],
          },
        },
      }),
      ({ code }: { code: string }) => code === "TEST_ACTIVATION_FAILURE",
    );
    assert.equal(supabase.tables.asset_wallet_groups.length, 0);
    assert.equal(supabase.tables.asset_wallets.length, 0);
    assert.equal(supabase.tables.asset_wallet_secrets.length, 0);
  } finally {
    if (previousPassword === undefined) delete process.env.WALLET_VAULT_PASSWORD;
    else process.env.WALLET_VAULT_PASSWORD = previousPassword;
  }
});

test("Vercel Assets wallet deletion removes an empty group and cascades secrets", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const groupId = "30000000-0000-4000-8000-000000000001";
  const walletA = "40000000-0000-4000-8000-000000000001";
  const walletB = "40000000-0000-4000-8000-000000000002";
  const supabase = mutableAssetsSupabase();
  supabase.tables.asset_wallet_groups.push({
    group_id: groupId,
    user_id: userId,
    name: "Managed Wallets",
    purpose: "general",
    network: "solana",
  });
  for (const [walletId, walletIndex] of [[walletA, 1], [walletB, 2]]) {
    supabase.tables.asset_wallets.push({
      wallet_id: walletId,
      group_id: groupId,
      user_id: userId,
      wallet_index: walletIndex,
      public_address: null,
      provisioning_status: "planned",
    });
    supabase.tables.asset_wallet_secrets.push({
      wallet_id: walletId,
      user_id: userId,
      encrypted_envelope: {},
    });
  }

  const firstRecorder = responseRecorder();
  await handleAssetsRoute({
    supabase,
    request: {
      method: "DELETE",
      url: `/api/v1/wallet-groups/${groupId}/wallets/${walletA}`,
      headers: {},
    },
    response: firstRecorder.response,
    session: { user: { userId, identities: [] } },
  });
  assert.equal(firstRecorder.result().status, 200);
  assert.equal(firstRecorder.result().body.groupDeleted, false);
  assert.equal(supabase.tables.asset_wallet_groups.length, 1);
  assert.equal(supabase.tables.asset_wallets.length, 1);
  assert.equal(supabase.tables.asset_wallet_secrets.length, 1);

  const lastRecorder = responseRecorder();
  await handleAssetsRoute({
    supabase,
    request: {
      method: "DELETE",
      url: `/api/v1/wallet-groups/${groupId}/wallets/${walletB}`,
      headers: {},
    },
    response: lastRecorder.response,
    session: { user: { userId, identities: [] } },
  });
  assert.equal(lastRecorder.result().status, 200);
  assert.equal(lastRecorder.result().body.groupDeleted, true);
  assert.equal(supabase.tables.asset_wallet_groups.length, 0);
  assert.equal(supabase.tables.asset_wallets.length, 0);
  assert.equal(supabase.tables.asset_wallet_secrets.length, 0);
});

test("Vercel Assets delete-all removes the group, wallets, and secrets", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const groupId = "30000000-0000-4000-8000-000000000003";
  const supabase = mutableAssetsSupabase();
  supabase.tables.asset_wallet_groups.push({
    group_id: groupId,
    user_id: userId,
    name: "Delete All",
    purpose: "general",
    network: "solana",
  });
  for (const walletIndex of [1, 2, 3]) {
    const walletId = `40000000-0000-4000-8000-${String(walletIndex + 10).padStart(12, "0")}`;
    supabase.tables.asset_wallets.push({
      wallet_id: walletId,
      group_id: groupId,
      user_id: userId,
      wallet_index: walletIndex,
      public_address: null,
      provisioning_status: "planned",
    });
    supabase.tables.asset_wallet_secrets.push({
      wallet_id: walletId,
      user_id: userId,
      encrypted_envelope: {},
    });
  }

  const recorder = responseRecorder();
  await handleAssetsRoute({
    supabase,
    request: {
      method: "DELETE",
      url: `/api/v1/wallet-groups/${groupId}`,
      headers: {},
    },
    response: recorder.response,
    session: { user: { userId, identities: [] } },
  });
  assert.equal(recorder.result().status, 200);
  assert.equal(recorder.result().body.deletedWalletCount, 3);
  assert.equal(supabase.tables.asset_wallet_groups.length, 0);
  assert.equal(supabase.tables.asset_wallets.length, 0);
  assert.equal(supabase.tables.asset_wallet_secrets.length, 0);
});

test("Vercel auth endpoints fail closed without server credentials", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousPublicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousSecret = process.env.SUPABASE_SECRET_KEY;
  const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const recorder = responseRecorder();
    await handler(
      {
        method: "GET",
        url: "/api/v1/auth/session",
        headers: {},
      },
      recorder.response,
    );
    assert.equal(recorder.result().status, 503);
    assert.equal(
      recorder.result().body.error.code,
      "SUPABASE_SERVER_NOT_CONFIGURED",
    );
  } finally {
    if (previousUrl) process.env.SUPABASE_URL = previousUrl;
    if (previousPublicUrl)
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublicUrl;
    if (previousSecret) process.env.SUPABASE_SECRET_KEY = previousSecret;
    if (previousServiceRole)
      process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
  }
});

test("Go plan endpoint returns not found when no live Pulse opportunity matches", async () => {
  const recorder = responseRecorder();
  await goPlanHandler(
    {
      method: "POST",
      url: "/api/v1/go/plan",
      headers: { "content-type": "application/json" },
      body: {
        opportunityId: "nar_f5067918d8b31778",
        command: "/plan nar_f5067918d8b31778",
      },
    },
    recorder.response,
  );
  const result = recorder.result();
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "PULSE_OPPORTUNITY_NOT_FOUND");
});

test("Go plan endpoint returns not found for unknown opportunity ids", async () => {
  const recorder = responseRecorder();
  await goPlanHandler(
    {
      method: "POST",
      url: "/api/v1/go/plan",
      headers: { "content-type": "application/json" },
      body: {
        opportunityId: "missing-opportunity",
      },
    },
    recorder.response,
  );
  const result = recorder.result();
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, "PULSE_OPPORTUNITY_NOT_FOUND");
});

test("Go plan keeps /analyze-meme on the Agent route", async () => {
  const recorder = responseRecorder();
  await goPlanHandler(
    {
      method: "POST",
      url: "/api/v1/go/plan",
      headers: { "content-type": "application/json" },
      body: {
        message: "/analyze-meme So11111111111111111111111111111111111111112",
        command: "/analyze-meme So11111111111111111111111111111111111111112",
        context: { language: "zh", currentView: "go" },
      },
    },
    recorder.response,
  );
  const result = recorder.result();
  assert.equal(result.status, 200);
  assert.equal(result.body.task.type, "meme.analyze");
  assert.equal(result.body.card.type, "meme_analysis");
});

test("Solana transfer amount conversion preserves exact lamports and decimals", () => {
  assert.equal(transferDecimalToLamports("1"), 1_000_000_000n);
  assert.equal(transferDecimalToLamports("0.000000001"), 1n);
  assert.equal(transferDecimalToLamports("1.5"), 1_500_000_000n);
  assert.equal(transferDecimalToLamports("0"), 0n);
  assert.equal(transferLamportsToDecimal(1_000_000_000n), "1");
  assert.equal(transferLamportsToDecimal(1n), "0.000000001");
  assert.equal(transferLamportsToDecimal(1_500_000_000n), "1.5");
  assert.equal(transferLamportsToDecimal(0n), "0");
  const roundTrip = transferLamportsToDecimal(transferDecimalToLamports("123.456789"));
  assert.equal(roundTrip, "123.456789");
});
