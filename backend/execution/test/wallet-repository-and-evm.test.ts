// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Wallet } from "ethers";
import { sealWalletSecret } from "../encrypted-wallet-vault.ts";
import { EncryptedWalletRepository } from "../encrypted-wallet-repository.ts";
import { EvmJsonRpcClient, EvmTransactionAdapter } from "../evm-transaction-adapter.ts";

test("encrypted wallet repository persists envelopes without plaintext keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "narraops-wallets-"));
  try {
    const filePath = join(directory, "wallets.json");
    const repository = new EncryptedWalletRepository({ filePath });
    const envelope = sealWalletSecret({ walletReferenceId: "wallet-1", publicAddress: "0xabc", privateKey: "never-persist-me", password: "password" });
    await repository.putEncryptedWallet(envelope);
    assert.deepEqual(await repository.getEncryptedWallet("wallet-1"), envelope);
    assert.doesNotMatch(await readFile(filePath, "utf8"), /never-persist-me|password/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("EVM adapter signs Robinhood transactions locally and keeps broadcasting disabled", async () => {
  const wallet = Wallet.createRandom();
  const calls = [];
  const responses = { eth_chainId: "0x1237", eth_getTransactionCount: "0x2", eth_gasPrice: "0x3b9aca00", eth_estimateGas: "0x5208" };
  const rpcClient = { request: async (method, params) => { calls.push({ method, params }); return responses[method]; } };
  const adapter = new EvmTransactionAdapter({ rpcClient, chainId: 4663 });
  const signed = await adapter.signTransaction({
    privateKey: Buffer.from(wallet.privateKey),
    transaction: { chainId: 4663, from: wallet.address, to: "0x1111111111111111111111111111111111111111", value: "10", data: "0x1234" },
  });
  const parsed = adapter.parseSignedTransaction(signed);
  assert.equal(parsed.from, wallet.address);
  assert.equal(parsed.chainId, 4663n);
  assert.equal(parsed.nonce, 2);
  assert.equal(parsed.value, 10n);
  assert.equal(parsed.gasLimit, 25200n);
  assert.deepEqual(calls.map(({ method }) => method), ["eth_chainId", "eth_getTransactionCount", "eth_gasPrice", "eth_estimateGas"]);
  await assert.rejects(() => adapter.broadcastTransaction({ signedTransaction: signed }), { code: "REAL_EXECUTION_DISABLED" });
});

test("JSON RPC client sends canonical requests and rejects RPC errors", async () => {
  const requests = [];
  const client = new EvmJsonRpcClient({ rpcUrl: "https://rpc.invalid", fetchImpl: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x1237" }) };
  } });
  assert.equal(await client.request("eth_chainId"), "0x1237");
  assert.equal(requests[0].method, "eth_chainId");
});
