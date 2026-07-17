import { Interface, getAddress } from "ethers";
import { ExecutionError } from "./errors.js";

const API_BASE = "https://four.meme/meme-api/v1";
export const FOURMEME_TOKEN_MANAGER2 = "0x5c952063c7fc8610FFDB798152D69F0B9550762b";
const managerInterface = new Interface(["function createToken(bytes args,bytes signature) payable", "function _launchFee() view returns(uint256)", "function _tradingFeeRate() view returns(uint256)"]);
function assertApi(data, label) {
  if (data?.code !== "0" && data?.code !== 0) throw new ExecutionError("FOURMEME_API_ERROR", `${label} failed`, { platformCode: data?.code });
  return data.data;
}

export class FourMemeLaunchAdapter {
  constructor({ fetchImpl = fetch, rpcClient, apiBase = API_BASE } = {}) { this.fetchImpl = fetchImpl; this.rpcClient = rpcClient; this.apiBase = apiBase; }
  async json(path, options = {}) {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, options);
    if (!response.ok) throw new ExecutionError("FOURMEME_UNAVAILABLE", `Four.Meme returned HTTP ${response.status}`);
    return response.json();
  }
  async requestLogin(address) {
    const accountAddress = getAddress(address);
    const nonce = assertApi(await this.json("/private/user/nonce/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountAddress, verifyType: "LOGIN", networkCode: "BSC" }) }), "Nonce");
    return { address: accountAddress, nonce, message: `You are sign in Meme ${nonce}` };
  }
  async login({ address, signature }) {
    return assertApi(await this.json("/private/user/login/dex", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ region: "WEB", langType: "EN", loginIp: "", inviteCode: "", verifyInfo: { address: getAddress(address), networkCode: "BSC", signature, verifyType: "LOGIN" }, walletName: "MetaMask" }) }), "Login");
  }
  async buildLaunch({ address, loginSignature, image, imageName = "cooking.png", name, symbol, description, website = "", twitter = "", telegram = "", developerBuyWei = "0" }) {
    const accessToken = await this.login({ address, signature: loginSignature });
    const form = new FormData(); form.append("file", new Blob([image]), imageName);
    const imgUrl = assertApi(await this.json("/private/token/upload", { method: "POST", headers: { "meme-web-access": accessToken }, body: form }), "Image upload");
    const configs = assertApi(await this.json("/public/config"), "Public config");
    const raisedToken = configs.find((item) => item.symbol === "BNB" && item.status === "PUBLISH") || configs.find((item) => item.status === "PUBLISH");
    if (!raisedToken) throw new ExecutionError("FOURMEME_CONFIG_INVALID", "No published Four.Meme quote token is available");
    const body = { name, shortName: symbol, desc: description, totalSupply: Number(raisedToken.totalAmount ?? 1_000_000_000), raisedAmount: Number(raisedToken.totalBAmount ?? 24), saleRate: Number(raisedToken.saleRate ?? 0.8), reserveRate: 0, imgUrl, raisedToken, launchTime: Date.now(), funGroup: false, label: "Meme", lpTradingFee: 0.0025, preSale: (Number(BigInt(developerBuyWei)) / 1e18).toString(), clickFun: false, symbol: raisedToken.symbol, dexType: "PANCAKE_SWAP", rushMode: false, onlyMPC: false, feePlan: false, ...(website ? { webUrl: website } : {}), ...(twitter ? { twitterUrl: twitter } : {}), ...(telegram ? { telegramUrl: telegram } : {}) };
    const created = assertApi(await this.json("/private/token/create", { method: "POST", headers: { "meme-web-access": accessToken, "content-type": "application/json" }, body: JSON.stringify(body) }), "Create token");
    const launchFeeRaw = await this.rpcClient.request("eth_call", [{ to: FOURMEME_TOKEN_MANAGER2, data: managerInterface.encodeFunctionData("_launchFee") }, "latest"]);
    const launchFee = BigInt(managerInterface.decodeFunctionResult("_launchFee", launchFeeRaw)[0]);
    const developerBuy = BigInt(developerBuyWei); let value = launchFee + developerBuy;
    if (developerBuy > 0n && raisedToken.symbol === "BNB") {
      const rateRaw = await this.rpcClient.request("eth_call", [{ to: FOURMEME_TOKEN_MANAGER2, data: managerInterface.encodeFunctionData("_tradingFeeRate") }, "latest"]);
      value += (developerBuy * BigInt(managerInterface.decodeFunctionResult("_tradingFeeRate", rateRaw)[0])) / 10_000n;
    }
    return { platform: "fourmeme", chain: "bsc", chainId: 56, from: getAddress(address), to: FOURMEME_TOKEN_MANAGER2, value: value.toString(), data: managerInterface.encodeFunctionData("createToken", [created.createArg, created.signature]), requiresWalletSignature: true };
  }
}
