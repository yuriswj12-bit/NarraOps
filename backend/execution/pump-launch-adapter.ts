// @ts-nocheck
import BN from "bn.js";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount, newBondingCurve } from "@pump-fun/pump-sdk";
import { ExecutionError } from "./errors.ts";

const WRAPPED_SOL = new PublicKey("So11111111111111111111111111111111111111112");
const DEFAULT_METADATA_UPLOAD_URL = "https://pump.fun/api/ipfs";

export class PumpLaunchAdapter {
  constructor({ connection, onlineSdk = connection ? new OnlinePumpSdk(connection) : null, offlineSdk = PUMP_SDK, fetchImpl = fetch, metadataUploadUrl = DEFAULT_METADATA_UPLOAD_URL, pinataJwt, pinataGatewayUrl = "https://gateway.pinata.cloud/ipfs" } = {}) {
    this.connection = connection;
    this.onlineSdk = onlineSdk;
    this.offlineSdk = offlineSdk;
    this.fetchImpl = fetchImpl;
    this.metadataUploadUrl = metadataUploadUrl;
    this.pinataJwt = pinataJwt;
    this.pinataGatewayUrl = pinataGatewayUrl.replace(/\/+$/, "");
  }

  async uploadMetadata({ image, imageName = "cooking.png", imageType = "image/png", name, symbol, description = "", twitter = "", telegram = "", website = "" }) {
    if (!image || !name || !symbol) throw new ExecutionError("INVALID_LAUNCH_METADATA", "Pump metadata upload requires image, name, and symbol");
    if (this.pinataJwt) return this.uploadMetadataToPinata({ image, imageName, imageType, name, symbol, description, twitter, telegram, website });
    throw new ExecutionError("IPFS_PINNING_NOT_CONFIGURED", "Pump launch requires IPFS metadata pinning. Configure PINATA_JWT or provide metadataUri.");
    const form = new FormData();
    form.append("file", new Blob([image], { type: imageType }), imageName);
    form.append("name", name);
    form.append("symbol", symbol);
    form.append("description", description);
    form.append("twitter", twitter);
    form.append("telegram", telegram);
    form.append("website", website);
    form.append("showName", "true");
    let response;
    try {
      response = await this.fetchImpl(this.metadataUploadUrl, { method: "POST", body: form });
    } catch (error) {
      throw new ExecutionError("PUMP_METADATA_UPLOAD_FAILED", `Pump metadata upload failed: ${error.cause?.code || error.message}`, { cause: error.cause?.code || error.name });
    }
    if (!response.ok) throw new ExecutionError("PUMP_METADATA_UPLOAD_FAILED", `Pump metadata upload returned HTTP ${response.status}`);
    const result = await response.json();
    const metadataUri = result?.metadataUri || result?.metadata_uri;
    if (typeof metadataUri !== "string" || !metadataUri.trim()) throw new ExecutionError("PUMP_METADATA_UPLOAD_INVALID", "Pump metadata upload did not return metadataUri");
    return metadataUri.trim();
  }

  async uploadMetadataToPinata({ image, imageName, imageType, name, symbol, description, twitter, telegram, website }) {
    const fileForm = new FormData();
    fileForm.append("file", new Blob([image], { type: imageType }), imageName);
    const authHeaders = { Authorization: `Bearer ${this.pinataJwt}` };
    let fileResponse;
    try {
      fileResponse = await this.fetchImpl("https://api.pinata.cloud/pinning/pinFileToIPFS", { method: "POST", headers: authHeaders, body: fileForm });
    } catch (error) {
      throw new ExecutionError("IPFS_IMAGE_UPLOAD_FAILED", `IPFS image upload failed: ${error.cause?.code || error.message}`, { cause: error.cause?.code || error.name });
    }
    if (!fileResponse.ok) throw new ExecutionError("IPFS_IMAGE_UPLOAD_FAILED", `IPFS image upload returned HTTP ${fileResponse.status}`);
    const fileResult = await fileResponse.json();
    const imageHash = fileResult?.IpfsHash;
    if (!imageHash) throw new ExecutionError("IPFS_IMAGE_UPLOAD_INVALID", "IPFS image upload did not return IpfsHash");
    const imageUri = `${this.pinataGatewayUrl}/${imageHash}`;
    const metadata = {
      name,
      symbol,
      description,
      image: imageUri,
      showName: true,
      createdOn: "https://pump.fun",
      twitter,
      telegram,
      website,
    };
    let metadataResponse;
    try {
      metadataResponse = await this.fetchImpl("https://api.pinata.cloud/pinning/pinJSONToIPFS", { method: "POST", headers: { ...authHeaders, "Content-Type": "application/json" }, body: JSON.stringify({ pinataContent: metadata, pinataMetadata: { name: `${symbol || name}-metadata.json` } }) });
    } catch (error) {
      throw new ExecutionError("IPFS_METADATA_UPLOAD_FAILED", `IPFS metadata upload failed: ${error.cause?.code || error.message}`, { cause: error.cause?.code || error.name });
    }
    if (!metadataResponse.ok) throw new ExecutionError("IPFS_METADATA_UPLOAD_FAILED", `IPFS metadata upload returned HTTP ${metadataResponse.status}`);
    const metadataResult = await metadataResponse.json();
    const metadataHash = metadataResult?.IpfsHash;
    if (!metadataHash) throw new ExecutionError("IPFS_METADATA_UPLOAD_INVALID", "IPFS metadata upload did not return IpfsHash");
    return `${this.pinataGatewayUrl}/${metadataHash}`;
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
