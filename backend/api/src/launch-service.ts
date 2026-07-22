// @ts-nocheck
import { Connection } from "@solana/web3.js";
import { parseUnits } from "ethers";
import { EvmJsonRpcClient, FourMemeLaunchAdapter, PumpLaunchAdapter } from "../../execution/index.ts";

function decodeImage(value) {
  const normalized = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  return Buffer.from(normalized, "base64");
}

export class LaunchPlanningService {
  constructor({ solanaRpcUrl, bscRpcUrl, pumpMetadataUploadUrl, pinataJwt, pinataGatewayUrl, fetchImpl = fetch } = {}) {
    this.pump = new PumpLaunchAdapter({
      connection: new Connection(solanaRpcUrl, "confirmed"),
      fetchImpl,
      metadataUploadUrl: pumpMetadataUploadUrl,
      pinataJwt,
      pinataGatewayUrl,
    });
    this.fourmeme = new FourMemeLaunchAdapter({
      fetchImpl,
      rpcClient: new EvmJsonRpcClient({ rpcUrl: bscRpcUrl, fetchImpl }),
    });
  }

  requestFourMemeLogin(input) {
    return this.fourmeme.requestLogin(input.address);
  }

  async plan(input) {
    const image = input.imageBase64 ? decodeImage(input.imageBase64) : null;
    if (input.platform === "pump") {
      return this.pump.buildLaunch({
        userAddress: input.walletAddress,
        name: input.name,
        symbol: input.symbol,
        developerBuyLamports: parseUnits(input.developerBuyAmount, 9).toString(),
        metadataUri: input.metadataUri,
        metadata: image ? {
          image,
          imageName: input.imageName,
          imageType: input.imageType,
          description: input.description,
          twitter: input.twitter,
          telegram: input.telegram,
          website: input.website,
        } : undefined,
      });
    }
    if (!image) throw new Error("Four.Meme launch requires imageBase64");
    return this.fourmeme.buildLaunch({
      address: input.walletAddress,
      loginSignature: input.loginSignature,
      image,
      imageName: input.imageName,
      name: input.name,
      symbol: input.symbol,
      description: input.description,
      twitter: input.twitter,
      telegram: input.telegram,
      website: input.website,
      developerBuyWei: parseUnits(input.developerBuyAmount, 18).toString(),
    });
  }
}
