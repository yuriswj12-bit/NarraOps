import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { createApplication } from "../src/app.mjs";
import { createLogger } from "../src/security.mjs";
import { Web3AuthService } from "../src/web3-auth-service.mjs";

const config = { bodyLimitBytes: 100_000, taskStepDelayMs: 1, sseHeartbeatMs: 1_000, secureCookies: false };

async function startApi(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "narraops-auth-"));
  const authService = new Web3AuthService({ filePath: join(directory, "auth.json"), origin: "http://127.0.0.1:5188" });
  const application = createApplication({ config, logger: createLogger("silent"), authService, ...overrides });
  await new Promise((resolve) => application.server.listen(0, "127.0.0.1", resolve));
  return { application, baseUrl: `http://127.0.0.1:${application.server.address().port}` };
}

async function post(baseUrl, path, body, cookie) {
  return fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
}

test("EVM wallet challenge creates an HttpOnly session and cannot be replayed", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const wallet = Wallet.createRandom();
  const challenge = await post(baseUrl, "/api/v1/auth/web3/challenge", { chain: "evm", address: wallet.address, chainId: 56 }).then((response) => response.json());
  const signature = await wallet.signMessage(challenge.message);
  const verified = await post(baseUrl, "/api/v1/auth/web3/verify", { challengeId: challenge.challengeId, signature });
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  assert.match(verified.headers.get("set-cookie"), /HttpOnly/);
  const session = await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(session.authenticated, true);
  assert.equal(session.user.identities[0].address, wallet.address);
  assert.equal((await post(baseUrl, "/api/v1/auth/web3/verify", { challengeId: challenge.challengeId, signature })).status, 400);
  const logout = await post(baseUrl, "/api/v1/auth/logout", {}, cookie);
  assert.equal(logout.status, 200);
  assert.equal((await fetch(`${baseUrl}/api/v1/auth/session`, { headers: { cookie } }).then((response) => response.json())).authenticated, false);
});

test("Solana wallet challenge verifies signMessage signatures", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const wallet = nacl.sign.keyPair();
  const address = bs58.encode(wallet.publicKey);
  const challenge = await post(baseUrl, "/api/v1/auth/web3/challenge", { chain: "solana", address }).then((response) => response.json());
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(challenge.message, "utf8"), wallet.secretKey)).toString("base64");
  const verified = await post(baseUrl, "/api/v1/auth/web3/verify", { challengeId: challenge.challengeId, signature });
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).user.identities[0].address, address);
});

test("wrong wallet signatures are rejected", async (t) => {
  const { application, baseUrl } = await startApi();
  t.after(() => application.close());
  const expected = Wallet.createRandom();
  const attacker = Wallet.createRandom();
  const challenge = await post(baseUrl, "/api/v1/auth/web3/challenge", { chain: "evm", address: expected.address, chainId: 1 }).then((response) => response.json());
  const response = await post(baseUrl, "/api/v1/auth/web3/verify", { challengeId: challenge.challengeId, signature: await attacker.signMessage(challenge.message) });
  assert.equal(response.status, 401);
});

test("authenticated login wallets expose live read-only native balances", async (t) => {
  const assetService = { balances: async ({ addresses }) => addresses.solana
    ? { solana: { chain: "solana", asset: "SOL", amount: "1.25", atomic: "1250000000", status: "live" } }
    : { bsc: { chain: "bsc", asset: "BNB", amount: "0.5", atomic: "500000000000000000", status: "live" } } };
  const { application, baseUrl } = await startApi({ assetService });
  t.after(() => application.close());
  assert.equal((await fetch(`${baseUrl}/api/v1/account/login-wallet-assets`)).status, 401);
  const wallet = Wallet.createRandom();
  const challenge = await post(baseUrl, "/api/v1/auth/web3/challenge", { chain: "evm", address: wallet.address, chainId: 56 }).then((response) => response.json());
  const verified = await post(baseUrl, "/api/v1/auth/web3/verify", { challengeId: challenge.challengeId, signature: await wallet.signMessage(challenge.message) });
  const cookie = verified.headers.get("set-cookie").split(";")[0];
  const assets = await fetch(`${baseUrl}/api/v1/account/login-wallet-assets`, { headers: { cookie } }).then((response) => response.json());
  assert.equal(assets.mode, "live");
  assert.equal(assets.wallets[0].address, wallet.address);
  assert.equal(assets.wallets[0].balances.bsc.amount, "0.5");
});
