// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import { Interface } from "ethers";
import { PonsUniswapV3QuoteProvider, ROBINHOOD_UNISWAP_V3 } from "../pons-uniswap-v3-quote-provider.ts";

const tokenAddress = "0x432C99bBD9dc1d9040087598d7Cf40502d7cC20b";
const pairToken = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const pool = "0xA1Ad01da59552689835902b878Ce6f5ea37F2B0B";
const buyer = "0xF2233d355FCE35b141056EcC04C11B38F1F09918";
const tokenAbi = new Interface(["function liquidityPool() view returns(address)", "function pairToken() view returns(address)", "function poolFee() view returns(uint24)", "function maxTxAmount() view returns(uint256)", "function maxWalletAmount() view returns(uint256)"]);
const factoryAbi = new Interface(["function getPool(address,address,uint24) view returns(address)"]);
const quoterAbi = new Interface(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns(uint256,uint160,uint32,uint256)"]);
const routerAbi = new Interface(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns(uint256)"]);

function rpc(poolResult = pool) {
  return { request: async (_method, [{ to, data }]) => {
    const selector = data.slice(0, 10);
    if (to.toLowerCase() === tokenAddress.toLowerCase()) {
      if (selector === tokenAbi.getFunction("liquidityPool").selector) return tokenAbi.encodeFunctionResult("liquidityPool", [pool]);
      if (selector === tokenAbi.getFunction("pairToken").selector) return tokenAbi.encodeFunctionResult("pairToken", [pairToken]);
      if (selector === tokenAbi.getFunction("poolFee").selector) return tokenAbi.encodeFunctionResult("poolFee", [10000]);
      if (selector === tokenAbi.getFunction("maxTxAmount").selector) return tokenAbi.encodeFunctionResult("maxTxAmount", [1_000_000n]);
      if (selector === tokenAbi.getFunction("maxWalletAmount").selector) return tokenAbi.encodeFunctionResult("maxWalletAmount", [1_000_000n]);
    }
    if (to.toLowerCase() === ROBINHOOD_UNISWAP_V3.factory.toLowerCase()) return factoryAbi.encodeFunctionResult("getPool", [poolResult]);
    if (to.toLowerCase() === ROBINHOOD_UNISWAP_V3.quoterV2.toLowerCase()) return quoterAbi.encodeFunctionResult("quoteExactInputSingle", [1000n, 0n, 0, 120000n]);
    throw new Error(`unexpected call ${to} ${selector}`);
  } };
}

test("builds a public Uniswap V3 follow-buy with slippage protection", async () => {
  const provider = new PonsUniswapV3QuoteProvider({ rpcClient: rpc() });
  const [transaction] = await provider.buildPonsBuyBatch({ tokenAddress, allocations: [{ walletReferenceId: "wallet-1", publicAddress: buyer, amountWei: "20" }], slippageBps: 500 });
  assert.equal(transaction.to, ROBINHOOD_UNISWAP_V3.swapRouter02);
  assert.equal(transaction.value, "20");
  assert.deepEqual(transaction.quote, { amountOut: "1000", amountOutMinimum: "950", pool });
  const [params] = routerAbi.decodeFunctionData("exactInputSingle", transaction.data);
  assert.equal(params.recipient, buyer);
  assert.equal(params.amountIn, 20n);
  assert.equal(params.amountOutMinimum, 950n);
});

test("rejects a token whose advertised pool is not from the official factory", async () => {
  const provider = new PonsUniswapV3QuoteProvider({ rpcClient: rpc("0x1111111111111111111111111111111111111111") });
  await assert.rejects(() => provider.buildPonsBuyBatch({ tokenAddress, allocations: [{ walletReferenceId: "wallet-1", publicAddress: buyer, amountWei: "20" }], slippageBps: 500 }), { code: "PONS_POOL_MISMATCH" });
});
