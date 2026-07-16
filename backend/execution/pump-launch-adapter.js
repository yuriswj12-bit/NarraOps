import BN from "bn.js";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, newBondingCurve } from "@pump-fun/pump-sdk";
import { ExecutionError } from "./errors.js";

const WRAPPED_SOL = new PublicKey("So11111111111111111111111111111111111111112");

export class PumpLaunchAdapter {
  constructor({ connection, onlineSdk = connection ? new OnlinePumpSdk(connection) : null, offlineSdk = PUMP_SDK } = {}) {
    this.connection = connection;
    this.onlineSdk = onlineSdk;
    this.offlineSdk = offlineSdk;
  }

  async buildLaunch({ userAddress, creatorAddress = userAddress, name, symbol, metadataUri, developerBuyLamports = "0" }) {
    if (!this.connection) throw new ExecutionError("SOLANA_RPC_REQUIRED", "Solana connection is required");
    if (!name || !symbol || !metadataUri) throw new ExecutionError("INVALID_LAUNCH_METADATA", "Pump launch requires name, symbol, and metadata URI");
    const user = new PublicKey(userAddress);
    const creator = new PublicKey(creatorAddress);
    const mint = Keypair.generate();
    const buyLamports = BigInt(developerBuyLamports);
    let instructions;
    if (buyLamports > 0n) {
      const [global, feeConfig] = await Promise.all([this.onlineSdk.fetchGlobal(), this.onlineSdk.fetchFeeConfig()]);
      const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: newBondingCurve(global, WRAPPED_SOL), amount: new BN(buyLamports.toString()), quoteMint: WRAPPED_SOL });
      instructions = await this.offlineSdk.createV2AndBuyInstructions({ global, mint: mint.publicKey, name, symbol, uri: metadataUri, creator, user, amount, solAmount: new BN(buyLamports.toString()), mayhemMode: false, cashback: false });
    } else {
      instructions = [await this.offlineSdk.createV2Instruction({ mint: mint.publicKey, name, symbol, uri: metadataUri, creator, user, mayhemMode: false, cashback: false })];
    }
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: user, recentBlockhash: blockhash }).add(...instructions);
    transaction.partialSign(mint);
    return { platform: "pump", chain: "solana", mintAddress: mint.publicKey.toBase58(), transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight, developerBuyLamports: buyLamports.toString(), requiresWalletSignature: true };
  }
}
