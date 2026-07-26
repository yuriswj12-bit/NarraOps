import assert from "node:assert/strict";
import test from "node:test";
import handlerModule, {
  handleAssetsRoute,
} from "../../../api/v1/[...path].ts";
import { buildPulseMarketResponse } from "../../../api/v1/pulse-market.ts";

const handler =
  typeof handlerModule === "function"
    ? handlerModule
    : (handlerModule as { default: typeof handlerModule }).default;

test("Pulse market response keeps decimal values as strings", () => {
  const response = buildPulseMarketResponse([
    {
      observed_at: "2026-07-26T00:00:00.000Z",
      daily_tokens_created: 26426,
      tokens_launched_24h: 26426,
      graduated_tokens_24h: 1049,
      daily_active_wallets: 120000,
      daily_revenue_usd: "1234567.89",
      daily_tokens_created_score: "70.00",
      tokens_launched_24h_score: "65.00",
      graduated_tokens_24h_score: "75.00",
      daily_active_wallets_score: "80.00",
      daily_revenue_usd_score: "60.00",
      market_activity_index: "71.75",
      calculation_status: "ready",
    },
    {
      observed_at: "2026-07-25T00:00:00.000Z",
      market_activity_index: "70.25",
      calculation_status: "ready",
    },
  ]);
  assert.equal(response.data_status, "ready");
  assert.equal(response.index.value, "71.75");
  assert.equal(response.index.change_24h, "1.50");
  assert.equal(response.schema_version, "pulse.market.v2");
  assert.equal(response.index.components.daily_revenue_usd.raw_value, "1234567.89");
  assert.equal(response.sparkline.length, 2);
});

test("Pulse market response never fabricates an index without observations", () => {
  const response = buildPulseMarketResponse([]);
  assert.equal(response.data_status, "awaiting_market_observation");
  assert.equal(response.index.value, null);
  assert.equal(response.index.change_24h, null);
  assert.deepEqual(response.sparkline, []);
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
