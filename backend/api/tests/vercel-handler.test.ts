import assert from "node:assert/strict";
import test from "node:test";
import handlerModule from "../../../api/v1/[...path].ts";

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
