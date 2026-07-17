import { Interface, getAddress } from "ethers";
import { ExecutionError } from "./errors.js";

export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_UNISWAP_V3 = Object.freeze({
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2",
});

const tokenInterface = new Interface([
  "function liquidityPool() view returns (address)",
  "function pairToken() view returns (address)",
  "function poolFee() view returns (uint24)",
  "function maxTxAmount() view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)",
]);
const factoryInterface = new Interface(["function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)"]);
const quoterInterface = new Interface([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);
const routerInterface = new Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

function validateSlippage(value) {
  const slippageBps = Number(value);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    throw new ExecutionError("INVALID_SLIPPAGE", "slippageBps must be an integer between 1 and 5000");
  }
  return slippageBps;
}

export class PonsUniswapV3QuoteProvider {
  constructor({ rpcClient, contracts = ROBINHOOD_UNISWAP_V3 } = {}) {
    this.rpcClient = rpcClient;
    this.contracts = contracts;
  }

  async call(to, data) {
    return this.rpcClient.request("eth_call", [{ to, data }, "latest"]);
  }

  async readToken(tokenAddress) {
    const read = async (name) => tokenInterface.decodeFunctionResult(name, await this.call(tokenAddress, tokenInterface.encodeFunctionData(name)))[0];
    const [liquidityPool, pairToken, poolFee, maxTxAmount, maxWalletAmount] = await Promise.all([
      read("liquidityPool"), read("pairToken"), read("poolFee"), read("maxTxAmount"), read("maxWalletAmount"),
    ]);
    return {
      liquidityPool: getAddress(liquidityPool),
      pairToken: getAddress(pairToken),
      poolFee: Number(poolFee),
      maxTxAmount: BigInt(maxTxAmount),
      maxWalletAmount: BigInt(maxWalletAmount),
    };
  }

  async verifyPool(tokenAddress, token) {
    const data = factoryInterface.encodeFunctionData("getPool", [token.pairToken, tokenAddress, token.poolFee]);
    const pool = factoryInterface.decodeFunctionResult("getPool", await this.call(this.contracts.factory, data))[0];
    if (getAddress(pool) !== token.liquidityPool) {
      throw new ExecutionError("PONS_POOL_MISMATCH", "Token pool does not match the official Uniswap V3 factory");
    }
  }

  async quote({ tokenAddress, token, amountIn }) {
    const params = { tokenIn: token.pairToken, tokenOut: tokenAddress, amountIn, fee: token.poolFee, sqrtPriceLimitX96: 0 };
    const data = quoterInterface.encodeFunctionData("quoteExactInputSingle", [params]);
    const [amountOut] = quoterInterface.decodeFunctionResult("quoteExactInputSingle", await this.call(this.contracts.quoterV2, data));
    return BigInt(amountOut);
  }

  async buildPonsBuyBatch({ tokenAddress, allocations, slippageBps }) {
    const slippage = validateSlippage(slippageBps);
    const token = await this.readToken(getAddress(tokenAddress));
    await this.verifyPool(getAddress(tokenAddress), token);

    return Promise.all(allocations.map(async (allocation) => {
      const amountIn = BigInt(allocation.amountWei);
      if (amountIn <= 0n) throw new ExecutionError("INVALID_BUY_AMOUNT", "Follow-buy amount must be positive");
      const quotedAmountOut = await this.quote({ tokenAddress: getAddress(tokenAddress), token, amountIn });
      if (quotedAmountOut <= 0n) throw new ExecutionError("EMPTY_UNISWAP_QUOTE", "Uniswap returned no output for this buy");
      if (quotedAmountOut > token.maxTxAmount || quotedAmountOut > token.maxWalletAmount) {
        throw new ExecutionError("PONS_TOKEN_LIMIT_EXCEEDED", "Quoted output exceeds the token launch restriction");
      }
      const amountOutMinimum = (quotedAmountOut * BigInt(10_000 - slippage)) / 10_000n;
      const data = routerInterface.encodeFunctionData("exactInputSingle", [{
        tokenIn: token.pairToken,
        tokenOut: getAddress(tokenAddress),
        fee: token.poolFee,
        recipient: getAddress(allocation.publicAddress),
        amountIn,
        amountOutMinimum,
        sqrtPriceLimitX96: 0,
      }]);
      return {
        walletReferenceId: allocation.walletReferenceId,
        chainId: ROBINHOOD_CHAIN_ID,
        from: getAddress(allocation.publicAddress),
        to: getAddress(this.contracts.swapRouter02),
        value: amountIn.toString(),
        data,
        quote: { amountOut: quotedAmountOut.toString(), amountOutMinimum: amountOutMinimum.toString(), pool: token.liquidityPool },
      };
    }));
  }
}

