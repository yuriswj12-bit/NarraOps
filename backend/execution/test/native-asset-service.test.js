import test from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { Wallet } from "ethers";
import { NativeAssetService, decimalToLamports, lamportsToDecimal } from "../native-asset-service.js";

test("native amount conversion preserves exact SOL atomic units", () => {
  assert.equal(decimalToLamports("1.000000001"), 1_000_000_001n);
  assert.equal(lamportsToDecimal(1_000_000_001n), "1.000000001");
});

test("reads live native balances without exposing wallet secrets", async () => {
  const solana = Keypair.generate();
  const evm = Wallet.createRandom();
  const service = new NativeAssetService({
    walletRepository: { getEncryptedWallet: async () => null },
    vaultPassword: "test-password-1234",
    solanaConnection: { getBalance: async () => 1_250_000_000 },
    evmChains: { bsc: { asset: "BNB", chainId: 56, rpcClient: { request: async () => "0xde0b6b3a7640000" } } },
  });
  const balances = await service.balances({ addresses: { solana: solana.publicKey.toBase58(), bsc: evm.address } });
  assert.equal(balances.solana.amount, "1.25");
  assert.equal(balances.bsc.amount, "1.0");
});

test("native transfer broadcasting stays disabled by default", async () => {
  const service = new NativeAssetService({ walletRepository: {}, vaultPassword: "test-password-1234", solanaConnection: {}, executionEnabled: false });
  await assert.rejects(() => service.transfer({ chain: "solana", walletReferenceId: "wallet", from: "a", to: "b", amount: "0.01" }), { code: "REAL_EXECUTION_DISABLED" });
});
