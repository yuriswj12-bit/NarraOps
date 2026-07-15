const viewRoot = document.querySelector("#viewRoot");
const toast = document.querySelector("#toast");
const modal = document.querySelector("#modal");
const modalBackdrop = document.querySelector("#modalBackdrop");
const modalTitle = document.querySelector("#modalTitle");
const modalKicker = document.querySelector("#modalKicker");
const modalBody = document.querySelector("#modalBody");
const notificationButton = document.querySelector("#notificationButton");
const notificationMenu = document.querySelector("#notificationMenu");
const languageButton = document.querySelector("#languageButton");
const languageMenu = document.querySelector("#languageMenu");
const themeButton = document.querySelector("#themeButton");

const allowedViews = new Set(["pulse", "go", "launch", "invite", "assets"]);
const storedLanguage = localStorage.getItem("narraops-language");
const storedTheme = localStorage.getItem("narraops-theme");

const state = {
  view: getViewFromHash(),
  language: storedLanguage === "en" ? "en" : "zh",
  theme: storedTheme === "soft" ? "soft" : "dark",
  selectedPlatform: null,
  launchWallet: {
    address: null,
    chainId: null,
    balance: null,
    connecting: false,
    error: null,
  },
  launchMedia: {
    file: null,
    previewUrl: null,
    metadataUri: null,
    generating: false,
  },
  settings: {
    x: true,
    tiktok: true,
    instagram: true,
    telegram: false,
    notifications: true,
  },
  conversation: [],
  agent: {
    conversationId: null,
    conversationPromise: null,
    eventSource: null,
    activeTaskId: null,
    submitting: false,
    retryCommand: null,
    seenEventIds: new Set(),
    seenCards: new Set(),
    reconnects: 0,
  },
  assets: {
    period: "7d",
    portfolio: null,
    groups: [],
    selectedGroupId: null,
    wallets: [],
    loading: false,
    error: null,
    transferOpen: false,
    transferSource: "login_wallet",
    transferDestination: null,
    transferFraction: 25,
    transferPreview: null,
    transferResult: null,
    transferBusy: false,
  },
};

const translations = {
  login: ["登录", "Log in"],
  register: ["注册", "Create account"],
  notifications: ["通知", "Notifications"],
  newSignal: ["新的叙事信号", "New narrative signal"],
  newSignalBody: ["跨平台讨论速度进入加速区间。", "Cross-platform discussion velocity is accelerating."],
  simulationOnly: ["模拟模式已开启", "Simulation mode is active"],
  simulationBody: ["资金与发射动作不会提交至链上。", "Fund and launch actions will not be submitted on-chain."],
};

const signalSeries = [
  [30, 34, 32, 41, 44, 48, 45, 52, 57, 55, 62, 68, 73, 76, 84, 82, 91],
  [58, 51, 55, 49, 61, 57, 64, 69, 63, 72, 76, 79, 74, 81, 86, 89, 88],
  [21, 28, 26, 33, 31, 39, 47, 44, 52, 56, 63, 67, 71, 78, 82, 87, 92],
];

const intelSeries = [
  [20, 24, 23, 27, 32, 31, 35, 39, 42, 46],
  [47, 44, 42, 46, 40, 38, 41, 35, 37, 34],
  [30, 31, 35, 34, 39, 43, 41, 46, 51, 49],
  [22, 27, 26, 32, 36, 42, 45, 50, 54, 60],
];

const opportunities = [
  {
    id: "op-1",
    source: "X",
    icon: "fa-brands fa-x-twitter",
    titleZh: "AI 代理开始拥有自己的品牌语言",
    titleEn: "AI agents are developing their own brand language",
    bodyZh: "开发者与创作者围绕 Agent 身份表达形成密集讨论。",
    bodyEn: "Developers and creators are converging around agent-native identity expression.",
    momentum: "+184%",
    score: "A / 91",
    reach: "1.8M",
  },
  {
    id: "op-2",
    source: "TikTok",
    icon: "fa-brands fa-tiktok",
    titleZh: "反差角色模板进入二次创作周期",
    titleEn: "Contrarian character templates enter a remix cycle",
    bodyZh: "短视频模板出现跨语种复刻，素材传播速度持续上升。",
    bodyEn: "Short-form templates are being remixed across languages with rising velocity.",
    momentum: "+126%",
    score: "A / 87",
    reach: "3.2M",
  },
  {
    id: "op-3",
    source: "Instagram",
    icon: "fa-brands fa-instagram",
    titleZh: "极简角色视觉形成可识别符号",
    titleEn: "Minimal character visuals become recognizable symbols",
    bodyZh: "视觉母题在多个创作者网络扩散，具备 Meme 化潜力。",
    bodyEn: "A visual motif is spreading across creator networks with meme potential.",
    momentum: "+93%",
    score: "B / 82",
    reach: "940K",
  },
  {
    id: "op-4",
    source: "X",
    icon: "fa-brands fa-x-twitter",
    titleZh: "链上身份与社区荣誉叙事升温",
    titleEn: "On-chain identity and community status narratives heat up",
    bodyZh: "话题从工具讨论转向身份、归属与社区共同创造。",
    bodyEn: "Discussion is shifting from tooling toward identity, belonging, and co-creation.",
    momentum: "+71%",
    score: "B / 78",
    reach: "680K",
  },
];

function getViewFromHash() {
  const value = window.location.hash.replace("#", "");
  return allowedViews.has(value) ? value : "pulse";
}

function t(zh, en) {
  return state.language === "zh" ? zh : en;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyStaticTranslations() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const entry = translations[element.dataset.i18n];
    if (entry) element.textContent = state.language === "zh" ? entry[0] : entry[1];
  });
  languageMenu.querySelectorAll("[data-language]").forEach((button) => {
    button.classList.toggle("active", button.dataset.language === state.language);
  });
}

function updateTheme() {
  document.documentElement.dataset.theme = state.theme === "soft" ? "soft" : "dark";
  const icon = themeButton.querySelector("i");
  icon.className = state.theme === "soft" ? "fa-regular fa-sun" : "fa-regular fa-moon";
}

function updateNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function pageHeading(kicker, title, subtitle, actions = "") {
  return `
    <div class="page-heading">
      <div>
        <span class="section-kicker">${kicker}</span>
        <h1>${title}</h1>
        <p>${subtitle}</p>
      </div>
      <div class="heading-actions">${actions}</div>
    </div>
  `;
}

function renderPulse() {
  const actions = `
    <span class="simulation-pill"><i class="fa-solid fa-flask" aria-hidden="true"></i>${t("示例信号", "Sample signals")}</span>
    <button class="secondary-button" type="button" data-action="scan"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> ${t("运行模拟扫描", "Run simulated scan")}</button>
  `;

  const signalCards = [
    ["fa-solid fa-arrow-trend-up", t("叙事传播速度", "Narrative velocity"), "82.4", "+18.7%", t("跨平台 24 小时变化", "Cross-platform 24h change")],
    ["fa-solid fa-link", t("来源共振", "Source resonance"), "7 / 10", "+11.2%", t("X · TikTok · Instagram", "X · TikTok · Instagram")],
    ["fa-solid fa-rocket", t("发射准备度", "Launch readiness"), "86", "+9.4%", t("叙事与受众匹配", "Narrative and audience fit")],
  ].map((card, index) => `
    <article class="signal-card">
      <div class="signal-topline">
        <span class="signal-name">${card[1]}</span>
        <span class="signal-icon"><i class="${card[0]}" aria-hidden="true"></i></span>
      </div>
      <div class="signal-value"><strong>${card[2]}</strong><span class="positive">${card[3]}</span></div>
      <canvas class="sparkline" data-chart="signal-${index}" role="img" aria-label="${card[1]}"></canvas>
      <div class="card-meta"><span>${card[4]}</span><span>${t("刚刚更新", "Updated now")}</span></div>
    </article>
  `).join("");

  const opportunityCards = opportunities.map((item) => `
    <button class="opportunity-card" type="button" data-opportunity="${item.id}">
      <div class="opportunity-topline">
        <span class="opportunity-source">
          <span class="source-icon"><i class="${item.icon}" aria-hidden="true"></i></span>
          <span class="source-pill">${item.source}</span>
        </span>
        <span class="score-pill">${item.score}</span>
      </div>
      <h3>${state.language === "zh" ? item.titleZh : item.titleEn}</h3>
      <p>${state.language === "zh" ? item.bodyZh : item.bodyEn}</p>
      <div class="opportunity-footer">
        <span class="metric-stack"><span>${t("动量", "Momentum")}</span><strong>${item.momentum}</strong></span>
        <span class="metric-stack"><span>${t("触达", "Reach")}</span><strong>${item.reach}</strong></span>
      </div>
    </button>
  `).join("");

  const intelCards = [
    ["fa-solid fa-chart-line", t("宏观注意力", "Macro attention"), t("风险偏好温和回升", "Risk appetite is recovering"), "+12.4%"],
    ["fa-solid fa-cubes-stacked", t("链上拥挤度", "On-chain congestion"), t("当前处于中低区间", "Currently in the low-mid range"), "34 / 100"],
    ["fa-solid fa-people-group", t("叙事拥挤度", "Narrative crowding"), t("相似主题数量增加", "Similar themes are increasing"), "49 / 100"],
    ["fa-solid fa-tower-broadcast", t("来源一致度", "Source consensus"), t("多个媒体源同步上升", "Multiple sources are rising together"), "76 / 100"],
  ].map((card, index) => `
    <article class="intel-card">
      <div class="intel-topline"><span class="signal-icon"><i class="${card[0]}" aria-hidden="true"></i></span><strong class="positive">${card[3]}</strong></div>
      <h3>${card[1]}</h3>
      <p>${card[2]}</p>
      <canvas class="sparkline" data-chart="intel-${index}" role="img" aria-label="${card[1]}"></canvas>
    </article>
  `).join("");

  viewRoot.innerHTML = `
    ${pageHeading(
      "Narra Pulse",
      t("发现下一条可发射叙事", "Discover the next launchable narrative"),
      t("聚合社交传播、叙事共振与链上环境，形成可审阅的机会简报。", "Combine social velocity, narrative resonance, and on-chain context into reviewable opportunity briefs."),
      actions,
    )}
    <section aria-label="${t("核心信号", "Core signals")}"><div class="signal-grid">${signalCards}</div></section>
    <section class="section-block">
      <div class="section-header"><div><h2>${t("发现机会", "Discover opportunities")}</h2><p>${t("按传播速度、可塑性与历史相似案例排序", "Ranked by velocity, adaptability, and historical analogs")}</p></div><button class="text-button" type="button" data-action="view-all">${t("查看全部", "View all")} <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></button></div>
      <div class="opportunity-grid">${opportunityCards}</div>
    </section>
    <section class="section-block">
      <div class="section-header"><div><h2>${t("精选情报", "Selected intelligence")}</h2><p>${t("宏观、链上与叙事环境概览", "Macro, on-chain, and narrative context")}</p></div></div>
      <div class="intel-grid">${intelCards}</div>
    </section>
  `;

  requestAnimationFrame(drawVisibleCharts);
}

function getMessageTime() {
  return new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

function getInitialConversation() {
  return [
    {
      role: "agent",
      timestamp: getMessageTime(),
      demo: true,
      contentZh: "这是 Go 工作台的演示引导。发送命令后，结果将来自 NarraOps 后端任务与实时事件流。",
      contentEn: "This is a demo introduction to Go. After you send a command, results come from NarraOps backend tasks and the live event stream.",
    },
  ];
}

function renderStructuredCard(card) {
  if (!card) return "";
  const cardMeta = {
    narrative_snapshot: ["fa-solid fa-wave-square", "叙事快照", "Narrative Snapshot"],
    meme_package: ["fa-solid fa-shapes", "Meme 构建包", "Meme Build Package"],
    launch_draft: ["fa-solid fa-rocket", "发射草案", "Launch Draft"],
    execution_plan: ["fa-solid fa-diagram-project", "执行计划", "Execution Plan"],
    community_plan: ["fa-solid fa-users-rays", "社区运营计划", "Community Operations Plan"],
    dev_market: ["fa-solid fa-chart-line", "链上行情", "On-chain Market"],
    narrative_trends: ["fa-solid fa-arrow-trend-up", "叙事信号趋势", "Narrative Signal Trends"],
    meme_analysis: ["fa-solid fa-magnifying-glass-chart", "Meme 分析报告", "Meme Analysis Report"],
    recent_summary: ["fa-solid fa-clock-rotate-left", "近期总结", "Recent Summary"],
  };
  const [icon, titleZh, titleEn] = cardMeta[card.type] || ["fa-solid fa-table-list", "任务结果", "Task Result"];
  const data = card.data && typeof card.data === "object" ? card.data : {};
  const entries = Object.entries(data);
  const scalarEntries = entries.filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value));
  const complexEntries = entries.filter(([, value]) => value && typeof value === "object");
  const metrics = scalarEntries.slice(0, 6).map(([key, value]) => `
    <div class="go-card-metric">
      <span>${formatAgentKey(key)}</span>
      <strong>${formatAgentValue(value)}</strong>
    </div>
  `).join("");
  const details = complexEntries.map(([key, value]) => `
    <details class="go-card-data-group">
      <summary>${formatAgentKey(key)} <span>${Array.isArray(value) ? value.length : Object.keys(value).length}</span></summary>
      <pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>
    </details>
  `).join("");

  return `
    <article class="go-structured-card" data-card-type="${card.type}">
      <header>
        <div><i class="${icon}" aria-hidden="true"></i><strong>${t(titleZh, titleEn)}</strong></div>
        <span>${escapeHtml(String(data.data_status || data.status || data.mode || card.status || t("已返回", "Returned")))}</span>
      </header>
      ${metrics ? `<div class="go-card-metrics">${metrics}</div>` : ""}
      ${details || (!entries.length ? `<p class="go-card-empty">${t("后端未返回可展示的数据。", "The backend returned no displayable data.")}</p>` : "")}
    </article>
  `;
}

function formatAgentKey(key) {
  return escapeHtml(String(key).replace(/_/g, " "));
}

function formatAgentValue(value) {
  if (value === null || value === undefined || value === "") return t("暂无", "Unavailable");
  if (typeof value === "boolean") return value ? t("是", "Yes") : t("否", "No");
  return escapeHtml(String(value));
}

function renderMessageContent(message) {
  if (message.lifecycle && message.lifecycle !== "completed" && message.lifecycle !== "failed") {
    const labels = {
      connecting: t("正在连接 Agent…", "Connecting to Agent…"),
      queued: t("任务已排队…", "Task queued…"),
      running: t("Agent 正在处理…", "Agent is working…"),
      reconnecting: t("事件流重连中…", "Reconnecting event stream…"),
    };
    return `<div class="go-agent-thinking"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>${labels[message.lifecycle] || labels.running}</span></div>${(message.cards || []).map(renderStructuredCard).join("")}`;
  }

  const content = message.contentZh ? t(message.contentZh, message.contentEn) : message.content;
  const suggestion = message.suggestionZh ? `
    <div class="go-suggestion">
      <span>${t("建议下一步", "Suggested next step")}</span>
      <p>${t(message.suggestionZh, message.suggestionEn)}</p>
    </div>
  ` : "";

  const demo = message.demo ? `<span class="go-demo-label">${t("演示引导", "Demo guide")}</span>` : "";
  const error = message.lifecycle === "failed" ? `
    <div class="go-agent-error"><strong>${t("任务失败", "Task failed")}</strong><span>${escapeHtml(message.error || t("Agent 服务当前不可用。", "The Agent service is currently unavailable."))}</span><button type="button" data-agent-retry>${t("重试", "Retry")}</button></div>
  ` : "";
  const cards = [...(message.cards || []), ...(message.card ? [message.card] : [])].map(renderStructuredCard).join("");
  return `${demo}${content ? `<p>${escapeHtml(content)}</p>` : ""}${suggestion}${cards}${error}`;
}

function renderConversation() {
  const container = document.querySelector("#conversation");
  if (!container) return;
  container.innerHTML = state.conversation.map((message) => {
    if (message.role === "user") {
      return `
        <article class="go-message-row user">
          <div class="go-message-content">
            <div class="go-message-meta"><span>${message.timestamp || getMessageTime()}</span><strong>${t("你", "You")}</strong></div>
            <div class="go-user-bubble">${escapeHtml(message.content)}</div>
          </div>
          <span class="go-user-avatar" aria-hidden="true"><i class="fa-solid fa-user"></i></span>
        </article>
      `;
    }

    return `
      <article class="go-message-row agent">
        <span class="go-agent-avatar" aria-hidden="true">N</span>
        <div class="go-message-content">
          <div class="go-message-meta"><strong>NarraOps Agent</strong><span>${message.timestamp || getMessageTime()}</span></div>
          <div class="go-agent-response">${renderMessageContent(message)}</div>
        </div>
      </article>
    `;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function renderGo() {
  if (!state.conversation.length) state.conversation = getInitialConversation();
  const quickActions = [
    ["/dev-market", "fa-solid fa-chart-line", "链上行情", "On-chain Market", "按链标记 Dev 钱包，统计盈利并对比上一周期。", "Tag dev wallets by chain, compare profit across periods."],
    ["/launch", "fa-solid fa-rocket", "Launch Meme", "Launch Meme", "选择链、连接 Dev 钱包与钱包组，绑定社交资料并生成买卖决策。", "Choose a chain, connect dev wallets and wallet groups, bind socials, and plan trading decisions."],
    ["/narrative-trends", "fa-solid fa-arrow-trend-up", "叙事信号趋势", "Narrative Trends", "统计各链已发射 Meme 使用的叙事并生成评分报告。", "Score narratives used by launched memes across chains."],
    ["/analyze-meme", "fa-solid fa-magnifying-glass-chart", "分析 Meme", "Analyze Meme", "根据合约地址识别庄家集群并生成分析报告。", "Find operator clusters from a contract address and produce a report."],
    ["/recent-summary", "fa-solid fa-clock-rotate-left", "近期总结", "Recent Summary", "总结近期发射、盈利、Dev 钱包与钱包组使用情况。", "Summarize launches, profit, dev wallets, and wallet-group activity."],
  ].map(([command, icon, zh, en, descriptionZh, descriptionEn]) => `
    <button type="button" data-command="${command}" title="${t(descriptionZh, descriptionEn)}" aria-label="${t(`${zh}：${descriptionZh}`, `${en}: ${descriptionEn}`)}"><i class="${icon}" aria-hidden="true"></i><span>${t(zh, en)}</span></button>
  `).join("");

  viewRoot.innerHTML = `
    <div class="go-workspace">
      <section class="go-terminal" aria-label="NarraOps Agent">
        <header class="go-agent-bar">
          <div class="go-agent-identity">
            <span class="go-agent-avatar" aria-hidden="true">N</span>
            <strong>NarraOps Agent</strong>
            <span class="go-online"><i class="fa-solid fa-circle" aria-hidden="true"></i>${t("在线", "Online")}</span>
          </div>
          <div class="go-agent-tools">
            <button type="button" data-go-action="history" aria-label="${t("历史记录", "History")}" title="${t("历史记录", "History")}"><i class="fa-solid fa-clock-rotate-left" aria-hidden="true"></i></button>
            <button type="button" data-go-action="share" aria-label="${t("分享会话", "Share conversation")}" title="${t("分享会话", "Share conversation")}"><i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i></button>
            <span class="go-tool-divider" aria-hidden="true"></span>
            <button type="button" data-go-action="close" aria-label="${t("关闭 Go", "Close Go")}" title="${t("关闭 Go", "Close Go")}"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
          </div>
        </header>

        <div class="go-conversation" id="conversation" aria-live="polite"></div>

        <form class="go-composer" id="agentForm">
          <textarea class="go-command-input" id="agentInput" rows="1" autocomplete="off" placeholder="${t("描述任务，或输入 / 使用命令", "Describe a task, or type / for commands")}" aria-label="${t("Agent 命令", "Agent command")}"></textarea>
          <div class="go-composer-footer">
            <div class="go-composer-tools">
              <button type="button" data-go-action="plus" aria-label="${t("添加上下文", "Add context")}" title="${t("添加上下文", "Add context")}"><i class="fa-solid fa-plus" aria-hidden="true"></i></button>
            </div>
          </div>
        </form>
      </section>

      <nav class="go-quick-actions" aria-label="${t("Agent 快捷任务", "Agent quick tasks")}">${quickActions}</nav>
    </div>
  `;
  renderConversation();
}

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
  if (!state.launchWallet.address) {
    await connectRobinhoodWallet();
    if (!state.launchWallet.address) return;
  }
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const cookingGroup = state.assets.groups.find((group) => group.groupId === values.cookingWalletGroup && group.purpose === "cooking" && group.walletCount === 1);
  if (!cookingGroup) {
    showToast(t("请选择一个只包含 1 个钱包的 Cooking 钱包组。", "Select a Cooking wallet group containing exactly one wallet."));
    return;
  }
  if (!state.launchMedia.file && !state.launchMedia.metadataUri) {
    showToast(t("请先上传或生成 Cooking 图片。", "Upload or generate a Cooking image first."));
    return;
  }
  if (!state.launchMedia.metadataUri) {
    showToast(t("图片已选择；配置 IPFS 固定服务后即可自动生成链上元数据。", "Image selected. Configure the IPFS pinning service to generate on-chain metadata automatically."));
    return;
  }
  const creator = state.launchWallet.address;
  const developerBuyWei = parseEthToWei(values.cookingBuyAmount);
  const totalValue = PONS_LAUNCH_FEE_WEI + developerBuyWei;
  const data = encodePonsLaunch({
    name: values.tokenName.trim(),
    symbol: values.tokenSymbol.trim(),
    metadataUri: state.launchMedia.metadataUri,
    description: `${values.tokenName.trim()} (${values.tokenSymbol.trim()})`,
    socials: [values.xUrl.trim(), values.telegramUrl.trim(), values.websiteUrl.trim(), "", ""],
    creator,
    salt: randomBytes32(),
  });
  const transaction = { from: state.launchWallet.address, to: PONS_FACTORY, value: `0x${totalValue.toString(16)}`, data };
  try {
    const gas = await window.ethereum.request({ method: "eth_estimateGas", params: [transaction] });
    const confirmed = window.confirm(t(
      `即将通过 Pons 工厂发射 ${values.tokenSymbol}。总支付 ${values.cookingBuyAmount || "0"} ETH + 0.0005 ETH 发射费，预估 Gas ${Number.parseInt(gas, 16).toLocaleString()}。继续后钱包仍会要求最终确认。`,
      `Launch ${values.tokenSymbol} through the Pons factory. Total payment is ${values.cookingBuyAmount || "0"} ETH plus the 0.0005 ETH launch fee; estimated gas is ${Number.parseInt(gas, 16).toLocaleString()}. Your wallet will request final confirmation.`,
    ));
    if (!confirmed) return;
    const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ ...transaction, gas }] });
    sessionStorage.setItem("narraops-last-launch-tx", hash);
    showToast(t(`发射交易已提交：${hash.slice(0, 12)}…`, `Launch transaction submitted: ${hash.slice(0, 12)}…`));
    window.open(`${ROBINHOOD_CHAIN.blockExplorerUrls[0]}/tx/${hash}`, "_blank", "noopener,noreferrer");
  } catch (error) {
    showToast(error.code === 4001 ? t("你取消了交易。", "Transaction cancelled.") : (error.message || t("发射交易失败。", "Launch transaction failed.")));
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
    state.launchWallet.error = t("未检测到 EVM 钱包，请安装 MetaMask 或支持 EIP-1193 的钱包。", "No EVM wallet detected. Install MetaMask or another EIP-1193 wallet.");
    renderLaunch();
    return;
  }

  state.launchWallet.connecting = true;
  state.launchWallet.error = null;
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
    state.launchWallet.address = address;
    state.launchWallet.chainId = Number.parseInt(chainId, 16);
    state.launchWallet.balance = formatWeiBalance(balance);
  } catch (error) {
    state.launchWallet.error = error.code === 4001
      ? t("你取消了钱包授权或网络切换。", "Wallet access or network switching was cancelled.")
      : (error.message || t("钱包连接失败。", "Wallet connection failed."));
  } finally {
    state.launchWallet.connecting = false;
    renderLaunch();
  }
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

  const selected = platforms.find((platform) => platform.id === state.selectedPlatform);
  const launchWallet = state.launchWallet;
  const walletAddress = launchWallet.address
    ? `${launchWallet.address.slice(0, 7)}...${launchWallet.address.slice(-5)}`
    : t("未连接", "Not connected");
  const cookingGroups = state.assets.groups.filter((group) => group.purpose === "cooking" && group.walletCount === 1);
  const cookingOptions = cookingGroups.map((group) => `<option value="${group.groupId}">${escapeHtml(group.name)} · ${t("1 个钱包", "1 wallet")}</option>`).join("");
  const media = state.launchMedia;
  const platformCards = platforms.map((platform) => `
    <article class="launch-platform ${state.selectedPlatform === platform.id ? "selected" : ""}">
      <div class="platform-topline">
        <span class="platform-icon"><i class="${platform.icon}" aria-hidden="true"></i></span>
        <span class="source-pill">${platform.chain}</span>
      </div>
      <div class="launch-platform-copy">
        <h3>${platform.name}</h3>
        <p>${t(platform.descriptionZh, platform.descriptionEn)}</p>
      </div>
      <button class="platform-button" type="button" data-platform="${platform.id}">${state.selectedPlatform === platform.id ? t("已选择", "Selected") : t("选择平台", "Select platform")}</button>
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
        <div class="launch-wallet-panel launch-field-wide">
          <div>
            <span class="section-kicker">${t("链上钱包", "On-chain wallet")}</span>
            <strong>${walletAddress}</strong>
            <small>${launchWallet.balance === null ? t("连接后读取 Robinhood Chain 余额", "Connect to read the Robinhood Chain balance") : `${launchWallet.balance} ETH · Chain ID ${launchWallet.chainId}`}</small>
            ${launchWallet.error ? `<small class="launch-wallet-error">${escapeHtml(launchWallet.error)}</small>` : ""}
          </div>
          <button class="secondary-button" type="button" data-launch-wallet="connect" ${launchWallet.connecting ? "disabled" : ""}>
            <i class="fa-solid fa-wallet" aria-hidden="true"></i>${launchWallet.connecting ? t("连接中…", "Connecting…") : launchWallet.address ? t("重新连接", "Reconnect") : t("连接钱包", "Connect wallet")}
          </button>
        </div>
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
          ${cookingOptions ? "" : `<small>${t("请先在资产页创建 Cooking 钱包组（1 个钱包）。", "Create a Cooking wallet group with one wallet in Assets first.")}</small>`}
        </label>
        <label class="launch-field">
          <span>${t("Cooking 钱包买入金额", "Cooking wallet buy amount")}</span>
          <div class="launch-amount-input">
            <input class="field-input" name="cookingBuyAmount" type="number" min="0" step="0.0001" placeholder="0.00" />
            <span>${selected.unit}</span>
          </div>
        </label>

        <div class="launch-form-actions launch-field-wide">
          <p>${selected.id === "pons" ? t("基础发射费 0.0005 ETH。", "Base launch fee: 0.0005 ETH.") : t("该平台的直连执行适配器仍在接入。", "Direct execution for this platform is still being integrated.")}</p>
          ${selected.id === "pons" ? `<button class="primary-button" type="button" data-pons-launch><i class="fa-solid fa-rocket" aria-hidden="true"></i>${t("在 NarraOps 发射", "Launch in NarraOps")}</button>` : `<button class="primary-button" type="button" disabled><i class="fa-solid fa-rocket" aria-hidden="true"></i>${t("发射暂未开放", "Launch unavailable")}</button>`}
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
  `;
}

function renderInvite() {
  viewRoot.innerHTML = `
    ${pageHeading("Invite", t("邀请协作者加入你的叙事工作区", "Invite collaborators to your narrative workspace"), t("当前为本地演示状态，不会创建真实账户或奖励。", "This is a local demo and does not create real accounts or rewards."), `<span class="simulation-pill"><i class="fa-solid fa-flask" aria-hidden="true"></i>Demo</span>`)}
    <div class="invite-grid">
      <section class="invite-panel"><h3>${t("邀请链接", "Invite link")}</h3><p>${t("分享演示工作区入口。", "Share the demo workspace entry.")}</p><div class="invite-code"><code>narraops.local/invite/NARRA-DEMO</code><button class="compact-button" type="button" data-action="copy-invite"><i class="fa-regular fa-copy" aria-hidden="true"></i></button></div></section>
      <section class="invite-panel"><h3>${t("协作概览", "Collaboration overview")}</h3><div class="settings-list"><div class="invite-stat"><span>${t("已邀请", "Invited")}</span><strong>0</strong></div><div class="invite-stat"><span>${t("已加入", "Joined")}</span><strong>0</strong></div><div class="invite-stat"><span>${t("待审核草案", "Drafts awaiting review")}</span><strong>0</strong></div></div></section>
    </div>
  `;
}

function settingsToggle(key, label, description) {
  return `<div class="settings-row"><div><strong>${label}</strong><span>${description}</span></div><button class="toggle ${state.settings[key] ? "active" : ""}" type="button" data-setting="${key}" aria-pressed="${state.settings[key]}"></button></div>`;
}

function renderLegacySettings() {
  viewRoot.innerHTML = `
    ${pageHeading("Settings", t("配置来源、界面与安全边界", "Configure sources, interface, and safety boundaries"), t("所有设置仅保存在当前浏览器。", "All settings are stored only in this browser."), `<span class="simulation-pill"><i class="fa-solid fa-lock" aria-hidden="true"></i>${t("真实执行关闭", "Live execution off")}</span>`)}
    <div class="settings-grid">
      <section class="settings-panel"><h3>${t("监控来源", "Monitoring sources")}</h3><p>${t("选择 Pulse 与 Agent 可使用的模拟来源。", "Choose simulated sources available to Pulse and Agent.")}</p><div class="settings-list">${settingsToggle("x", "X", t("推文与账号传播轨迹", "Posts and account propagation"))}${settingsToggle("tiktok", "TikTok", t("短视频趋势与模板扩散", "Short-video trends and template spread"))}${settingsToggle("instagram", "Instagram", t("视觉母题与创作者网络", "Visual motifs and creator networks"))}${settingsToggle("telegram", "Telegram", t("公开社区讨论", "Public community discussions"))}</div></section>
      <section class="settings-panel"><h3>${t("界面与安全", "Interface and safety")}</h3><p>${t("管理本地体验，不会改变执行权限。", "Manage local experience without changing execution permissions.")}</p><div class="settings-list">${settingsToggle("notifications", t("通知", "Notifications"), t("显示叙事信号提醒", "Show narrative signal alerts"))}<div class="settings-row"><div><strong>${t("语言", "Language")}</strong><span>${state.language === "zh" ? "简体中文" : "English"}</span></div><button class="compact-button" type="button" data-action="language">${state.language === "zh" ? "EN" : "中文"}</button></div><div class="settings-row"><div><strong>${t("主题", "Theme")}</strong><span>${state.theme === "soft" ? t("柔和黑", "Soft dark") : t("深黑", "Deep dark")}</span></div><button class="compact-button" type="button" data-action="theme"><i class="fa-regular ${state.theme === "soft" ? "fa-sun" : "fa-moon"}" aria-hidden="true"></i></button></div><div class="settings-row"><div><strong>${t("链上执行", "On-chain execution")}</strong><span>${t("未接入签名与广播服务", "Signing and broadcast services are not connected")}</span></div><span class="state-pill">Disabled</span></div></div></section>
    </div>
  `;
}

function money(value, currency = "USD") {
  const amount = Number(value || 0);
  return new Intl.NumberFormat(state.language === "zh" ? "zh-CN" : "en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function shortAddress(value) {
  const address = String(value || "");
  return address.length > 18 ? `${address.slice(0, 9)}…${address.slice(-6)}` : address;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
  return body;
}

async function loadAssets({ keepGroup = true } = {}) {
  if (state.assets.loading) return;
  state.assets.loading = true;
  state.assets.error = null;
  renderAssets();
  try {
    const [portfolio, groupsResult] = await Promise.all([
      apiRequest(`/api/v1/account/portfolio?period=${state.assets.period}`),
      apiRequest("/api/v1/wallet-groups"),
    ]);
    state.assets.portfolio = portfolio;
    state.assets.groups = groupsResult.groups || [];
    if (!keepGroup || !state.assets.groups.some((group) => group.groupId === state.assets.selectedGroupId)) state.assets.selectedGroupId = state.assets.groups[0]?.groupId || null;
    if (state.assets.selectedGroupId) {
      const detail = await apiRequest(`/api/v1/wallet-groups/${state.assets.selectedGroupId}/wallets`);
      state.assets.wallets = detail.wallets || [];
    } else state.assets.wallets = [];
  } catch (error) {
    state.assets.error = error.message;
  } finally {
    state.assets.loading = false;
    renderAssets();
  }
}

async function loadLaunchGroups() {
  try {
    const result = await apiRequest("/api/v1/wallet-groups");
    state.assets.groups = result.groups || [];
    if (state.view === "launch") renderLaunch();
  } catch (error) {
    showToast(error.message);
  }
}

function renderAssetSummary() {
  const portfolio = state.assets.portfolio;
  return [
    [t("总资产", "Total assets"), money(portfolio?.totalBalance, portfolio?.currency), "fa-wallet"],
    [t("已实现盈亏", "Realized P&L"), money(portfolio?.realizedPnl, portfolio?.currency), "fa-chart-line"],
    [t("未实现盈亏", "Unrealized P&L"), money(portfolio?.unrealizedPnl, portfolio?.currency), "fa-wave-square"],
    [t("周期成交额", "Period turnover"), money(portfolio?.turnover, portfolio?.currency), "fa-arrow-right-arrow-left"],
  ].map(([label, value, icon]) => `<article class="asset-stat-card"><span><i class="fa-solid ${icon}" aria-hidden="true"></i>${label}</span><strong>${portfolio ? value : "—"}</strong></article>`).join("");
}

function transferEndpointValue(value) {
  return value === "login_wallet" ? { type: "login_wallet" } : { type: "wallet_group", id: value };
}

function transferEndpointOptions(selected, exclude = null) {
  const login = `<option value="login_wallet" ${selected === "login_wallet" ? "selected" : ""} ${exclude === "login_wallet" ? "disabled" : ""}>${t("登录地址", "Login address")}</option>`;
  return login + state.assets.groups.map((group) => `<option value="${group.groupId}" ${selected === group.groupId ? "selected" : ""} ${exclude === group.groupId ? "disabled" : ""}>${escapeHtml(group.name)} · ${group.walletCount} ${t("个钱包", "wallets")}</option>`).join("");
}

function renderTransferPanel() {
  if (!state.assets.transferOpen) return "";
  const source = state.assets.transferSource;
  const destination = state.assets.transferDestination || state.assets.groups.find((group) => group.groupId !== source)?.groupId || state.assets.groups[0]?.groupId || null;
  state.assets.transferDestination = destination;
  const preview = state.assets.transferPreview;
  const pairRows = (preview?.allocations || []).slice(0, 6).map((item, index) => `<div class="transfer-pair"><span>${String(index + 1).padStart(2, "0")}</span><code>${escapeHtml(shortAddress(item.sourceWalletId || t("登录地址", "Login address")))}</code><i class="fa-solid fa-arrow-right"></i><code>${escapeHtml(shortAddress(item.destinationWalletId || t("登录地址", "Login address")))}</code><strong>${money(item.amount, preview.currency)}</strong></div>`).join("");
  return `<section class="transfer-panel">
    <div class="asset-section-heading"><div><span>${t("资金转移", "Fund transfer")}</span><h2>${t("钱包组转账", "Wallet-group transfer")}</h2></div><button class="icon-button" type="button" data-action="close-transfer" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
    <form id="assetTransferForm"><div class="transfer-route"><label class="field-label">${t("转出对象", "From")}<select class="field-select" id="transferSource">${transferEndpointOptions(source, destination)}</select></label><button class="transfer-swap" type="button" data-action="swap-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i></button><label class="field-label">${t("转入对象", "To")}<select class="field-select" id="transferDestination">${transferEndpointOptions(destination, source)}</select></label></div>
      <div class="transfer-slider-block"><div><span>${t("转账比例", "Transfer ratio")}</span><strong id="transferPercent">${state.assets.transferFraction}%</strong></div><input id="transferFraction" type="range" min="1" max="100" value="${state.assets.transferFraction}" /><div class="slider-ticks"><span>1%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div>
      <div class="transfer-rule"><i class="fa-solid fa-link"></i><div><strong>${source !== "login_wallet" && destination !== "login_wallet" ? t("钱包索引 1:1 配对", "1:1 wallet-index pairing") : source === "login_wallet" ? t("登录地址向钱包组分发", "Login address distributes to a wallet group") : t("钱包组归集到登录地址", "Wallet group collects to login address")}</strong><span>${t("两个钱包组按 Wallet[i] → Wallet[i] 配对，未匹配钱包不参与。当前只生成转账计划，不签名、不广播。", "Two groups pair Wallet[i] → Wallet[i]; unmatched wallets do not participate. This creates a plan only—no signing or broadcast.")}</span></div></div>
      <div class="transfer-actions"><button class="secondary-button" type="button" data-action="close-transfer">${t("取消", "Cancel")}</button><button class="primary-button" type="submit" ${state.assets.transferBusy || !destination ? "disabled" : ""}><i class="fa-solid fa-eye"></i>${state.assets.transferBusy ? t("生成中…", "Planning…") : t("预览转账计划", "Preview transfer plan")}</button></div></form>
    ${preview ? `<div class="transfer-preview"><div class="transfer-preview-summary"><span><small>${t("预计金额", "Estimated amount")}</small><strong>${money(preview.estimatedAmount, preview.currency)}</strong></span><span><small>${t("配对数量", "Pairs")}</small><strong>${preview.pairCount}</strong></span><span><small>${t("未匹配", "Unmatched")}</small><strong>${(preview.unmatchedSourceWalletIds?.length || 0) + (preview.unmatchedDestinationWalletIds?.length || 0)}</strong></span><span><small>${t("状态", "Status")}</small><strong>${t("等待确认 · 执行关闭", "Review · execution off")}</strong></span></div><div class="transfer-pair-list">${pairRows}</div><button class="primary-button transfer-confirm" type="button" data-action="confirm-transfer-plan">${t("确认并保存计划", "Confirm and save plan")}</button></div>` : ""}
    ${state.assets.transferResult ? `<div class="asset-state"><i class="fa-solid fa-circle-check"></i>${t("转账计划已保存，真实签名与广播仍关闭。", "Transfer plan saved; signing and broadcast remain disabled.")}</div>` : ""}
  </section>`;
}

function renderAssets() {
  const selectedGroup = state.assets.groups.find((group) => group.groupId === state.assets.selectedGroupId);
  const periods = ["1d", "7d", "30d", "all"].map((period) => `<button class="period-button ${state.assets.period === period ? "active" : ""}" type="button" data-asset-period="${period}">${period === "all" ? t("全部", "All") : period.toUpperCase()}</button>`).join("");
  const groupCards = state.assets.groups.map((group) => `<button class="wallet-group-card ${group.groupId === state.assets.selectedGroupId ? "active" : ""}" type="button" data-wallet-group="${group.groupId}"><span class="wallet-group-icon"><i class="fa-solid ${group.purpose === "cooking" ? "fa-fire-burner" : "fa-layer-group"}"></i></span><span><strong>${escapeHtml(group.name)}</strong><small>${group.purpose === "cooking" ? t("Cooking · 1 个钱包", "Cooking · 1 wallet") : `${group.walletCount} ${t("个钱包", "wallets")}`}</small></span><b>${money(group.totalBalance, group.balanceAsset)}</b></button>`).join("");
  const walletRows = state.assets.wallets.map((wallet) => `<tr><td><span class="wallet-label"><i class="fa-solid fa-wallet"></i><strong>${escapeHtml(wallet.label)}</strong></span></td><td><code>${escapeHtml(shortAddress(wallet.publicAddress))}</code></td><td>${money(wallet.balance, wallet.balanceAsset)}</td><td><span class="state-pill">${t("模拟", "Simulation")}</span></td></tr>`).join("");
  const status = state.assets.loading ? `<div class="asset-state"><i class="fa-solid fa-circle-notch fa-spin"></i>${t("正在读取资产…", "Loading assets…")}</div>` : state.assets.error ? `<div class="asset-state error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${t("资产服务未连接", "Asset service unavailable")}</strong><span>${escapeHtml(state.assets.error)}</span></div><button class="secondary-button" type="button" data-action="refresh-assets">${t("重试", "Retry")}</button></div>` : "";
  const totalWallets = state.assets.groups.reduce((sum, group) => sum + group.walletCount, 0);
  const portfolio = state.assets.portfolio;
  viewRoot.innerHTML = `
    ${pageHeading("Assets", t("个人资产与钱包组", "Personal assets and wallet groups"), t("统一查看账户表现、钱包组资产与模拟钱包。", "Review account performance, wallet-group assets, and simulated wallets."), `<span class="simulation-pill"><i class="fa-solid fa-shield-halved"></i>${t("模拟资产 · 真实执行关闭", "Mock assets · Live execution off")}</span><button class="secondary-button" type="button" data-action="refresh-assets"><i class="fa-solid fa-arrows-rotate"></i>${t("刷新", "Refresh")}</button>`)}
    ${status}
    <section class="asset-overview-panel account-wallet-card"><div class="account-wallet-tabs"><strong>${t("钱包", "Wallets")} (${totalWallets})</strong><div class="period-switcher">${periods}</div><button class="calendar-button" type="button"><i class="fa-regular fa-calendar"></i>${t("盈亏日历", "P&L calendar")}</button></div><div class="account-balance"><span>${t("总余额", "Total balance")}</span><strong>${portfolio ? money(portfolio.totalBalance, portfolio.currency) : "—"}</strong></div><div class="account-profit-grid"><span><small>${t("总成交额", "Total turnover")}</small><strong>${portfolio ? money(portfolio.turnover, portfolio.currency) : "—"}</strong></span><span><small>${t("总盈亏", "Total P&L")}</small><strong class="positive">${portfolio ? money(Number(portfolio.realizedPnl) + Number(portfolio.unrealizedPnl), portfolio.currency) : "—"} (${portfolio?.pnlPercent || "0"}%)</strong></span><span><small>${t("已实现利润", "Realized P&L")}</small><strong>${portfolio ? money(portfolio.realizedPnl, portfolio.currency) : "—"}</strong></span><span><small>${t("未实现利润", "Unrealized P&L")}</small><strong>${portfolio ? money(portfolio.unrealizedPnl, portfolio.currency) : "—"}</strong></span></div><div class="account-wallet-actions"><button type="button" data-action="deposit-disabled"><i class="fa-solid fa-arrow-down"></i><span>${t("充值", "Deposit")}</span></button><button type="button" data-action="withdraw-disabled"><i class="fa-solid fa-arrow-up"></i><span>${t("提取", "Withdraw")}</span></button><button type="button" data-action="open-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i><span>${t("转账", "Transfer")}</span></button></div></section>
    ${renderTransferPanel()}
    <section class="wallet-groups-layout">
      <div class="wallet-groups-panel"><div class="asset-section-heading"><div><span>${t("钱包组资产", "Wallet-group assets")}</span><h2>${t("钱包组", "Wallet groups")}</h2></div><button class="compact-button" type="button" data-action="open-create-group"><i class="fa-solid fa-plus"></i>${t("新建", "New")}</button></div><div class="wallet-group-list">${groupCards || `<div class="empty-state">${t("还没有钱包组", "No wallet groups yet")}</div>`}</div></div>
      <div class="wallet-detail-panel"><div class="asset-section-heading"><div><span>${t("钱包组管理", "Wallet-group management")}</span><h2>${selectedGroup ? escapeHtml(selectedGroup.name) : t("选择钱包组", "Select a wallet group")}</h2></div>${selectedGroup && selectedGroup.purpose !== "cooking" ? `<button class="compact-button" type="button" data-action="open-add-wallet"><i class="fa-solid fa-plus"></i>${t("添加钱包", "Add wallets")}</button>` : ""}</div>${selectedGroup ? `<div class="wallet-group-metrics"><span><small>${t("钱包数量", "Wallets")}</small><strong>${selectedGroup.walletCount}</strong></span><span><small>${t("组内资产", "Group assets")}</small><strong>${money(selectedGroup.totalBalance, selectedGroup.balanceAsset)}</strong></span><span><small>${t("钱包组用途", "Group purpose")}</small><strong>${selectedGroup.purpose === "cooking" ? "Cooking" : t("常规", "General")}</strong></span></div><div class="wallet-table-wrap"><table class="wallet-table"><thead><tr><th>${t("钱包", "Wallet")}</th><th>${t("公开地址", "Public address")}</th><th>${t("余额", "Balance")}</th><th>${t("状态", "Status")}</th></tr></thead><tbody>${walletRows || `<tr><td colspan="4" class="empty-state">${t("该组暂无钱包", "No wallets in this group")}</td></tr>`}</tbody></table></div>` : `<div class="empty-state large"><i class="fa-solid fa-layer-group"></i>${t("选择一个钱包组查看明细", "Select a wallet group to view details")}</div>`}</div>
    </section>`;
  const addWalletButton = viewRoot.querySelector('[data-action="open-add-wallet"]');
  if (addWalletButton) addWalletButton.insertAdjacentHTML("beforebegin", `<button class="compact-button" type="button" data-action="open-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i>${t("转账", "Transfer")}</button>`);
}

function renderCurrentView() {
  viewRoot.classList.toggle("go-workspace-root", state.view === "go");
  updateNavigation();
  applyStaticTranslations();
  if (state.view === "go") renderGo();
  else if (state.view === "launch") renderLaunch();
  else if (state.view === "invite") renderInvite();
  else if (state.view === "assets") renderAssets();
  else renderPulse();
}

function drawSparkline(canvas, values, color) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);

  const padding = 5;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const points = values.map((value, index) => ({
    x: padding + (index / (values.length - 1)) * (width - padding * 2),
    y: height - padding - ((value - min) / spread) * (height - padding * 2),
  }));

  context.beginPath();
  context.moveTo(points[0].x, height - padding);
  points.forEach((point) => context.lineTo(point.x, point.y));
  context.lineTo(points[points.length - 1].x, height - padding);
  context.closePath();
  context.fillStyle = "rgba(45, 205, 99, 0.11)";
  context.fill();

  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.lineWidth = 2;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = color;
  context.stroke();

  const finalPoint = points[points.length - 1];
  context.beginPath();
  context.arc(finalPoint.x, finalPoint.y, 3, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();
}

function drawVisibleCharts() {
  document.querySelectorAll("[data-chart]").forEach((canvas) => {
    const [type, indexString] = canvas.dataset.chart.split("-");
    const index = Number(indexString);
    const series = type === "signal" ? signalSeries[index] : intelSeries[index];
    drawSparkline(canvas, series, type === "signal" ? "#20ca63" : "#57e887");
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function openModal({ kicker = "NarraOps", title, content }) {
  modalKicker.textContent = kicker;
  modalTitle.textContent = title;
  modalBody.innerHTML = content;
  modal.classList.remove("hidden");
  modalBackdrop.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  document.querySelector("#closeModalButton").focus();
}

function closeModal() {
  modal.classList.add("hidden");
  modalBackdrop.classList.add("hidden");
  document.body.style.overflow = "";
}

function openOpportunity(id) {
  const item = opportunities.find((opportunity) => opportunity.id === id);
  if (!item) return;
  openModal({
    kicker: `${item.source} · ${t("机会简报", "Opportunity brief")}`,
    title: state.language === "zh" ? item.titleZh : item.titleEn,
    content: `
      <p>${state.language === "zh" ? item.bodyZh : item.bodyEn}</p>
      <div class="modal-metrics"><div class="modal-metric"><span>${t("叙事评分", "Narrative score")}</span><strong>${item.score}</strong></div><div class="modal-metric"><span>${t("传播动量", "Momentum")}</span><strong class="positive">${item.momentum}</strong></div><div class="modal-metric"><span>${t("估算触达", "Estimated reach")}</span><strong>${item.reach}</strong></div></div>
      <div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("关闭", "Close")}</button><button class="primary-button" type="button" data-modal-action="agent"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ${t("交给 Agent 分析", "Analyze with Agent")}</button></div>
    `,
  });
}

function openAuth(mode) {
  const isLogin = mode === "login";
  openModal({
    kicker: "NarraOps Account",
    title: isLogin ? t("登录", "Log in") : t("创建账户", "Create account"),
    content: `
      <p>${t("认证服务尚未接入，此表单仅用于界面验证。", "Authentication is not connected; this form is for interface validation only.")}</p>
      <form class="form-stack" id="authForm">
        <label class="field-label">${t("邮箱", "Email")}<input class="field-input" type="email" autocomplete="email" required placeholder="name@example.com" /></label>
        <label class="field-label">${t("密码", "Password")}<input class="field-input" type="password" autocomplete="current-password" required placeholder="••••••••" /></label>
        <div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit">${isLogin ? t("登录演示", "Demo login") : t("注册演示", "Demo registration")}</button></div>
      </form>
    `,
  });
}

function openCreateGroup() {
  openModal({
    kicker: t("钱包组管理", "Wallet-group management"),
    title: t("新建钱包组", "Create wallet group"),
    content: `<form class="form-stack" id="createWalletGroupForm"><label class="field-label">${t("钱包组名称", "Group name")}<input class="field-input" name="name" maxlength="48" required placeholder="${t("例如：核心发射组", "e.g. Core launch")}" /></label><label class="field-label">${t("钱包组用途", "Group purpose")}<select class="field-select" name="purpose" id="walletGroupPurpose"><option value="general">${t("常规钱包组", "General wallet group")}</option><option value="cooking">${t("Cooking 钱包组", "Cooking wallet group")}</option></select></label><label class="field-label" id="walletCountField">${t("初始钱包数量", "Initial wallet count")}<input class="field-input" name="walletCount" type="number" min="1" max="100" value="3" required /></label><p id="walletGroupPurposeHint">${t("Cooking 钱包组固定只生成 1 个钱包，可创建多个组并在发射时选择。", "A Cooking group always contains one wallet. Create multiple groups and select one during launch.")}</p><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit">${t("创建钱包组", "Create group")}</button></div></form>`,
  });
}

function openAddWallets() {
  if (!state.assets.selectedGroupId) return;
  openModal({
    kicker: t("钱包组管理", "Wallet-group management"),
    title: t("添加模拟钱包", "Add simulated wallets"),
    content: `<form class="form-stack" id="addWalletsForm"><label class="field-label">${t("添加数量", "Number to add")}<input class="field-input" name="count" type="number" min="1" max="200" value="1" required /></label><p>${t("钱包仅包含模拟公开地址和余额，不包含任何密钥材料。", "Wallets contain simulated public addresses and balances only, with no key material.")}</p><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit">${t("添加钱包", "Add wallets")}</button></div></form>`,
  });
}

function openLaunchImageGenerator(mode = "ai") {
  openModal({
    kicker: t("Cooking 图片", "Cooking image"),
    title: mode === "text" ? t("文生图", "Text to image") : t("AI 生图", "AI image generation"),
    content: `<form class="form-stack" id="launchImageGeneratorForm"><input type="hidden" name="mode" value="${mode}" /><label class="field-label">${t("画面描述", "Image prompt")}<textarea class="field-input" name="prompt" maxlength="1000" required placeholder="${t("描述角色、场景、风格和色彩", "Describe the character, scene, style, and colors")}"></textarea></label><label class="field-label">${t("画面比例", "Aspect ratio")}<select class="field-select" name="aspectRatio"><option value="1:1">1:1</option><option value="4:3">4:3</option><option value="16:9">16:9</option></select></label><p>${t("生成结果会自动进入发射图片，并在提交前完成元数据固定。", "The result will become the launch image and be pinned with token metadata before submission.")}</p><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit"><i class="fa-solid fa-wand-magic-sparkles"></i>${t("生成图片", "Generate image")}</button></div></form>`,
  });
}

function isFinancialCommand(value) {
  return /(钱包|转账|提取|发射|买入|卖出|wallet|transfer|withdraw|launch|buy|sell)/i.test(value);
}

function getAgentResponse(command) {
  if (/(dev-market|链上行情|dev 钱包|dev wallet)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "我已生成 Dev 钱包行情概览，按链汇总钱包标签、盈利比例和周期变化。",
      contentEn: "I generated a dev-wallet market overview with chain-level labels, profitability, and period changes.",
      suggestionZh: "选择目标链和对比日期后，可继续查看具体 Dev 钱包分组。",
      suggestionEn: "Choose a target chain and comparison period to inspect individual dev-wallet cohorts.",
      card: { type: "dev_market", statusZh: "模拟数据", statusEn: "Mock data" },
    };
  }

  if (/(narrative-trends|叙事信号趋势|narrative trend)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "我已汇总各条链近期发射 Meme 使用的叙事，并生成趋势与评分概览。",
      contentEn: "I summarized narratives used by recently launched memes across chains and produced a trend and scoring overview.",
      suggestionZh: "选择一个叙事，可继续拆解传播来源、历史市值和衰减速度。",
      suggestionEn: "Select a narrative to inspect propagation sources, historical market cap, and decay velocity.",
      card: { type: "narrative_trends", statusZh: "24 个叙事", statusEn: "24 narratives" },
    };
  }

  if (/(analyze-meme|分析 meme|meme 分析|合约地址)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "分析任务已建立。补充 Meme 合约地址后，将整理庄家集群、关联钱包和异常资金路径。",
      contentEn: "The analysis task is ready. Add a meme contract address to inspect operator clusters, linked wallets, and abnormal fund paths.",
      suggestionZh: "请提供 Solana 或 BSC 的 Meme 合约地址。",
      suggestionEn: "Provide a Solana or BSC meme contract address.",
      card: { type: "meme_analysis", statusZh: "等待合约地址", statusEn: "Awaiting contract" },
    };
  }

  if (/(recent-summary|近期总结|recent summary)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "我已整理近期用户发射、盈利表现以及 Dev 钱包与钱包组使用概览。",
      contentEn: "I summarized recent user launches, profitability, and dev-wallet and wallet-group activity.",
      suggestionZh: "选择时间范围后，可进一步查看单次发射和钱包组明细。",
      suggestionEn: "Choose a time range to inspect individual launches and wallet-group details.",
      card: { type: "recent_summary", statusZh: "近 30 天", statusEn: "Last 30 days" },
    };
  }

  if (/(社区|community|运营|operation)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "我已生成一份社区运营框架，覆盖首日内容节奏、Space 议题、创作活动和情绪监测。",
      contentEn: "I generated a community operations framework covering day-one content, Space topics, creator campaigns, and sentiment monitoring.",
      suggestionZh: "先确认目标社区与官方账号，再把计划连接到实时社交数据。",
      suggestionEn: "Confirm the target community and official accounts before connecting the plan to live social data.",
      card: { type: "community_plan" },
    };
  }

  if (/(meme|角色|视觉|素材)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "我已把叙事拆成角色、冲突、传播钩子和视觉母题，形成一份可继续补充的 Meme 构建包。",
      contentEn: "I split the narrative into character, conflict, propagation hooks, and a visual motif to create a reviewable meme build package.",
      suggestionZh: "补充名称、Token 符号和引用链接后，再生成正式素材。",
      suggestionEn: "Add the name, token symbol, and reference links before generating production assets.",
      card: { type: "meme_package" },
    };
  }

  if (/(发射|launch)/i.test(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "Launch Meme 草案已创建。它将组织目标链、发射平台、Dev 钱包、钱包组、X/网站绑定和钱包组买卖决策。",
      contentEn: "A Launch Meme draft is ready. It organizes the target chain, launchpad, dev wallet, wallet group, X/website binding, and wallet-group trading decisions.",
      suggestionZh: "先选择目标链并连接 Dev 钱包，再选择钱包组。",
      suggestionEn: "Choose the target chain and connect the dev wallet before selecting a wallet group.",
      card: { type: "launch_draft" },
    };
  }

  if (isFinancialCommand(command)) {
    return {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: "已生成模拟执行计划，未访问钱包、私钥、签名服务或链上节点。",
      contentEn: "A simulated execution plan is ready without accessing wallets, private keys, signing services, or chain nodes.",
      suggestionZh: "补充钱包组、网络、资产和金额，再交由人工审核。",
      suggestionEn: "Add the wallet group, network, asset, and amount before human review.",
      card: { type: "execution_plan" },
    };
  }

  return {
    role: "agent",
    timestamp: getMessageTime(),
    contentZh: "我已提取角色、冲突、传播钩子和可持续运营角度，并整理为一份可审阅的叙事快照。",
    contentEn: "I extracted the character, conflict, propagation hook, and sustainable operations angle into a reviewable narrative snapshot.",
    suggestionZh: "选择一个最强传播角度，再继续构建 Meme 素材。",
    suggestionEn: "Choose the strongest propagation angle before building the meme assets.",
    card: { type: "narrative_snapshot" },
  };
}

function submitAgentCommand(value) {
  const command = value.trim();
  if (!command) return;
  const pendingId = `pending-${Date.now()}`;
  state.conversation.push({ role: "user", content: command, timestamp: getMessageTime() });
  state.conversation.push({ role: "agent", pending: true, pendingId, timestamp: getMessageTime() });
  renderConversation();
  const input = document.querySelector("#agentInput");
  if (input) {
    input.value = "";
    input.style.height = "";
  }

  window.setTimeout(() => {
    const pendingIndex = state.conversation.findIndex((message) => message.pendingId === pendingId);
    if (pendingIndex !== -1) state.conversation.splice(pendingIndex, 1, getAgentResponse(command));
    renderConversation();
  }, 0);
}

function switchView(view) {
  if (!allowedViews.has(view)) return;
  state.view = view;
  window.location.hash = view;
  renderCurrentView();
  if (view === "assets" && !state.assets.portfolio && !state.assets.loading) loadAssets();
  if (view === "launch" && !state.assets.groups.length) loadLaunchGroups();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-trigger]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewTrigger));
});

document.querySelectorAll("[data-auth]").forEach((button) => {
  button.addEventListener("click", () => openAuth(button.dataset.auth));
});

notificationButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = !notificationMenu.classList.contains("hidden");
  notificationMenu.classList.toggle("hidden", isOpen);
  languageMenu.classList.add("hidden");
  notificationButton.setAttribute("aria-expanded", String(!isOpen));
});

languageButton.addEventListener("click", (event) => {
  event.stopPropagation();
  const isOpen = !languageMenu.classList.contains("hidden");
  languageMenu.classList.toggle("hidden", isOpen);
  notificationMenu.classList.add("hidden");
  languageButton.setAttribute("aria-expanded", String(!isOpen));
});

languageMenu.addEventListener("click", (event) => {
  const button = event.target.closest("[data-language]");
  if (!button) return;
  state.language = button.dataset.language;
  localStorage.setItem("narraops-language", state.language);
  languageMenu.classList.add("hidden");
  renderCurrentView();
});

themeButton.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "soft" : "dark";
  localStorage.setItem("narraops-theme", state.theme);
  updateTheme();
  requestAnimationFrame(drawVisibleCharts);
});

viewRoot.addEventListener("click", async (event) => {
  const opportunity = event.target.closest("[data-opportunity]");
  if (opportunity) {
    openOpportunity(opportunity.dataset.opportunity);
    return;
  }

  const goAction = event.target.closest("[data-go-action]")?.dataset.goAction;
  if (goAction === "history") {
    showToast(t("会话历史将在账户与数据库接入后开放。", "Conversation history will be available after account and database integration."));
    return;
  }
  if (goAction === "share") {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}#go`);
      showToast(t("Go 会话链接已复制。", "Go conversation link copied."));
    } catch {
      showToast(t("浏览器未授予剪贴板权限。", "Clipboard permission was not granted."));
    }
    return;
  }
  if (goAction === "close") {
    switchView("pulse");
    return;
  }
  if (goAction === "plus") {
    showToast(t("文件与链接上下文将在后端接入后开放。", "File and link context will be available after backend integration."));
    return;
  }
  const command = event.target.closest("[data-command]");
  if (command) {
    const input = document.querySelector("#agentInput");
    if (input) {
      input.value = `${command.dataset.command} `;
      input.focus();
    }
    return;
  }

  const platform = event.target.closest("[data-platform]");
  if (platform) {
    state.selectedPlatform = platform.dataset.platform;
    renderLaunch();
    return;
  }

  const launchWalletAction = event.target.closest("[data-launch-wallet]")?.dataset.launchWallet;
  if (launchWalletAction === "connect") {
    await connectRobinhoodWallet();
    return;
  }

  if (event.target.closest("[data-pons-launch]")) {
    const form = document.querySelector("#launchParameterForm");
    if (form) await submitPonsLaunch(form);
    return;
  }

  const imageAction = event.target.closest("[data-launch-image]")?.dataset.launchImage;
  if (imageAction === "library") {
    openModal({ kicker: t("Cooking 图片", "Cooking image"), title: t("图片库", "Image library"), content: `<div class="empty-state large"><i class="fa-regular fa-images"></i>${t("图片库将在对象存储接入后显示已上传和已生成的图片。", "Uploaded and generated images will appear after object storage is configured.")}</div><div class="modal-actions"><button class="primary-button" type="button" data-modal-action="close">${t("知道了", "Done")}</button></div>` });
    return;
  }
  if (imageAction === "text" || imageAction === "ai") {
    openLaunchImageGenerator(imageAction);
    return;
  }

  const period = event.target.closest("[data-asset-period]")?.dataset.assetPeriod;
  if (period) {
    state.assets.period = period;
    await loadAssets();
    return;
  }

  const walletGroup = event.target.closest("[data-wallet-group]")?.dataset.walletGroup;
  if (walletGroup) {
    state.assets.selectedGroupId = walletGroup;
    await loadAssets();
    return;
  }

  const setting = event.target.closest("[data-setting]");
  if (setting) {
    state.settings[setting.dataset.setting] = !state.settings[setting.dataset.setting];
    renderAssets();
    return;
  }

  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "scan") {
    showToast(t("模拟扫描已完成，未调用真实数据源。", "Simulated scan completed without live data sources."));
  } else if (action === "view-all") {
    showToast(t("完整机会库将在数据源接入后开放。", "The full opportunity library opens after source integration."));
  } else if (action === "copy-invite") {
    try {
      await navigator.clipboard.writeText("http://127.0.0.1:5188/app.html#invite");
      showToast(t("演示邀请链接已复制。", "Demo invite link copied."));
    } catch {
      showToast(t("浏览器未授予剪贴板权限。", "Clipboard permission was not granted."));
    }
  } else if (action === "language") {
    state.language = state.language === "zh" ? "en" : "zh";
    localStorage.setItem("narraops-language", state.language);
    renderCurrentView();
  } else if (action === "theme") {
    themeButton.click();
    renderCurrentView();
  } else if (action === "refresh-assets") {
    await loadAssets();
  } else if (action === "open-create-group") {
    openCreateGroup();
  } else if (action === "open-add-wallet") {
    openAddWallets();
  } else if (action === "open-transfer") {
    state.assets.transferOpen = true;
    state.assets.transferPreview = null;
    state.assets.transferResult = null;
    if (event.target.closest(".wallet-detail-panel") && state.assets.selectedGroupId) state.assets.transferSource = state.assets.selectedGroupId;
    else state.assets.transferSource = "login_wallet";
    state.assets.transferDestination = state.assets.groups.find((group) => group.groupId !== state.assets.transferSource)?.groupId || (state.assets.transferSource !== "login_wallet" ? "login_wallet" : null);
    renderAssets();
    document.querySelector(".transfer-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (action === "close-transfer") {
    state.assets.transferOpen = false;
    state.assets.transferPreview = null;
    renderAssets();
  } else if (action === "swap-transfer") {
    const previous = state.assets.transferSource;
    state.assets.transferSource = state.assets.transferDestination;
    state.assets.transferDestination = previous;
    state.assets.transferPreview = null;
    renderAssets();
  } else if (action === "deposit-disabled" || action === "withdraw-disabled") {
    showToast(t("真实充值与提取将在认证和签名服务接入后开放。", "Live deposit and withdrawal require authentication and signing services."));
  } else if (action === "confirm-transfer-plan") {
    const preview = state.assets.transferPreview;
    if (!preview) return;
    try {
      state.assets.transferBusy = true;
      const result = await apiRequest("/api/v1/transfers", { method: "POST", headers: { "Idempotency-Key": preview.idempotencyKey }, body: JSON.stringify({ previewToken: preview.previewToken, confirmationToken: preview.confirmationToken, idempotencyKey: preview.idempotencyKey }) });
      state.assets.transferResult = result;
      showToast(t("转账计划已保存，真实执行保持关闭。", "Transfer plan saved; live execution remains off."));
    } catch (error) { showToast(error.message); }
    finally { state.assets.transferBusy = false; renderAssets(); }
  }
});

viewRoot.addEventListener("submit", async (event) => {
  if (event.target.id === "assetTransferForm") {
    event.preventDefault();
    const idempotencyKey = crypto.randomUUID();
    state.assets.transferBusy = true;
    state.assets.transferPreview = null;
    state.assets.transferResult = null;
    renderAssets();
    try {
      const preview = await apiRequest("/api/v1/transfers/preview", { method: "POST", body: JSON.stringify({ source: transferEndpointValue(state.assets.transferSource), destination: transferEndpointValue(state.assets.transferDestination), amountMode: "fraction", fractionBps: state.assets.transferFraction * 100, distribution: "equal", idempotencyKey }) });
      state.assets.transferPreview = { ...preview, idempotencyKey };
    } catch (error) { showToast(error.message); }
    finally { state.assets.transferBusy = false; renderAssets(); }
    return;
  }
  if (event.target.id !== "agentForm") return;
  event.preventDefault();
  submitAgentCommand(document.querySelector("#agentInput")?.value || "");
});

modal.addEventListener("submit", async (event) => {
  if (event.target.id === "createWalletGroupForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const purpose = form.get("purpose");
      const group = await apiRequest("/api/v1/wallet-groups", { method: "POST", body: JSON.stringify({ name: form.get("name"), purpose, walletCount: purpose === "cooking" ? 1 : Number(form.get("walletCount")) }) });
      state.assets.selectedGroupId = group.groupId;
      closeModal();
      await loadAssets();
      showToast(t("钱包组已创建", "Wallet group created"));
    } catch (error) { showToast(error.message); }
  }
  if (event.target.id === "addWalletsForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      await apiRequest(`/api/v1/wallet-groups/${state.assets.selectedGroupId}/wallets`, { method: "POST", body: JSON.stringify({ count: Number(form.get("count")) }) });
      closeModal();
      await loadAssets();
      showToast(t("钱包已添加", "Wallets added"));
    } catch (error) { showToast(error.message); }
  }
  if (event.target.id === "launchImageGeneratorForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    state.launchMedia.generating = true;
    try {
      const result = await apiRequest("/api/v1/launch/images", { method: "POST", body: JSON.stringify({ prompt: form.get("prompt"), mode: form.get("mode"), aspectRatio: form.get("aspectRatio") }) });
      state.launchMedia.previewUrl = result.imageUrl;
      state.launchMedia.metadataUri = result.metadataUri || null;
      closeModal();
      renderLaunch();
    } catch (error) { showToast(error.message); }
    finally { state.launchMedia.generating = false; }
  }
});

modal.addEventListener("change", (event) => {
  if (event.target.id !== "walletGroupPurpose") return;
  const cooking = event.target.value === "cooking";
  const countField = modal.querySelector("#walletCountField");
  const countInput = countField?.querySelector("input");
  if (countField) countField.classList.toggle("hidden", cooking);
  if (countInput) {
    countInput.disabled = cooking;
    if (cooking) countInput.value = "1";
  }
});

viewRoot.addEventListener("keydown", (event) => {
  if (event.target.id !== "agentInput" || event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  event.target.form?.requestSubmit();
});

viewRoot.addEventListener("input", (event) => {
  if (event.target.id === "transferFraction") {
    state.assets.transferFraction = Number(event.target.value);
    state.assets.transferPreview = null;
    const label = document.querySelector("#transferPercent");
    if (label) label.textContent = `${state.assets.transferFraction}%`;
    return;
  }
  if (event.target.id !== "agentInput") return;
  event.target.style.height = "auto";
  event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
});

viewRoot.addEventListener("change", (event) => {
  if (event.target.id === "launchImageInput") {
    const [file] = event.target.files || [];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      showToast(t("图片不能超过 10MB。", "Images must be 10MB or smaller."));
      return;
    }
    if (state.launchMedia.previewUrl?.startsWith("blob:")) URL.revokeObjectURL(state.launchMedia.previewUrl);
    state.launchMedia.file = file;
    state.launchMedia.previewUrl = URL.createObjectURL(file);
    state.launchMedia.metadataUri = null;
    renderLaunch();
    return;
  }
  if (event.target.id === "transferSource") {
    state.assets.transferSource = event.target.value;
    if (state.assets.transferDestination === event.target.value) state.assets.transferDestination = event.target.value === "login_wallet" ? state.assets.groups[0]?.groupId : "login_wallet";
    state.assets.transferPreview = null;
    renderAssets();
  }
  if (event.target.id === "transferDestination") {
    state.assets.transferDestination = event.target.value;
    if (state.assets.transferSource === event.target.value) state.assets.transferSource = event.target.value === "login_wallet" ? state.assets.groups[0]?.groupId : "login_wallet";
    state.assets.transferPreview = null;
    renderAssets();
  }
});

modal.addEventListener("click", (event) => {
  const action = event.target.closest("[data-modal-action]")?.dataset.modalAction;
  if (action === "close") closeModal();
  if (action === "agent") {
    closeModal();
    switchView("go");
    window.setTimeout(() => {
      const input = document.querySelector("#agentInput");
      if (input) {
        input.value = "/narrative ";
        input.focus();
      }
    }, 0);
  }
});

modal.addEventListener("submit", (event) => {
  if (event.target.id !== "authForm") return;
  event.preventDefault();
  closeModal();
  showToast(t("认证尚未接入，未创建真实会话。", "Authentication is not connected; no real session was created."));
});

document.querySelector("#closeModalButton").addEventListener("click", closeModal);
modalBackdrop.addEventListener("click", closeModal);

document.addEventListener("click", (event) => {
  if (!event.target.closest(".action-menu-wrap")) {
    notificationMenu.classList.add("hidden");
    languageMenu.classList.add("hidden");
    notificationButton.setAttribute("aria-expanded", "false");
    languageButton.setAttribute("aria-expanded", "false");
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeModal();
    notificationMenu.classList.add("hidden");
    languageMenu.classList.add("hidden");
  }
});

window.addEventListener("hashchange", () => {
  state.view = getViewFromHash();
  renderCurrentView();
  if (state.view === "assets" && !state.assets.portfolio && !state.assets.loading) loadAssets();
  if (state.view === "launch" && !state.assets.groups.length) loadLaunchGroups();
});

let resizeTimer;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(drawVisibleCharts, 120);
});

updateTheme();
renderCurrentView();
if (state.view === "assets") loadAssets();
if (state.view === "launch") loadLaunchGroups();
