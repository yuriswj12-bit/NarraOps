var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/api/src/launch-service.ts
var launch_service_exports = {};
__export(launch_service_exports, {
  LaunchPlanningService: () => LaunchPlanningService
});
module.exports = __toCommonJS(launch_service_exports);
var import_web36 = require("@solana/web3.js");
var import_ethers9 = require("ethers");

// backend/execution/errors.ts
var ExecutionError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.details = details;
  }
};

// shared/constants/execution.ts
var EXECUTION_OPERATIONS = Object.freeze([
  "token.launch",
  "transfer.distribute",
  "transfer.multi",
  "trade.batchBuy",
  "trade.batchSell",
  "token.collect",
  "token.burn",
  "liquidity.lock"
]);
var EXECUTION_STATUSES = Object.freeze([
  "planned",
  "signing",
  "submitted",
  "confirmed",
  "partially_failed",
  "failed",
  "timed_out"
]);
var EXECUTION_CHAINS = Object.freeze(["solana", "bsc", "base"]);
var AMOUNT_MODES = Object.freeze(["fixed", "random", "percentage", "per_wallet"]);

// backend/execution/pons-follow-buy-service.ts
var ZERO_TOPIC = `0x${"0".repeat(64)}`;

// backend/execution/wallet-provisioning-service.ts
var import_ethers = require("ethers");
var import_web3 = require("@solana/web3.js");

// backend/execution/wallet-export-service.ts
var import_bs58 = __toESM(require("bs58"), 1);

// backend/execution/evm-transaction-adapter.ts
var import_ethers2 = require("ethers");
var EvmJsonRpcClient = class {
  constructor({ rpcUrl, fetchImpl = fetch }) {
    this.rpcUrl = rpcUrl;
    this.fetchImpl = fetchImpl;
    this.nextId = 1;
  }
  async request(method, params = []) {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params })
    });
    if (!response.ok) throw new ExecutionError("RPC_UNAVAILABLE", `EVM RPC returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new ExecutionError("RPC_ERROR", payload.error.message || "EVM RPC error", { rpcCode: payload.error.code });
    return payload.result;
  }
};

// backend/execution/solana-transaction-adapter.ts
var import_web32 = require("@solana/web3.js");

// backend/execution/launch-signing-service.ts
var import_ethers3 = require("ethers");

// backend/execution/platform-follow-buy-planners.ts
var import_bn = __toESM(require("bn.js"), 1);
var import_ethers4 = require("ethers");
var import_web33 = require("@solana/web3.js");
var pumpSdkModule = __toESM(require("@pump-fun/pump-sdk"), 1);
var pumpSdk = pumpSdkModule.default ?? pumpSdkModule;
var { getBuyTokenAmountFromSolAmount } = pumpSdk;
var WRAPPED_SOL = new import_web33.PublicKey("So11111111111111111111111111111111111111112");
var helper = new import_ethers4.Interface(["function tryBuy(address token,uint256 amount,uint256 funds) view returns(address tokenManager,address quote,uint256 estimatedAmount,uint256 estimatedCost,uint256 estimatedFee,uint256 amountMsgValue,uint256 amountApproval,uint256 amountFunds)"]);
var manager = new import_ethers4.Interface(["function buyTokenAMAP(address token,uint256 funds,uint256 minAmount) payable"]);

// backend/execution/launch-confirmation-provider.ts
var import_ethers5 = require("ethers");
var tokenCreate = new import_ethers5.Interface(["event TokenCreate(address creator,address token,uint256 requestId,string name,string symbol,uint256 totalSupply,uint256 launchTime,uint256 launchFee)"]);

// backend/execution/pons-uniswap-v3-quote-provider.ts
var import_ethers6 = require("ethers");
var ROBINHOOD_UNISWAP_V3 = Object.freeze({
  factory: "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA",
  quoterV2: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
  swapRouter02: "0xCaf681a66D020601342297493863E78C959E5cb2"
});
var tokenInterface = new import_ethers6.Interface([
  "function liquidityPool() view returns (address)",
  "function pairToken() view returns (address)",
  "function poolFee() view returns (uint24)",
  "function maxTxAmount() view returns (uint256)",
  "function maxWalletAmount() view returns (uint256)"
]);
var factoryInterface = new import_ethers6.Interface(["function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)"]);
var quoterInterface = new import_ethers6.Interface([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)"
]);
var routerInterface = new import_ethers6.Interface([
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
]);

// backend/execution/pump-launch-adapter.ts
var import_bn2 = __toESM(require("bn.js"), 1);
var import_web34 = require("@solana/web3.js");
var pumpSdkModule2 = __toESM(require("@pump-fun/pump-sdk"), 1);
var pumpSdk2 = pumpSdkModule2.default ?? pumpSdkModule2;
var { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount: getBuyTokenAmountFromSolAmount2, newBondingCurve } = pumpSdk2;
var WRAPPED_SOL2 = new import_web34.PublicKey("So11111111111111111111111111111111111111112");
var DEFAULT_METADATA_UPLOAD_URL = "https://pump.fun/api/ipfs";
var PumpLaunchAdapter = class {
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
      website
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
    const user = new import_web34.PublicKey(userAddress);
    const creator = new import_web34.PublicKey(creatorAddress);
    const mint = import_web34.Keypair.generate();
    const buyLamports = BigInt(developerBuyLamports);
    let instructions;
    if (buyLamports > 0n) {
      const [global, feeConfig] = await Promise.all([this.onlineSdk.fetchGlobal(), this.onlineSdk.fetchFeeConfig()]);
      const amount = getBuyTokenAmountFromSolAmount2({ global, feeConfig, mintSupply: null, bondingCurve: newBondingCurve(global, WRAPPED_SOL2), amount: new import_bn2.default(buyLamports.toString()), quoteMint: WRAPPED_SOL2 });
      instructions = await this.offlineSdk.createV2AndBuyInstructions({ global, mint: mint.publicKey, name, symbol, uri: resolvedMetadataUri, creator, user, amount, solAmount: new import_bn2.default(buyLamports.toString()), mayhemMode: false, cashback: false });
    } else {
      instructions = [await this.offlineSdk.createV2Instruction({ mint: mint.publicKey, name, symbol, uri: resolvedMetadataUri, creator, user, mayhemMode: false, cashback: false })];
    }
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new import_web34.Transaction({ feePayer: user, recentBlockhash: blockhash }).add(...instructions);
    transaction.partialSign(mint);
    return { platform: "pump", chain: "solana", mintAddress: mint.publicKey.toBase58(), metadataUri: resolvedMetadataUri, transactionBase64: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), lastValidBlockHeight, developerBuyLamports: buyLamports.toString(), requiresWalletSignature: true };
  }
};

// backend/execution/fourmeme-launch-adapter.ts
var import_ethers7 = require("ethers");
var API_BASE = "https://four.meme/meme-api/v1";
var FOURMEME_TOKEN_MANAGER2 = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";
var managerInterface = new import_ethers7.Interface(["function createToken(bytes args,bytes signature) payable", "function _launchFee() view returns(uint256)", "function _tradingFeeRate() view returns(uint256)"]);
function assertApi(data, label) {
  if (data?.code !== "0" && data?.code !== 0) throw new ExecutionError("FOURMEME_API_ERROR", `${label} failed`, { platformCode: data?.code });
  return data.data;
}
var FourMemeLaunchAdapter = class {
  constructor({ fetchImpl = fetch, rpcClient, apiBase = API_BASE } = {}) {
    this.fetchImpl = fetchImpl;
    this.rpcClient = rpcClient;
    this.apiBase = apiBase;
  }
  async json(path, options = {}) {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, options);
    if (!response.ok) throw new ExecutionError("FOURMEME_UNAVAILABLE", `Four.Meme returned HTTP ${response.status}`);
    return response.json();
  }
  async requestLogin(address) {
    const accountAddress = (0, import_ethers7.getAddress)(address);
    const nonce = assertApi(await this.json("/private/user/nonce/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountAddress, verifyType: "LOGIN", networkCode: "BSC" }) }), "Nonce");
    return { address: accountAddress, nonce, message: `You are sign in Meme ${nonce}` };
  }
  async login({ address, signature }) {
    return assertApi(await this.json("/private/user/login/dex", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ region: "WEB", langType: "EN", loginIp: "", inviteCode: "", verifyInfo: { address: (0, import_ethers7.getAddress)(address), networkCode: "BSC", signature, verifyType: "LOGIN" }, walletName: "MetaMask" }) }), "Login");
  }
  async buildLaunch({ address, loginSignature, image, imageName = "cooking.png", name, symbol, description, website = "", twitter = "", telegram = "", developerBuyWei = "0" }) {
    const accessToken = await this.login({ address, signature: loginSignature });
    const form = new FormData();
    form.append("file", new Blob([image]), imageName);
    const imgUrl = assertApi(await this.json("/private/token/upload", { method: "POST", headers: { "meme-web-access": accessToken }, body: form }), "Image upload");
    const configs = assertApi(await this.json("/public/config"), "Public config");
    const raisedToken = configs.find((item) => item.symbol === "BNB" && item.status === "PUBLISH") || configs.find((item) => item.status === "PUBLISH");
    if (!raisedToken) throw new ExecutionError("FOURMEME_CONFIG_INVALID", "No published Four.Meme quote token is available");
    const body = { name, shortName: symbol, desc: description, totalSupply: Number(raisedToken.totalAmount ?? 1e9), raisedAmount: Number(raisedToken.totalBAmount ?? 24), saleRate: Number(raisedToken.saleRate ?? 0.8), reserveRate: 0, imgUrl, raisedToken, launchTime: Date.now(), funGroup: false, label: "Meme", lpTradingFee: 25e-4, preSale: (Number(BigInt(developerBuyWei)) / 1e18).toString(), clickFun: false, symbol: raisedToken.symbol, dexType: "PANCAKE_SWAP", rushMode: false, onlyMPC: false, feePlan: false, ...website ? { webUrl: website } : {}, ...twitter ? { twitterUrl: twitter } : {}, ...telegram ? { telegramUrl: telegram } : {} };
    const created = assertApi(await this.json("/private/token/create", { method: "POST", headers: { "meme-web-access": accessToken, "content-type": "application/json" }, body: JSON.stringify(body) }), "Create token");
    const launchFeeRaw = await this.rpcClient.request("eth_call", [{ to: FOURMEME_TOKEN_MANAGER2, data: managerInterface.encodeFunctionData("_launchFee") }, "latest"]);
    const launchFee = BigInt(managerInterface.decodeFunctionResult("_launchFee", launchFeeRaw)[0]);
    const developerBuy = BigInt(developerBuyWei);
    let value = launchFee + developerBuy;
    if (developerBuy > 0n && raisedToken.symbol === "BNB") {
      const rateRaw = await this.rpcClient.request("eth_call", [{ to: FOURMEME_TOKEN_MANAGER2, data: managerInterface.encodeFunctionData("_tradingFeeRate") }, "latest"]);
      value += developerBuy * BigInt(managerInterface.decodeFunctionResult("_tradingFeeRate", rateRaw)[0]) / 10000n;
    }
    return { platform: "fourmeme", chain: "bsc", chainId: 56, from: (0, import_ethers7.getAddress)(address), to: FOURMEME_TOKEN_MANAGER2, value: value.toString(), data: managerInterface.encodeFunctionData("createToken", [created.createArg, created.signature]), requiresWalletSignature: true };
  }
};

// backend/execution/native-asset-service.ts
var import_web35 = require("@solana/web3.js");
var import_ethers8 = require("ethers");

// backend/api/src/launch-service.ts
function decodeImage(value) {
  const normalized = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  return Buffer.from(normalized, "base64");
}
var LaunchPlanningService = class {
  constructor({ solanaRpcUrl, bscRpcUrl, pumpMetadataUploadUrl, pinataJwt, pinataGatewayUrl, fetchImpl = fetch } = {}) {
    this.pump = new PumpLaunchAdapter({
      connection: new import_web36.Connection(solanaRpcUrl, "confirmed"),
      fetchImpl,
      metadataUploadUrl: pumpMetadataUploadUrl,
      pinataJwt,
      pinataGatewayUrl
    });
    this.fourmeme = new FourMemeLaunchAdapter({
      fetchImpl,
      rpcClient: new EvmJsonRpcClient({ rpcUrl: bscRpcUrl, fetchImpl })
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
        developerBuyLamports: (0, import_ethers9.parseUnits)(input.developerBuyAmount, 9).toString(),
        metadataUri: input.metadataUri,
        metadata: image ? {
          image,
          imageName: input.imageName,
          imageType: input.imageType,
          description: input.description,
          twitter: input.twitter,
          telegram: input.telegram,
          website: input.website
        } : void 0
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
      developerBuyWei: (0, import_ethers9.parseUnits)(input.developerBuyAmount, 18).toString()
    });
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  LaunchPlanningService
});
