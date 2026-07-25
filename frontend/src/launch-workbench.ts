/**
 * Internal launch workbench helpers.
 * Not a first-level product navigation surface (Go / Pulse / Assets).
 * Kept isolated so launch adapters do not leak into primary app routing.
 */
export type LaunchWorkbenchDeps = {
  getState: () => any;
  t: (zh: string, en: string) => string;
  apiRequest: (path: string, init?: any) => Promise<any>;
  showToast: (message: string) => void;
  escapeHtml: (value: any) => string;
  pageHeading: (kicker: string, title: string, subtitle?: string, extra?: string) => string;
  viewRoot: HTMLElement;
};

export function createLaunchWorkbench(deps: LaunchWorkbenchDeps) {
  const { getState, t, apiRequest, showToast, escapeHtml, pageHeading, viewRoot } = deps;

const ROBINHOOD_CHAIN = Object.freeze({
  chainId: "0x1237",
  chainName: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
  blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
});

const PONS_FACTORY = "0x0c37a24f5d23a486fa692d1500881d698b1f77a4";
const PONS_LAUNCH_FEE_WEI = 500000000000000n;
const PONS_LAUNCH_SELECTOR = "686399cb";

function abiWord(value) {
  return BigInt(value).toString(16).padStart(64, "0");
}

function abiAddress(value) {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function abiString(value) {
  const bytes = new TextEncoder().encode(value);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${abiWord(bytes.length)}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
}

function abiStringTuple(values) {
  let offset = values.length * 32;
  const tails = values.map(abiString);
  const heads = tails.map((tail) => {
    const head = abiWord(offset);
    offset += tail.length / 2;
    return head;
  });
  return `${heads.join("")}${tails.join("")}`;
}

function encodePonsLaunch({ name, symbol, metadataUri, description, socials, creator, salt }) {
  const strings = [name, symbol, metadataUri, description].map(abiString);
  const socialTuple = abiStringTuple(socials);
  let offset = 6 * 32;
  const tupleHeads = strings.map((tail) => {
    const head = abiWord(offset);
    offset += tail.length / 2;
    return head;
  });
  tupleHeads.push(abiWord(offset));
  tupleHeads.push(abiAddress(creator));
  const tokenParams = `${tupleHeads.join("")}${strings.join("")}${socialTuple}`;
  return `0x${PONS_LAUNCH_SELECTOR}${abiWord(128)}${abiWord(0)}${abiWord(0)}${salt.replace(/^0x/, "")}${tokenParams}`;
}

function parseEthToWei(value) {
  const normalized = String(value || "0").trim();
  if (!/^\d+(\.\d{0,18})?$/.test(normalized)) throw new Error(t("ETH 金额格式无效。", "Invalid ETH amount."));
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, "0"));
}

function randomBytes32() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function submitPonsLaunch(form) {
  if (!getState().launchWallet.address) {
    await connectRobinhoodWallet();
    if (!getState().launchWallet.address) return;
  }
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const cookingGroup = getState().assets.groups.find((group) => group.groupId === values.cookingWalletGroup && isCookingGroup(group));
  if (!cookingGroup) {
    showToast(t("请选择一个只包含 1 个钱包的 Cooking 钱包组。", "Select a Cooking wallet group containing exactly one wallet."));
    return;
  }
  const boundBuyEnabled = Boolean(values.buyingWalletGroup);
  const randomBoundBuy = values.buyAllocationMode === "TOTAL_RANDOM";
  const buyingGroup = getState().assets.groups.find((group) => group.groupId === values.buyingWalletGroup && !isCookingGroup(group) && group.walletCount > 0);
  if (boundBuyEnabled && !buyingGroup) {
    showToast(t("请选择发射绑定买入的钱包组。", "Select the wallet group for launch-bound buying."));
    return;
  }
  const boundBuyInputAmount = randomBoundBuy ? values.boundBuyTotalAmount : values.boundBuyAmountPerWallet;
  if (boundBuyEnabled && !(Number(boundBuyInputAmount) > 0)) return showToast(t(randomBoundBuy ? "请输入大于 0 的钱包组买入总额。" : "请输入大于 0 的每钱包买入金额。", randomBoundBuy ? "Enter a wallet-group total greater than zero." : "Enter a per-wallet buy amount greater than zero."));
  if (!getState().launchMedia.file && !getState().launchMedia.metadataUri) {
    showToast(t("请先上传或生成 Cooking 图片。", "Upload or generate a Cooking image first."));
    return;
  }
  if (!getState().launchMedia.metadataUri) {
    showToast(t("图片已选择；配置 IPFS 固定服务后即可自动生成链上元数据。", "Image selected. Configure the IPFS pinning service to generate on-chain metadata automatically."));
    return;
  }
  const creator = getState().launchWallet.address;
  const developerBuyWei = parseEthToWei(values.cookingBuyAmount);
  const totalValue = PONS_LAUNCH_FEE_WEI + developerBuyWei;
  const data = encodePonsLaunch({
    name: values.tokenName.trim(),
    symbol: values.tokenSymbol.trim(),
    metadataUri: getState().launchMedia.metadataUri,
    description: `${values.tokenName.trim()} (${values.tokenSymbol.trim()})`,
    socials: [values.xUrl.trim(), values.telegramUrl.trim(), values.websiteUrl.trim(), "", ""],
    creator,
    salt: randomBytes32(),
  });
  const transaction = { from: getState().launchWallet.address, to: PONS_FACTORY, value: `0x${totalValue.toString(16)}`, data };
  try {
    const gas = await window.ethereum.request({ method: "eth_estimateGas", params: [transaction] });
    const confirmed = window.confirm(t(
      `即将通过 Pons 工厂发射 ${values.tokenSymbol}。Cooking 钱包首笔买入 ${values.cookingBuyAmount || "0"} ETH，发射费 0.0005 ETH。${boundBuyEnabled ? `${buyingGroup.name} 将在 T1-T5 窗口${randomBoundBuy ? `随机拆分总额 ${values.boundBuyTotalAmount || "0"}` : `以每钱包 ${values.boundBuyAmountPerWallet || "0"}`} ETH 执行买入。` : ""}预估发射 Gas ${Number.parseInt(gas, 16).toLocaleString()}。`,
      `Launch ${values.tokenSymbol} through the Pons factory. The Cooking wallet buys ${values.cookingBuyAmount || "0"} ETH first, plus the 0.0005 ETH launch fee. ${boundBuyEnabled ? `${buyingGroup.name} will ${randomBoundBuy ? `randomly split a total of ${values.boundBuyTotalAmount || "0"}` : `buy ${values.boundBuyAmountPerWallet || "0"} per wallet`} ETH during T1-T5. ` : ""}Estimated launch gas: ${Number.parseInt(gas, 16).toLocaleString()}.`,
    ));
    if (!confirmed) return;
    const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ ...transaction, gas }] });
    sessionStorage.setItem("narraops-last-launch-tx", hash);
    sessionStorage.setItem("narraops-bound-buy-plan", JSON.stringify({
      launchTransactionHash: hash,
      platform: getState().selectedPlatform,
      cookingWalletGroupId: cookingGroup.groupId,
      boundBuy: boundBuyEnabled ? { enabled: true, walletGroupId: buyingGroup.groupId, window: { earliestBlockOffset: 1, latestBlockOffset: 5 }, allocation: randomBoundBuy ? { mode: "TOTAL_RANDOM", totalAmount: values.boundBuyTotalAmount } : { mode: "PER_WALLET_EQUAL", amountPerWallet: values.boundBuyAmountPerWallet } } : { enabled: false },
      status: "awaiting_launch_confirmation",
    }));
    showToast(t(`发射交易已提交：${hash.slice(0, 12)}…`, `Launch transaction submitted: ${hash.slice(0, 12)}…`));
    window.open(`${ROBINHOOD_CHAIN.blockExplorerUrls[0]}/tx/${hash}`, "_blank", "noopener,noreferrer");
  } catch (error) {
    showToast(error.code === 4001 ? t("你取消了交易。", "Transaction cancelled.") : (error.message || t("发射交易失败。", "Launch transaction failed.")));
  }
}

async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function uploadPumpMetadataFromBrowser(values, file) {
  const formData = new FormData();
  formData.append("file", file, file.name || "cooking.png");
  formData.append("name", values.tokenName.trim());
  formData.append("symbol", values.tokenSymbol.trim());
  formData.append("description", `${values.tokenName.trim()} (${values.tokenSymbol.trim()})`);
  formData.append("twitter", values.xUrl.trim());
  formData.append("telegram", values.telegramUrl.trim());
  formData.append("website", values.websiteUrl.trim());
  formData.append("showName", "true");
  const response = await fetch("https://pump.fun/api/ipfs", { method: "POST", body: formData });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || body?.message || `Pump metadata upload returned HTTP ${response.status}`);
  const metadataUri = body?.metadataUri || body?.metadata_uri;
  if (!metadataUri) throw new Error("Pump metadata upload did not return metadataUri");
  return metadataUri;
}

async function submitInternalLaunch(form) {
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const cookingGroup = getState().assets.groups.find((group) => group.groupId === values.cookingWalletGroup && isCookingGroup(group));
  const boundBuyEnabled = Boolean(values.buyingWalletGroup);
  const randomBoundBuy = values.buyAllocationMode === "TOTAL_RANDOM";
  const buyingGroup = getState().assets.groups.find((group) => group.groupId === values.buyingWalletGroup && !isCookingGroup(group));
  if (!cookingGroup || (boundBuyEnabled && !buyingGroup)) return showToast(t("请选择 Cooking 钱包和发射绑定买入钱包组。", "Select a Cooking wallet and launch-bound-buy wallet group."));
  const boundBuyInputAmount = randomBoundBuy ? values.boundBuyTotalAmount : values.boundBuyAmountPerWallet;
  if (boundBuyEnabled && !(Number(boundBuyInputAmount) > 0)) return showToast(t(randomBoundBuy ? "请输入大于 0 的钱包组买入总额。" : "请输入大于 0 的每钱包买入金额。", randomBoundBuy ? "Enter a wallet-group total greater than zero." : "Enter a per-wallet buy amount greater than zero."));
  if (!getState().launchMedia.file) return showToast(t("请上传 Cooking 图片。", "Upload a Cooking image."));
  const platform = getState().selectedPlatform === "four" ? "fourmeme" : "pump";
  try {
    const launchPayload = {
      platform,
      cookingWalletGroupId: cookingGroup.groupId,
      boundBuy: boundBuyEnabled ? {
        enabled: true,
        walletGroupId: buyingGroup.groupId,
        allocation: randomBoundBuy ? { mode: "TOTAL_RANDOM", totalAmount: values.boundBuyTotalAmount || "0" } : { mode: "PER_WALLET_EQUAL", amountPerWallet: values.boundBuyAmountPerWallet || "0" },
        slippageBps: 500,
      } : { enabled: false },
      name: values.tokenName.trim(), symbol: values.tokenSymbol.trim(), description: `${values.tokenName.trim()} (${values.tokenSymbol.trim()})`,
      imageBase64: await fileToBase64(getState().launchMedia.file), imageName: getState().launchMedia.file.name, imageType: getState().launchMedia.file.type,
      twitter: values.xUrl.trim(), telegram: values.telegramUrl.trim(), website: values.websiteUrl.trim(), developerBuyAmount: values.cookingBuyAmount || "0",
    };
    let prepared;
    try {
      prepared = await apiRequest("/api/v1/launch/executions/prepare", { method: "POST", body: JSON.stringify(launchPayload) });
    } catch (prepareError) {
      if (platform !== "pump" || prepareError.code !== "PUMP_METADATA_UPLOAD_FAILED") throw prepareError;
      const metadataUri = await uploadPumpMetadataFromBrowser(values, getState().launchMedia.file);
      const { imageBase64, imageName, imageType, ...metadataPayload } = launchPayload;
      prepared = await apiRequest("/api/v1/launch/executions/prepare", { method: "POST", body: JSON.stringify({ ...metadataPayload, metadataUri }) });
    }
    const unit = getState().selectedPlatform === "pump" ? "SOL" : "BNB";
    const boundBuyTotal = boundBuyEnabled ? (randomBoundBuy ? Number(values.boundBuyTotalAmount).toFixed(6) : (Number(values.boundBuyAmountPerWallet) * buyingGroup.walletCount).toFixed(6)) : "0";
    const allocationPreview = prepared.summary?.preparedBoundBuys || [];
    const allocationLines = allocationPreview.map(({ walletId, amount }) => `${walletId}: ${amount} ${unit}`).join("\n");
    const approved = window.confirm(t(
      `确认使用 ${cookingGroup.name} 发射 ${values.tokenSymbol}，Cooking 首买 ${values.cookingBuyAmount || "0"} ${unit}${boundBuyEnabled ? `；${buyingGroup.name} 在 T1-T5 ${randomBoundBuy ? "随机买入" : "等额买入"}，总预算 ${boundBuyTotal} ${unit}${allocationLines ? `\n\n逐钱包预览：\n${allocationLines}` : ""}` : ""}。本次确认将执行这份已冻结的发射计划。`,
      `Confirm launching ${values.tokenSymbol} with ${cookingGroup.name} and a ${values.cookingBuyAmount || "0"} ${unit} Cooking buy.${boundBuyEnabled ? ` ${buyingGroup.name} uses ${randomBoundBuy ? "random" : "equal"} T1-T5 buys; total budget ${boundBuyTotal} ${unit}.${allocationLines ? `\n\nPer-wallet preview:\n${allocationLines}` : ""}` : ""}`,
    ));
    if (!approved) return;
    const result = await apiRequest(`/api/v1/launch/executions/${prepared.executionId}/confirm`, { method: "POST", body: JSON.stringify({ confirmationToken: prepared.confirmationToken }) });
    const launchResult = {
      ...result,
      platform,
      platformName: getState().selectedPlatform === "four" ? "Four.Meme" : "Pump.fun",
      tokenAddress: result.tokenAddress || result.mintAddress,
    };
    getState().launchResult = launchResult;
    sessionStorage.setItem("narraops-last-launch-result", JSON.stringify(launchResult));
    if (result.transactionHash) sessionStorage.setItem("narraops-last-launch-tx", result.transactionHash);
    renderLaunch();
    return;
    showToast(t(`发射交易已提交：${result.transactionHash.slice(0, 12)}…`, `Launch submitted: ${result.transactionHash.slice(0, 12)}…`));
  } catch (error) {
    showToast(error.message || t("发射失败。", "Launch failed."));
  }
}

function formatWeiBalance(value) {
  const wei = BigInt(value);
  const whole = wei / 10n ** 18n;
  const fraction = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 5).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function connectRobinhoodWallet() {
  if (!window.ethereum?.request) {
    getState().launchWallet.error = t("未检测到 EVM 钱包，请安装 MetaMask 或支持 EIP-1193 的钱包。", "No EVM wallet detected. Install MetaMask or another EIP-1193 wallet.");
    renderLaunch();
    return;
  }

  getState().launchWallet.connecting = true;
  getState().launchWallet.error = null;
  renderLaunch();
  try {
    const [address] = await window.ethereum.request({ method: "eth_requestAccounts" });
    let chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (chainId.toLowerCase() !== ROBINHOOD_CHAIN.chainId) {
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_CHAIN.chainId }] });
      } catch (error) {
        if (error.code !== 4902) throw error;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [ROBINHOOD_CHAIN] });
      }
      chainId = await window.ethereum.request({ method: "eth_chainId" });
    }
    const balance = await window.ethereum.request({ method: "eth_getBalance", params: [address, "latest"] });
    getState().launchWallet.address = address;
    getState().launchWallet.chainId = Number.parseInt(chainId, 16);
    getState().launchWallet.balance = formatWeiBalance(balance);
  } catch (error) {
    getState().launchWallet.error = error.code === 4001
      ? t("你取消了钱包授权或网络切换。", "Wallet access or network switching was cancelled.")
      : (error.message || t("钱包连接失败。", "Wallet connection failed."));
  } finally {
    getState().launchWallet.connecting = false;
    renderLaunch();
  }
}

function renderLaunchResultCard() {
  const result = getState().launchResult;
  if (!result) return "";
  const tokenAddress = result.tokenAddress || result.mintAddress || "";
  const transactionHash = result.transactionHash || result.txHash || "";
  const boundBuys = Array.isArray(result.boundBuys) ? result.boundBuys : [];
  const platformName = result.platformName || result.platform || "Launch";
  const status = result.status || "submitted";
  return `
    <section class="launch-result-panel">
      <div class="launch-result-header">
        <div>
          <span class="section-kicker">LAUNCH RESULT</span>
          <h3>${t("发射结果", "Launch result")}</h3>
        </div>
        <span class="simulation-pill">${escapeHtml(status)}</span>
      </div>
      <div class="launch-result-grid">
        <div>
          <small>${t("平台", "Platform")}</small>
          <strong>${escapeHtml(platformName)}</strong>
        </div>
        <div>
          <small>${t("Meme 合约 / Mint 地址", "Meme contract / mint address")}</small>
          <code>${escapeHtml(tokenAddress || "-")}</code>
          ${tokenAddress ? `<button class="compact-button" type="button" data-copy-address="${escapeHtml(tokenAddress)}"><i class="fa-regular fa-copy"></i>${t("复制", "Copy")}</button>` : ""}
        </div>
        <div>
          <small>${t("发射交易", "Launch transaction")}</small>
          <code>${escapeHtml(transactionHash || "-")}</code>
          ${transactionHash ? `<button class="compact-button" type="button" data-copy-address="${escapeHtml(transactionHash)}"><i class="fa-regular fa-copy"></i>${t("复制", "Copy")}</button>` : ""}
        </div>
        <div>
          <small>${t("T1-T5 买入", "T1-T5 buys")}</small>
          <strong>${boundBuys.length ? `${boundBuys.filter((buy) => buy.status !== "failed").length}/${boundBuys.length}` : t("未启用", "Disabled")}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderLaunch() {
  const platforms = [
    {
      id: "pump",
      icon: "fa-solid fa-capsules",
      name: "Pump.fun",
      chain: "Solana",
      unit: "SOL",
      descriptionZh: "Solana 公平发射平台",
      descriptionEn: "Solana fair-launch platform",
    },
    {
      id: "four",
      icon: "fa-solid fa-hand",
      name: "Four.Meme",
      chain: "BSC",
      unit: "BNB",
      descriptionZh: "BSC 联合曲线发射平台",
      descriptionEn: "BSC bonding-curve launch platform",
    },
    {
      id: "pons",
      icon: "fa-solid fa-gem",
      name: "Pons",
      chain: "Robinhood",
      unit: "ETH",
      descriptionZh: "Robinhood Chain 发射平台",
      descriptionEn: "Robinhood Chain launch platform",
    },
  ];

  const selected = platforms.find((platform) => platform.id === getState().selectedPlatform);
  const launchWallet = getState().launchWallet;
  const walletAddress = launchWallet.address
    ? `${launchWallet.address.slice(0, 7)}...${launchWallet.address.slice(-5)}`
    : t("未连接", "Not connected");
  const cookingGroups = getState().assets.groups.filter(isCookingGroup);
  const cookingOptions = cookingGroups.map((group) => `<option value="${group.groupId}">${escapeHtml(group.name)} · ${t("1 个钱包", "1 wallet")}</option>`).join("");
  const buyingGroups = getState().assets.groups.filter((group) => !isCookingGroup(group) && group.walletCount > 0);
  const buyingGroupOptions = buyingGroups.map((group) => `<option value="${group.groupId}">${escapeHtml(group.name)} · ${group.walletCount} ${t("个钱包", "wallets")}</option>`).join("");
  const media = getState().launchMedia;
  const platformCards = platforms.map((platform) => `
    <article class="launch-platform ${getState().selectedPlatform === platform.id ? "selected" : ""}">
      <div class="platform-topline">
        <span class="platform-icon"><i class="${platform.icon}" aria-hidden="true"></i></span>
        <span class="source-pill">${platform.chain}</span>
      </div>
      <div class="launch-platform-copy">
        <h3>${platform.name}</h3>
        <p>${t(platform.descriptionZh, platform.descriptionEn)}</p>
      </div>
      <button class="platform-button" type="button" data-platform="${platform.id}">${getState().selectedPlatform === platform.id ? t("已选择", "Selected") : t("选择平台", "Select platform")}</button>
    </article>
  `).join("");

  const launchForm = selected ? `
    <section class="launch-parameter-panel" aria-labelledby="launch-parameter-title">
      <header class="launch-parameter-header">
        <div>
          <span class="section-kicker">${selected.chain} · ${selected.name}</span>
          <h3 id="launch-parameter-title">${t("填写发射参数", "Launch parameters")}</h3>
        </div>
        <span class="simulation-pill"><i class="fa-solid fa-lock" aria-hidden="true"></i>${t("前端预览", "Frontend preview")}</span>
      </header>

      <form class="launch-parameter-form" id="launchParameterForm">
        ${selected.id === "pons" ? `<div class="launch-wallet-panel launch-field-wide">
          <div>
            <span class="section-kicker">${t("链上钱包", "On-chain wallet")}</span>
            <strong>${walletAddress}</strong>
            <small>${launchWallet.balance === null ? t("连接后读取 Robinhood Chain 余额", "Connect to read the Robinhood Chain balance") : `${launchWallet.balance} ETH · Chain ID ${launchWallet.chainId}`}</small>
            ${launchWallet.error ? `<small class="launch-wallet-error">${escapeHtml(launchWallet.error)}</small>` : ""}
          </div>
          <button class="secondary-button" type="button" data-launch-wallet="connect" ${launchWallet.connecting ? "disabled" : ""}>
            <i class="fa-solid fa-wallet" aria-hidden="true"></i>${launchWallet.connecting ? t("连接中…", "Connecting…") : launchWallet.address ? t("重新连接", "Reconnect") : t("连接钱包", "Connect wallet")}
          </button>
        </div>` : `<div class="launch-wallet-panel launch-field-wide"><div><span class="section-kicker">${t("加密 Cooking 钱包", "Encrypted Cooking wallet")}</span><strong>${t("从下方钱包组选择", "Select from the wallet group below")}</strong><small>${t("一次确认完成发射签名，不会逐钱包弹窗。", "One confirmation signs the launch without per-wallet prompts.")}</small></div><i class="fa-solid fa-shield-halved"></i></div>`}
        <section class="launch-image-field launch-field-wide" aria-label="${t("Cooking 图片", "Cooking image")}">
          <div class="launch-image-heading"><div><span>${t("Cooking 图片", "Cooking image")}</span><small>${t("支持上传、图库、文生图和 AI 生图", "Upload, library, text-to-image, or AI generation")}</small></div><strong>${t("必填", "Required")}</strong></div>
          <div class="launch-image-actions">
            <label class="launch-image-action launch-image-upload">
              <input id="launchImageInput" name="launchImage" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
              ${media.previewUrl ? `<img src="${media.previewUrl}" alt="${t("已选择的 Cooking 图片", "Selected Cooking image")}" />` : `<i class="fa-solid fa-plus" aria-hidden="true"></i><span>${t("上传", "Upload")}</span>`}
            </label>
            <div class="launch-image-secondary">
              <button type="button" data-launch-image="library"><i class="fa-regular fa-images"></i>${t("图库", "Library")}</button>
              <button type="button" data-launch-image="text"><i class="fa-solid fa-pen-ruler"></i>${t("文生图", "Text to image")}</button>
            </div>
            <button class="launch-image-action launch-image-ai" type="button" data-launch-image="ai"><i class="fa-solid fa-wand-magic-sparkles"></i><span>AI</span></button>
          </div>
        </section>
        <label class="launch-field">
          <span>${t("名称", "Name")}</span>
          <input class="field-input" name="tokenName" maxlength="20" required placeholder="${t("填写代币名称", "Token name")}" />
        </label>
        <label class="launch-field">
          <span>${t("符号", "Symbol")}</span>
          <input class="field-input" name="tokenSymbol" maxlength="20" required placeholder="${t("例如 PEPE", "For example PEPE")}" />
        </label>
        <label class="launch-field">
          <span>X</span>
          <input class="field-input" name="xUrl" type="url" placeholder="https://x.com/..." />
        </label>
        <label class="launch-field">
          <span>${t("官网", "Website")}</span>
          <input class="field-input" name="websiteUrl" type="url" placeholder="https://..." />
        </label>
        <label class="launch-field">
          <span>Telegram</span>
          <input class="field-input" name="telegramUrl" type="url" placeholder="https://t.me/..." />
        </label>
        <label class="launch-field">
          <span>${t("Cooking 钱包", "Cooking wallet")}</span>
          <select class="field-select" name="cookingWalletGroup" required>
            <option value="">${t("选择 Cooking 钱包", "Select a Cooking wallet")}</option>
            ${cookingOptions}
          </select>
        </label>
        <label class="launch-field">
          <span>${t("Cooking 钱包买入金额", "Cooking wallet buy amount")}</span>
          <div class="launch-amount-input">
            <input class="field-input" name="cookingBuyAmount" type="number" min="0" step="any" placeholder="0.00" />
            <span>${selected.unit}</span>
          </div>
        </label>
        <label class="launch-field">
          <span>${t("T1-T5 买入钱包组", "T1-T5 buy wallet group")}</span>
          <select class="field-select" name="buyingWalletGroup">
            <option value="">${t("选择钱包组", "Select wallet group")}</option>
            ${buyingGroupOptions}
          </select>
          <small>${t("发射确认后立即提交钱包组买入，目标在随后 1-5 个区块内完成；实际落块由链上状态决定。", "Wallet-group buys are submitted immediately after launch confirmation and target the following 1-5 blocks; actual inclusion depends on chain conditions.")}</small>
          ${buyingGroupOptions ? "" : `<small>${t("请先在资产页创建一个常规钱包组。", "Create a general wallet group in Assets first.")}</small>`}
        </label>
        <label class="launch-field">
          <span>${t("买入方式", "Buy mode")}</span>
          <select class="field-select" name="buyAllocationMode" id="buyAllocationMode">
            <option value="PER_WALLET_EQUAL">${t("等额买入", "Equal buy")}</option>
            <option value="TOTAL_RANDOM">${t("随机买入", "Random buy")}</option>
          </select>
          <small>${t("随机买入会将固定总额拆分为不同的逐钱包金额，确认后不再改变。", "Random buy splits a fixed total into different per-wallet amounts that are frozen after preview.")}</small>
        </label>
        <label class="launch-field" id="equalBoundBuyAmountField">
          <span>${t("每钱包买入金额", "Buy amount per wallet")}</span>
          <div class="launch-amount-input">
            <input class="field-input" name="boundBuyAmountPerWallet" type="number" min="0.000000001" step="any" placeholder="0.00" />
            <span>${selected.unit}</span>
          </div>
          <small>${t("所选钱包组内每个钱包使用相同金额。总预算将在确认页计算。", "Every selected wallet uses this amount. The total budget is calculated in the confirmation preview.")}</small>
        </label>
        <label class="launch-field" id="randomBoundBuyTotalField" hidden>
          <span>${t("钱包组买入总额", "Wallet-group total buy amount")}</span>
          <div class="launch-amount-input">
            <input class="field-input" name="boundBuyTotalAmount" type="number" min="0.000000001" step="any" placeholder="0.00" />
            <span>${selected.unit}</span>
          </div>
          <small>${t("该总额会随机拆分到组内全部钱包，逐钱包金额之和严格等于输入总额。", "This total is randomly split across every wallet; per-wallet amounts add up exactly to the entered total.")}</small>
        </label>

        <div class="launch-form-actions launch-field-wide">
          <p>${selected.id === "pons" ? t("基础发射费 0.0005 ETH。", "Base launch fee: 0.0005 ETH.") : t("由 Cooking 钱包确认发射；可选钱包组在 T1-T5 窗口执行买入。真实广播仅在生产执行开关和链配置通过后启用。", "The Cooking wallet confirms the launch; an optional wallet group buys during T1-T5. Live broadcast is enabled only after production execution and chain configuration pass validation.")}</p>
          ${selected.id === "pons" ? `<button class="primary-button" type="button" data-pons-launch><i class="fa-solid fa-fire-burner" aria-hidden="true"></i>${t(`Cooking 到 ${selected.name}`, `Cook on ${selected.name}`)}</button>` : `<button class="primary-button" type="button" data-internal-launch><i class="fa-solid fa-fire-burner" aria-hidden="true"></i>${t(`Cooking 到 ${selected.name}`, `Cook on ${selected.name}`)}</button>`}
        </div>
      </form>
    </section>
  ` : "";

  viewRoot.innerHTML = `
    ${pageHeading(
      "Launch Studio",
      t("选择发射平台", "Choose a launch platform"),
      t("上传或生成 Cooking 图片，选择 Cooking 钱包后完成发射。", "Upload or generate a Cooking image, select a Cooking wallet, and launch."),
      `<span class="simulation-pill"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>${t("钱包确认执行", "Wallet-confirmed execution")}</span>`,
    )}
    <section class="launch-grid">${platformCards}</section>
    ${launchForm}
    ${renderLaunchResultCard()}
  `;
}

async function loadLaunchGroups() {
  if (getState().assets.launchGroupsLoading) return;
  getState().assets.launchGroupsLoading = true;
  try {
    const result = await apiRequest("/api/v1/wallet-groups");
    getState().assets.mode = result.mode || "mock";
    getState().assets.groups = result.groups || [];
    if (getState().view === "launch") renderLaunch();
  } catch (error) {
    showToast(error.message);
  } finally {
    getState().assets.launchGroupsLoading = false;
  }
}

function isCookingGroup(group) {
  if (group.purpose === "cooking") return group.walletCount === 1;
  return !group.purpose && group.walletCount === 1;
}

  return {
    renderLaunch,
    loadLaunchGroups,
    connectRobinhoodWallet,
    submitPonsLaunch,
    submitInternalLaunch,
    isCookingGroup,
  };
}
