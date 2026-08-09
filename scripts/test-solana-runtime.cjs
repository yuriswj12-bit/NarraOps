"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { dirname, join } = require("node:path");
const { Keypair } = require("@solana/web3.js");
const web3Require = createRequire(require.resolve("@solana/web3.js/package.json"));
const rpcPackageDirectory = join(dirname(web3Require.resolve("rpc-websockets")), "..");
const rpcWebsocketsPackage = JSON.parse(
  readFileSync(join(rpcPackageDirectory, "package.json"), "utf8"),
);
const rpcUuidPackage = JSON.parse(
  readFileSync(join(rpcPackageDirectory, "node_modules", "uuid", "package.json"), "utf8"),
);

assert.equal(rpcWebsocketsPackage.version, "9.3.9");
assert.equal(rpcUuidPackage.version, "11.1.0");

const keypairs = Array.from({ length: 3 }, () => Keypair.generate());
try {
  assert.equal(new Set(keypairs.map(({ publicKey }) => publicKey.toBase58())).size, 3);
  for (const keypair of keypairs) {
    assert.equal(keypair.secretKey.byteLength, 64);
    assert.match(keypair.publicKey.toBase58(), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  }
  console.log(
    `Solana strict-CJS runtime check passed: ${keypairs.length} unique keypairs, rpc-websockets ${rpcWebsocketsPackage.version}, uuid ${rpcUuidPackage.version}`,
  );
} finally {
  for (const keypair of keypairs) keypair.secretKey.fill(0);
}
