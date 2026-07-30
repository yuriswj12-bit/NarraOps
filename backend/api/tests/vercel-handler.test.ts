import assert from "node:assert/strict";
import test from "node:test";
import handlerModule, {
  handleAssetsRoute,
} from "../../../api/v1/[...path].ts";
import { buildPulseMarketResponse } from "../../../api/v1/pulse-market.ts";
import { buildPulseDevWalletPnlResponse } from "../../../api/v1/pulse-dev-wallet-pnl.ts";
import { buildPulseNarrativesResponse } from "../../../api/v1/pulse-narratives.ts";

const handler =
  typeof handlerModule === "function"
    ? handlerModule
    : (handlerModule as { default: typeof handlerModule }).default;

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
  ], now);
  assert.equal(response.schema_version, "pulse.narratives.v1");
  assert.equal(response.data_status, "live");
  assert.equal(response.total, 1);
  assert.equal(response.columns.events[0].original_text, "Original source text");
  assert.equal(response.columns.events.length, 1);
  assert.deepEqual(response.columns.ai_tech, []);
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
  assert.equal(recorder.result().body.execution, "disabled");
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
  assert.match(result.body.data_status, /reviewed_snapshot/);
  assert.equal(result.body.opportunities.length, 1);
  assert.equal(result.body.opportunities[0].status, "review");
  assert.equal(result.body.opportunities[0].evidence.length, 2);
  assert.equal("heat" in result.body.opportunities[0], false);
  assert.equal("score" in result.body.opportunities[0], false);
  assert.equal(result.body.execution, "disabled");
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

test("Go plan endpoint builds a review-only execution plan from Pulse evidence", async () => {
  const recorder = responseRecorder();
  await handler(
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
  assert.equal(result.status, 200);
  assert.equal(result.body.schema_version, "go.plan.v1");
  assert.equal(result.body.execution, "disabled");
  assert.equal(result.body.card.type, "execution_plan");
  assert.equal(result.body.plan.opportunity_id, "nar_f5067918d8b31778");
  assert.equal(result.body.plan.executable, false);
  assert.equal(result.body.plan.requires_user_confirmation, true);
  assert.ok(result.body.plan.evidence_count >= 1);
  assert.equal(result.body.opportunity.opportunityId, "nar_f5067918d8b31778");
});

test("Go plan endpoint returns not found for unknown opportunity ids", async () => {
  const recorder = responseRecorder();
  await handler(
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
