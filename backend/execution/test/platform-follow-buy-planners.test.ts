// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { Keypair, TransactionInstruction } from "@solana/web3.js";
import { FourMemeFollowBuyPlanner, FOURMEME_HELPER3 } from "../platform-follow-buy-planners.ts";

test("Four.Meme follow-buy planner quotes through Helper3 and applies slippage", async () => {
  const abi = new Interface(["function tryBuy(address,uint256,uint256) view returns(address,address,uint256,uint256,uint256,uint256,uint256,uint256)", "function buyTokenAMAP(address,uint256,uint256) payable"]);
  const tokenManager = "0x3333333333333333333333333333333333333333";
  const planner = new FourMemeFollowBuyPlanner({ rpcClient: { request: async (_method, [{ to }]) => { assert.equal(to, FOURMEME_HELPER3); return abi.encodeFunctionResult("tryBuy", [tokenManager, "0x0000000000000000000000000000000000000000", 1000n, 900n, 10n, 101n, 0n, 100n]); } } });
  const result = await planner.buildBuy({ tokenAddress: "0x2222222222222222222222222222222222222222", userAddress: "0x4444444444444444444444444444444444444444", fundsWei: "100", slippageBps: 500 });
  assert.equal(result.to, tokenManager); assert.equal(result.value, "101"); assert.equal(result.minAmount, "950");
});
