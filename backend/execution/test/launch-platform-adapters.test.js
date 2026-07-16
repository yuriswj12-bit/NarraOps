import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import { PumpLaunchAdapter } from "../pump-launch-adapter.js";
import { FourMemeLaunchAdapter, FOURMEME_TOKEN_MANAGER2 } from "../fourmeme-launch-adapter.js";

test("Pump adapter builds a mint-partially-signed transaction for the browser wallet", async () => {
  const user = Keypair.generate();
  const adapter = new PumpLaunchAdapter({
    connection: { getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 99 }) },
    offlineSdk: { createV2Instruction: async ({ mint }) => new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: true, isWritable: true }], data: Buffer.alloc(0) }) },
  });
  const result = await adapter.buildLaunch({ userAddress: user.publicKey.toBase58(), name: "Narra", symbol: "NARRA", metadataUri: "https://metadata.invalid/token.json" });
  const transaction = Transaction.from(Buffer.from(result.transactionBase64, "base64"));
  assert.equal(result.platform, "pump");
  assert.equal(transaction.feePayer.toBase58(), user.publicKey.toBase58());
  assert.equal(transaction.signatures.length, 2);
  assert.ok(transaction.signatures.some(({ signature }) => signature));
  assert.ok(transaction.signatures.some(({ signature }) => !signature));
});

test("Four.Meme adapter uses wallet login and builds TokenManager2 createToken calldata", async () => {
  const manager = new Interface(["function createToken(bytes,bytes) payable", "function _launchFee() view returns(uint256)", "function _tradingFeeRate() view returns(uint256)"]);
  const address = "0x2222222222222222222222222222222222222222";
  const responses = [
    { code: 0, data: "access-token" }, { code: 0, data: "https://four.meme/image.png" },
    { code: 0, data: [{ symbol: "BNB", status: "PUBLISH", totalAmount: 1000000000, totalBAmount: 24, saleRate: 0.8 }] },
    { code: 0, data: { createArg: "0x1234", signature: "0xabcd" } },
  ];
  const adapter = new FourMemeLaunchAdapter({
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift() }),
    rpcClient: { request: async (_method, [{ data }]) => data.slice(0, 10) === manager.getFunction("_launchFee").selector ? manager.encodeFunctionResult("_launchFee", [100n]) : manager.encodeFunctionResult("_tradingFeeRate", [100n]) },
  });
  const result = await adapter.buildLaunch({ address, loginSignature: "0xsigned", image: Buffer.from("image"), name: "Narra", symbol: "NARRA", description: "Agent meme", developerBuyWei: "1000" });
  assert.equal(result.to, FOURMEME_TOKEN_MANAGER2);
  assert.equal(result.value, "1110");
  const [args, signature] = manager.decodeFunctionData("createToken", result.data);
  assert.equal(args, "0x1234"); assert.equal(signature, "0xabcd");
});
