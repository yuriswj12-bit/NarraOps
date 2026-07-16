import BN from "bn.js";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, newBondingCurve } from "@pump-fun/pump-sdk";
import { ExecutionError } from "./errors.js";

const WRAPPED_SOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEFAULT_METADATA_UPLOAD_URL = "https://pump.fun/api/ipfs";

export class PumpLaunchAdapter {
  constructor({ connection, onlineSdk = connection ? new OnlinePumpSdk(connection) : null, offlineSdk = PUMP_SDK, fetchImpl = fetch, metadataUploadUrl = DEFAULT_METADATA_UPLOAD_URL } = {}) {
    this.connection = connection;
    this.onlineSdk = onlineSdk;
    this.offlineSdk = offlineSdk;
    this.fetchImpl = fetchImpl;
    this.metadataUploadUrl = metadataUploadUrl;
  }

  async uploadMetadata({ image, imageName = "cooking.png", imageType = "image/png", name, symbol, description = "", twitter = "", telegram = "", website = "" }) {
    if (!image || !name || !symbol) throw new ExecutionError("INVALID_LAUNCH_METADATA", "Pump metadata upload requires image, name, and symbol");
    const form = new FormData();
    form.append("file", new Blob([image], { type: imageType }), imageName);
    form.append("name", name);
    form.append("symbol", symbol);
    form.append("description", description);
    form.append("twitter", twitter);
    form.append("telegram", telegram);
    form.append("website", website);
    form.append("showName", "true");
    const response = await this.fetchImpl(this.metadataUploadUrl, { method: "POST", body: form });
    if (!response.ok) throw new ExecutionError("PUMP_METADATA_UPLOAD_FAILED", `Pump metadata upload returned HTTP ${response.status}`);
    const result = await response.json();
    const metadataUri = result?.metadataUri || result?.metadata_uri;
    if (typeof metadataUri !== "string" || !metadataUri.trim()) throw new ExecutionError("PUMP_METADATA_UPLOAD_INVALID", "Pump metadata upload did not return metadataUri");
    return metadataUri.trim();
  }

  async buildLaunch({ userAddress, creatorAddress = userAddress, name, symbol, metadataUri, metadata, developerBuyLamports = "0" }) {
    if (!this.connection) throw new ExecutionError("SOLANA_RPC_REQUIRED", "Solana connection is required");
    const resolvedMetadataUri = metadataUri || await this.uploadMetadata({ ...metadata, name, symbol });
    if (!name || !symbol || !resolvedMetadataUri) throw new ExecutionError("INVALID_LAUNCH_METADATA", "Pump launch requires name, symbol, and metadata URI");
    const user = new PublicKey(userAddress);
    const creator = new PublicKey(creatorAddress);
    const mint = Keypair.generate();
    const buyLamports = BigInt(developerBuyLamports);
    let instructions;
    if (buyLamports > 0n) {
      const [global, feeConfig] = await Promise.all([this.onlineSdk.fetchGlobal(), this.onlineSdk.fetchFeeConfig()]);
      const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: newBondingCurve(global, WRAPPED_SOL), amount: new BN(buyLamports.toString()), quoteMint: WRAPPED_SOL });
      instructions = await this.offlineSdk.createV2AndBuyInstructions({ global, mint: mint.publicKey, name, symbol, uri: resolvedMetadataUri, creator, user, amount, solAmount: new BN(buyLamports.toString()), mayhemMode: false, cashback: false });
    } else {
      instructions = [await this.offlineSdk.createV2Instruction({ mint: mint.publicKey, name, symbol, uri: resolvedMetadataUri, creator, user, mayhemMode: false, cashback: false })];
    }
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: user, recentBlockhash: blockhash }).add(...instructions);
    transaction.partialSign(mint);
    return { platform: "pump", chain: "solana", mintAddress: mint.publicKey.toBase58(), metadataUri: resolvedMetadataUri, transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight, developerBuyLamports: buyLamports.toString(), requiresWalletSignature: true };
  }
}

export { DEFAULT_METADATA_UPLOAD_URL as PUMP_METADATA_UPLOAD_URL };
