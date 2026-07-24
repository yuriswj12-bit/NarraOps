import assert from "node:assert/strict";
import test from "node:test";
import handlerModule, {
  handleAssetsRoute,
} from "../../../api/v1/[...path].ts";

const handler =
  typeof handlerModule === "function"
    ? handlerModule
    : (handlerModule as { default: typeof handlerModule }).default;

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

test("Vercel Pulse is stable without database credentials or fabricated live signals", async () => {
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
  assert.equal(result.body.data_status, "awaiting_evidence_snapshot");
  assert.deepEqual(result.body.opportunities, []);
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
