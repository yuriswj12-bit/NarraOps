// @ts-nocheck
import BN from "bn.js";
import { Interface, getAddress } from "ethers";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { ExecutionError } from "./errors.ts";

const WRAPPED_SOL = new PublicKey("So11111111111111111111111111111111111111112");
export const FOURMEME_HELPER3 = "0xF251F83e40a78868FcfA3FA4599Dad6494E46034";
const helper = new Interface(["function tryBuy(address token,uint256 amount,uint256 funds) view returns(address tokenManager,address quote,uint256 estimatedAmount,uint256 estimatedCost,uint256 estimatedFee,uint256 amountMsgValue,uint256 amountApproval,uint256 amountFunds)"]);
const manager = new Interface(["function buyTokenAMAP(address token,uint256 funds,uint256 minAmount) payable"]);

export class PumpFollowBuyPlanner {
  constructor({ connection, onlineSdk, offlineSdk }) { this.connection = connection; this.onlineSdk = onlineSdk; this.offlineSdk = offlineSdk; }
  async buildBuy({ mintAddress, userAddress, quoteLamports, slippageBps = 500 }) {
    const mint = new PublicKey(mintAddress); const user = new PublicKey(userAddress); const quote = new BN(String(quoteLamports));
    if (quote.lten(0)) throw new ExecutionError("INVALID_BUY_AMOUNT", "Pump follow-buy amount must be positive");
    const [global, feeConfig, state] = await Promise.all([this.onlineSdk.fetchGlobal(), this.onlineSdk.fetchFeeConfig(), this.onlineSdk.fetchBuyState(mint, user)]);
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: state.bondingCurve, amount: quote, quoteMint: WRAPPED_SOL });
    const instructions = await this.offlineSdk.buyV2Instructions({ global, ...state, mint, user, amount, quoteAmount: quote, slippage: slippageBps / 10_000 });
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: user, recentBlockhash: blockhash }).add(...instructions);
    return { platform: "pump", chain: "solana", walletAddress: user.toBase58(), mintAddress: mint.toBase58(), quoteLamports: quote.toString(), transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight };
  }
}

export class FourMemeFollowBuyPlanner {
  constructor({ rpcClient }) { this.rpcClient = rpcClient; }
  async buildBuy({ tokenAddress, userAddress, fundsWei, slippageBps = 500 }) {
    const token = getAddress(tokenAddress); const from = getAddress(userAddress); const funds = BigInt(fundsWei);
    if (funds <= 0n) throw new ExecutionError("INVALID_BUY_AMOUNT", "Four.Meme follow-buy amount must be positive");
    const result = await this.rpcClient.request("eth_call", [{ to: FOURMEME_HELPER3, data: helper.encodeFunctionData("tryBuy", [token, 0n, funds]) }, "latest"]);
    const [tokenManager, quote, estimatedAmount, , , amountMsgValue, amountApproval] = helper.decodeFunctionResult("tryBuy", result);
    if (quote !== "0x0000000000000000000000000000000000000000" || amountApproval > 0n) throw new ExecutionError("FOURMEME_NON_NATIVE_QUOTE_UNSUPPORTED", "Follow-buy currently supports native BNB quote tokens only");
    const minAmount = (estimatedAmount * BigInt(10_000 - slippageBps)) / 10_000n;
    return { platform: "fourmeme", chain: "bsc", chainId: 56, from, to: getAddress(tokenManager), value: amountMsgValue.toString(), data: manager.encodeFunctionData("buyTokenAMAP", [token, funds, minAmount]), tokenAddress: token, fundsWei: funds.toString(), minAmount: minAmount.toString() };
  }
}
