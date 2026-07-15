import test from "node:test";
import assert from "node:assert/strict";
import { containsForbiddenSecret, redact } from "../src/security.mjs";

test("redaction recursively filters credentials and authorization metadata", () => {
  const output = redact({
    authorization: "Bearer secret",
    nested: { apiKey: "secret", Cookie: "session=secret", safe: "visible" },
  });
  assert.equal(output.authorization, "[REDACTED]");
  assert.equal(output.nested.apiKey, "[REDACTED]");
  assert.equal(output.nested.Cookie, "[REDACTED]");
  assert.equal(output.nested.safe, "visible");
});

test("request guard rejects wallet secrets", () => {
  assert.equal(containsForbiddenSecret({ wallet: { privateKey: "do-not-accept" } }), true);
  assert.equal(containsForbiddenSecret({ wallet: { publicKey: "safe-public-address" } }), false);
});
