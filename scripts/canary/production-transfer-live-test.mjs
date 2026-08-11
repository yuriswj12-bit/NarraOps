#!/usr/bin/env node
// Real-value Transfer live test for the Provider-neutral Execution Gateway.
// Authorized for small amounts only. Never use this with main wallets or large funds.
//
// Usage:
//   node scripts/canary/production-transfer-live-test.mjs \
//     --api https://www.narraops.xyz \
//     --wallet-key <base58 solana private key> \
//     --wallet-group <source wallet group id> \
//     --to <destination wallet group id OR external address> \
//     --amount 0.001 \
//     [--to-type group|address] \
//     [--amount-mode amount|fraction] [--fraction-bps 100]
//
// Requires: @solana/web3.js, bs58, tweetnacl (project deps).

import { createHash } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required --${name}`);
}

async function main() {
  const api = String(arg("api", "https://www.narraops.xyz")).replace(/\/+$/, "");
  const walletKeyBase58 = arg("wallet-key");
  const walletGroup = arg("wallet-group");
  const to = arg("to");
  const toType = String(arg("to-type", "address"));
  const amount = String(arg("amount", "0.001"));
  const amountMode = String(arg("amount-mode", "amount"));
  const fractionBps = Number(arg("fraction-bps", "100"));

  const keypair = Keypair.fromSecretKey(bs58.decode(walletKeyBase58));
  const address = keypair.publicKey.toBase58();
  console.log(`[transfer-live] wallet=${address} group=${walletGroup} to=${to}`);

  const jar = [];

  async function apiRequest(path, body) {
    const headers = { "content-type": "application/json" };
    if (jar.length) headers.cookie = jar.join("; ");
    const response = await fetch(`${api}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "manual",
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      const sessionPart = setCookie.split(";")[0];
      if (sessionPart && !jar.some((entry) => entry.startsWith("narraops_session"))) {
        jar.push(sessionPart);
      }
    }
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }

  const challenge = await apiRequest("/api/v1/auth/web3/challenge", {
    chain: "solana",
    address,
  });
  if (challenge.status !== 201 || !challenge.payload.challengeId) {
    throw new Error(`Challenge failed: ${JSON.stringify(challenge)}`);
  }
  const signature = bs58.encode(
    nacl.sign.detached(Buffer.from(challenge.payload.message, "utf8"), keypair.secretKey),
  );
  const verify = await apiRequest("/api/v1/auth/web3/verify", {
    challengeId: challenge.payload.challengeId,
    signature,
  });
  if (verify.status !== 200 || !verify.payload.authenticated) {
    throw new Error(`Verify failed: ${JSON.stringify(verify)}`);
  }
  console.log("[transfer-live] authenticated");

  const idempotencyKey = `transfer-live-${Date.now()}`;
  const destination = toType === "group" ? { type: "wallet_group", id: to } : { type: "login_wallet", address: to };
  const previewBody = {
    chain: "solana",
    source: { type: "wallet_group", id: walletGroup },
    destination,
    amountMode,
    distribution: "equal",
    idempotencyKey,
    ...(amountMode === "amount" ? { amount } : { fractionBps }),
  };
  const preview = await apiRequest("/api/v1/transfers/preview", previewBody);
  if (preview.status !== 201 || !preview.payload.previewToken) {
    throw new Error(`Preview failed: ${JSON.stringify(preview)}`);
  }
  console.log(`[transfer-live] preview=${preview.payload.previewToken} pairs=${preview.payload.pairCount}`);

  const createBody = {
    chain: "solana",
    source: { type: "wallet_group", id: walletGroup },
    destination,
    amountMode,
    distribution: "equal",
    idempotencyKey,
    previewToken: preview.payload.previewToken,
    confirmationToken: preview.payload.confirmationToken,
    ...(amountMode === "amount" ? { amount } : { fractionBps }),
  };
  const create = await apiRequest("/api/v1/transfers", createBody);
  console.log(`[transfer-live] create status=${create.status}`);
  console.log(JSON.stringify(create.payload, null, 2));
  if (create.status !== 202) {
    throw new Error(`Transfer create failed: ${JSON.stringify(create)}`);
  }
  const transfer = create.payload;
  if (!["submitted", "confirmed", "partially_failed"].includes(transfer.status)) {
    throw new Error(`Unexpected transfer status: ${transfer.status}`);
  }
  console.log(
    `[transfer-live] DONE status=${transfer.status} confirmed=${transfer.confirmed} txHash=${transfer.txHash || "none"}`,
  );
}

main().catch((error) => {
  console.error(`[transfer-live] FAILED: ${error.message}`);
  process.exitCode = 1;
});
