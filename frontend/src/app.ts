// @ts-nocheck
// Transitional TypeScript entrypoint. New modules must remain strict; this
// monolith is migrated incrementally while behavior is covered by regression tests.
import { apiRequest } from "./lib/api-client";
import { getSupabasePublicConfig } from "./lib/public-env";
import { getSupabaseClient } from "./lib/supabase-client";

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
const accountAssetsButton = document.querySelector("#accountAssetsButton");
const supabasePublicConfig = getSupabasePublicConfig();
const supabaseClient = getSupabaseClient();

Object.defineProperty(window, "NarraOpsRuntime", {
  value: {
    supabaseConfigured: supabasePublicConfig.configured,
    supabaseUrl: supabasePublicConfig.url || null,
  },
  configurable: false,
  enumerable: false,
  writable: false,
});

if (supabaseClient) {
  console.info("[NarraOps] Supabase public client configured.");
} else {
  console.info("[NarraOps] Supabase public client is not configured; static beta remains in frontend-only mode.");
}

const allowedViews = new Set(["pulse", "go", "assets"]);
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
  launchResult: (() => {
    try { return JSON.parse(sessionStorage.getItem("narraops-last-launch-result") || "null"); }
    catch { return null; }
  })(),
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
  auth: { loading: true, session: null, busy: false },
  pulse: {
    loading: false,
    error: null,
    dataStatus: "loading",
    observedAt: null,
    collector: null,
    limitations: [],
  },
  go: {
    pendingOpportunityId: null,
    busy: false,
  },
  assets: {
    mode: "mock",
    section: "pnl",
    networkFilter: "solana",
    period: "7d",
    portfolio: null,
    groups: [],
    loginWallets: [],
    selectedGroupId: null,
    wallets: [],
    loading: false,
    error: null,
    transferOpen: false,
    transferSource: "login_wallet",
    transferDestination: null,
    transferChain: "solana",
    transferExternalAddress: "",
    transferFraction: 25,
    transferAmountMode: "fraction",
    transferAmount: "",
    transferDistribution: "equal",
    transferPreview: null,
    transferResult: null,
    transferError: null,
    transferBusy: false,
    launchGroupsLoading: false,
    accountAssetChain: "solana",
  },
};

const translations = {
  login: ["登录", "Log in"],
  register: ["注册", "Create account"],
  notifications: ["通知", "Notifications"],
  newSignal: ["新的叙事信号", "New narrative signal"],
  newSignalBody: ["跨平台讨论速度进入加速区间。", "Cross-platform discussion velocity is accelerating."],
  simulationOnly: ["执行保护已开启", "Execution guard is active"],
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

const sampleOpportunities = [
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

let opportunities = [];

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
    <span class="simulation-pill"><i class="fa-solid fa-database" aria-hidden="true"></i>${t("样本信号", "Sample signals")}</span>
    <button class="secondary-button" type="button" data-action="scan"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> ${t("刷新样本", "Refresh samples")}</button>
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

function pulseViewModel(card) {
  const evidence = Array.isArray(card?.evidence) ? card.evidence : [];
  const missingEvidence = Array.isArray(card?.missingEvidence) ? card.missingEvidence : [];
  return {
    id: card.opportunityId,
    source: evidence.map((item) => item.publisher).filter(Boolean).join(" · ") || "Public evidence",
    icon: "fa-regular fa-newspaper",
    titleZh: card.title,
    titleEn: card.title,
    bodyZh: card.summary,
    bodyEn: card.summary,
    score: String(card.status || "review").toUpperCase(),
    momentum: String(evidence.length),
    reach: String(missingEvidence.length),
    evidence,
    missingEvidence,
    riskFlags: Array.isArray(card?.riskFlags) ? card.riskFlags : [],
    stage: card.stage || "unknown",
  };
}

function formatPulseObservedAt(value) {
  if (!value) return t("尚未获取", "Not available");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(state.language === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function loadPulse() {
  if (state.pulse.loading) return;
  state.pulse.loading = true;
  state.pulse.error = null;
  if (state.view === "pulse") renderPulseConnected();
  try {
    const payload = await apiRequest("/api/v1/pulse");
    opportunities = Array.isArray(payload.opportunities)
      ? payload.opportunities.map(pulseViewModel)
      : [];
    state.pulse.dataStatus = payload.data_status || "unavailable";
    state.pulse.observedAt = payload.observed_at || null;
    state.pulse.collector = payload.collector || null;
    state.pulse.limitations = Array.isArray(payload.limitations) ? payload.limitations : [];
  } catch (error) {
    opportunities = [];
    state.pulse.dataStatus = "unavailable";
    state.pulse.error = error instanceof Error ? error.message : String(error);
    state.pulse.collector = null;
    state.pulse.limitations = [];
  } finally {
    state.pulse.loading = false;
    if (state.view === "pulse") renderPulseConnected();
  }
}

function renderPulseConnected() {
  const collector = state.pulse.collector || {};
  const sourceCount = Number(collector.sourceCount || 0);
  const healthySourceCount = Number(collector.healthySourceCount || 0);
  const candidateCount = Number(collector.candidateCount || 0);
  const clusterCount = Number(collector.clusterCount || 0);
  const activeCandidateCount = Number(collector.activeCandidateCount || 0);
  const statusLabel = String(state.pulse.dataStatus || "loading").replaceAll("_", " ");
  const actions = `
    <span class="simulation-pill"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>${escapeHtml(statusLabel)}</span>
    <button class="secondary-button" type="button" data-action="scan" ${state.pulse.loading ? "disabled" : ""}>
      <i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i>
      ${state.pulse.loading ? t("正在读取", "Loading") : t("刷新证据", "Refresh evidence")}
    </button>
  `;
  const metrics = [
    ["fa-solid fa-satellite-dish", t("来源健康度", "Source health"), `${healthySourceCount}/${sourceCount}`, t("公开来源可用", "public sources available")],
    ["fa-solid fa-filter-circle-dollar", t("候选池", "Candidate pool"), String(candidateCount), `${clusterCount} ${t("个聚类", "clusters")}`],
    ["fa-solid fa-clipboard-check", t("审核发布", "Reviewed output"), String(opportunities.length), `${activeCandidateCount} ${t("条待审核", "queued")}`],
  ].map((card) => `
    <article class="signal-card">
      <div class="signal-topline">
        <span class="signal-name">${card[1]}</span>
        <span class="signal-icon"><i class="${card[0]}" aria-hidden="true"></i></span>
      </div>
      <div class="signal-value"><strong>${escapeHtml(card[2])}</strong></div>
      <div class="card-meta"><span>${escapeHtml(card[3])}</span><span>${escapeHtml(formatPulseObservedAt(state.pulse.observedAt))}</span></div>
    </article>
  `).join("");
  const opportunityCards = opportunities.map((item) => `
    <button class="opportunity-card" type="button" data-opportunity="${escapeHtml(item.id)}">
      <div class="opportunity-topline">
        <span class="opportunity-source"><span class="source-icon"><i class="${item.icon}" aria-hidden="true"></i></span><span class="source-pill">${escapeHtml(item.source)}</span></span>
        <span class="score-pill">${escapeHtml(item.score)}</span>
      </div>
      <h3>${escapeHtml(state.language === "zh" ? item.titleZh : item.titleEn)}</h3>
      <p>${escapeHtml(state.language === "zh" ? item.bodyZh : item.bodyEn)}</p>
      <div class="opportunity-footer">
        <span class="metric-stack"><span>${t("公开证据", "Public evidence")}</span><strong>${escapeHtml(item.momentum)}</strong></span>
        <span class="metric-stack"><span>${t("证据缺口", "Evidence gaps")}</span><strong>${escapeHtml(item.reach)}</strong></span>
      </div>
    </button>
  `).join("");
  const emptyState = state.pulse.loading
    ? `<div class="empty-state large"><i class="fa-solid fa-spinner fa-spin"></i>${t("正在读取已审核证据…", "Loading reviewed evidence…")}</div>`
    : state.pulse.error
      ? `<div class="empty-state large"><i class="fa-solid fa-triangle-exclamation"></i>${t("Pulse API 暂时不可用：", "Pulse API is unavailable: ")}${escapeHtml(state.pulse.error)}</div>`
      : `<div class="empty-state large"><i class="fa-regular fa-folder-open"></i>${t("当前没有通过人工审核的机会。", "No opportunities have passed manual review.")}</div>`;
  const limitationCards = (state.pulse.limitations.length ? state.pulse.limitations : [
    t("仅展示人工审核后的公开证据。", "Only manually reviewed public evidence is displayed."),
  ]).map((item) => `
    <article class="intel-card">
      <div class="intel-topline"><span class="signal-icon"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i></span></div>
      <h3>${t("证据边界", "Evidence boundary")}</h3>
      <p>${escapeHtml(item)}</p>
    </article>
  `).join("");

  viewRoot.innerHTML = `
    ${pageHeading(
      "Narra Pulse",
      t("发现下一条可验证叙事", "Discover the next verifiable narrative"),
      t("当前页面只发布已人工审核的公开证据，不展示虚构热度、评分或收益预测。", "This view publishes manually reviewed public evidence only—no fabricated heat, score, or profitability."),
      actions,
    )}
    <section aria-label="${t("采集状态", "Collector status")}"><div class="signal-grid">${metrics}</div></section>
    <section class="section-block">
      <div class="section-header"><div><h2>${t("已审核机会", "Reviewed opportunities")}</h2><p>${t("点击卡片查看证据来源、风险和缺口。", "Open a card to inspect sources, risks, and evidence gaps.")}</p></div></div>
      <div class="opportunity-grid">${opportunityCards || emptyState}</div>
    </section>
    <section class="section-block">
      <div class="section-header"><div><h2>${t("数据边界", "Data boundaries")}</h2><p>${t("尚未接入的信号会明确标注，不会用样本数据替代。", "Missing signals are stated explicitly and never replaced by sample data.")}</p></div></div>
      <div class="intel-grid">${limitationCards}</div>
    </section>
  `;
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
      contentZh: "Go 工作台已就绪。发送链接、文本或命令后，NarraOps 会返回结构化任务卡片和实时事件流。",
      contentEn: "Go is ready. Send a link, text, or command and NarraOps will return structured task cards and live event updates.",
    },
  ];
}

function renderStructuredCard(card) {
  if (!card) return "";
  const cardMeta = {
    narrative_snapshot: ["fa-solid fa-wave-square", "叙事快照", "Narrative Snapshot"],
    meme_package: ["fa-solid fa-shapes", "Meme 构建包", "Meme Build Package"],
    launch_draft: ["fa-solid fa-file-signature", "发射预案", "Launch-ready Plan"],
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

  const error = message.lifecycle === "failed" ? `
    <div class="go-agent-error"><strong>${t("任务失败", "Task failed")}</strong><span>${escapeHtml(message.error || t("Agent 服务当前不可用。", "The Agent service is currently unavailable."))}</span><button type="button" data-agent-retry>${t("重试", "Retry")}</button></div>
  ` : "";
  const cards = [...(message.cards || []), ...(message.card ? [message.card] : [])].map(renderStructuredCard).join("");
  return `${content ? `<p>${escapeHtml(content)}</p>` : ""}${suggestion}${cards}${error}`;
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
    ["/narrative-trends", "fa-solid fa-arrow-trend-up", "叙事趋势", "Narrative Trends", "查看正在加速的互联网叙事和证据来源。", "Review accelerating internet narratives and public evidence."],
    ["/analyze-meme", "fa-solid fa-magnifying-glass-chart", "分析叙事", "Analyze Narrative", "输入链接或合约，提取故事、来源、风险和重复度。", "Submit a link or contract to extract story, sources, risks, and crowding."],
    ["/launch", "fa-solid fa-file-signature", "生成预案", "Create Plan", "把选中的叙事转成可审阅的 Launch-ready Plan。", "Turn a selected narrative into a reviewable launch-ready plan."],
    ["/dev-market", "fa-solid fa-chart-line", "市场环境", "Market Context", "查看链上活跃度和同类 Meme 的历史样本。", "Review chain activity and historical comparable meme samples."],
    ["/recent-summary", "fa-solid fa-clock-rotate-left", "研究总结", "Research Summary", "总结近期查看、保存和待复核的叙事。", "Summarize recently viewed, saved, and pending narrative reviews."],
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
  const cookingGroup = state.assets.groups.find((group) => group.groupId === values.cookingWalletGroup && isCookingGroup(group));
  if (!cookingGroup) {
    showToast(t("请选择一个只包含 1 个钱包的 Cooking 钱包组。", "Select a Cooking wallet group containing exactly one wallet."));
    return;
  }
  const boundBuyEnabled = Boolean(values.buyingWalletGroup);
  const randomBoundBuy = values.buyAllocationMode === "TOTAL_RANDOM";
  const buyingGroup = state.assets.groups.find((group) => group.groupId === values.buyingWalletGroup && !isCookingGroup(group) && group.walletCount > 0);
  if (boundBuyEnabled && !buyingGroup) {
    showToast(t("请选择发射绑定买入的钱包组。", "Select the wallet group for launch-bound buying."));
    return;
  }
  const boundBuyInputAmount = randomBoundBuy ? values.boundBuyTotalAmount : values.boundBuyAmountPerWallet;
  if (boundBuyEnabled && !(Number(boundBuyInputAmount) > 0)) return showToast(t(randomBoundBuy ? "请输入大于 0 的钱包组买入总额。" : "请输入大于 0 的每钱包买入金额。", randomBoundBuy ? "Enter a wallet-group total greater than zero." : "Enter a per-wallet buy amount greater than zero."));
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
      `即将通过 Pons 工厂发射 ${values.tokenSymbol}。Cooking 钱包首笔买入 ${values.cookingBuyAmount || "0"} ETH，发射费 0.0005 ETH。${boundBuyEnabled ? `${buyingGroup.name} 将在 T1-T5 窗口${randomBoundBuy ? `随机拆分总额 ${values.boundBuyTotalAmount || "0"}` : `以每钱包 ${values.boundBuyAmountPerWallet || "0"}`} ETH 执行买入。` : ""}预估发射 Gas ${Number.parseInt(gas, 16).toLocaleString()}。`,
      `Launch ${values.tokenSymbol} through the Pons factory. The Cooking wallet buys ${values.cookingBuyAmount || "0"} ETH first, plus the 0.0005 ETH launch fee. ${boundBuyEnabled ? `${buyingGroup.name} will ${randomBoundBuy ? `randomly split a total of ${values.boundBuyTotalAmount || "0"}` : `buy ${values.boundBuyAmountPerWallet || "0"} per wallet`} ETH during T1-T5. ` : ""}Estimated launch gas: ${Number.parseInt(gas, 16).toLocaleString()}.`,
    ));
    if (!confirmed) return;
    const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ ...transaction, gas }] });
    sessionStorage.setItem("narraops-last-launch-tx", hash);
    sessionStorage.setItem("narraops-bound-buy-plan", JSON.stringify({
      launchTransactionHash: hash,
      platform: state.selectedPlatform,
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
  const cookingGroup = state.assets.groups.find((group) => group.groupId === values.cookingWalletGroup && isCookingGroup(group));
  const boundBuyEnabled = Boolean(values.buyingWalletGroup);
  const randomBoundBuy = values.buyAllocationMode === "TOTAL_RANDOM";
  const buyingGroup = state.assets.groups.find((group) => group.groupId === values.buyingWalletGroup && !isCookingGroup(group));
  if (!cookingGroup || (boundBuyEnabled && !buyingGroup)) return showToast(t("请选择 Cooking 钱包和发射绑定买入钱包组。", "Select a Cooking wallet and launch-bound-buy wallet group."));
  const boundBuyInputAmount = randomBoundBuy ? values.boundBuyTotalAmount : values.boundBuyAmountPerWallet;
  if (boundBuyEnabled && !(Number(boundBuyInputAmount) > 0)) return showToast(t(randomBoundBuy ? "请输入大于 0 的钱包组买入总额。" : "请输入大于 0 的每钱包买入金额。", randomBoundBuy ? "Enter a wallet-group total greater than zero." : "Enter a per-wallet buy amount greater than zero."));
  if (!state.launchMedia.file) return showToast(t("请上传 Cooking 图片。", "Upload a Cooking image."));
  const platform = state.selectedPlatform === "four" ? "fourmeme" : "pump";
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
      imageBase64: await fileToBase64(state.launchMedia.file), imageName: state.launchMedia.file.name, imageType: state.launchMedia.file.type,
      twitter: values.xUrl.trim(), telegram: values.telegramUrl.trim(), website: values.websiteUrl.trim(), developerBuyAmount: values.cookingBuyAmount || "0",
    };
    let prepared;
    try {
      prepared = await apiRequest("/api/v1/launch/executions/prepare", { method: "POST", body: JSON.stringify(launchPayload) });
    } catch (prepareError) {
      if (platform !== "pump" || prepareError.code !== "PUMP_METADATA_UPLOAD_FAILED") throw prepareError;
      const metadataUri = await uploadPumpMetadataFromBrowser(values, state.launchMedia.file);
      const { imageBase64, imageName, imageType, ...metadataPayload } = launchPayload;
      prepared = await apiRequest("/api/v1/launch/executions/prepare", { method: "POST", body: JSON.stringify({ ...metadataPayload, metadataUri }) });
    }
    const unit = state.selectedPlatform === "pump" ? "SOL" : "BNB";
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
      platformName: state.selectedPlatform === "four" ? "Four.Meme" : "Pump.fun",
      tokenAddress: result.tokenAddress || result.mintAddress,
    };
    state.launchResult = launchResult;
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

function renderLaunchResultCard() {
  const result = state.launchResult;
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

  const selected = platforms.find((platform) => platform.id === state.selectedPlatform);
  const launchWallet = state.launchWallet;
  const walletAddress = launchWallet.address
    ? `${launchWallet.address.slice(0, 7)}...${launchWallet.address.slice(-5)}`
    : t("未连接", "Not connected");
  const cookingGroups = state.assets.groups.filter(isCookingGroup);
  const cookingOptions = cookingGroups.map((group) => `<option value="${group.groupId}">${escapeHtml(group.name)} · ${t("1 个钱包", "1 wallet")}</option>`).join("");
  const buyingGroups = state.assets.groups.filter((group) => !isCookingGroup(group) && group.walletCount > 0);
  const buyingGroupOptions = buyingGroups.map((group) => `<option value="${group.groupId}">${escapeHtml(group.name)} · ${group.walletCount} ${t("个钱包", "wallets")}</option>`).join("");
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

function settingsToggle(key, label, description) {
  return `<div class="settings-row"><div><strong>${label}</strong><span>${description}</span></div><button class="toggle ${state.settings[key] ? "active" : ""}" type="button" data-setting="${key}" aria-pressed="${state.settings[key]}"></button></div>`;
}

function renderLegacySettings() {
  viewRoot.innerHTML = `
    ${pageHeading("Settings", t("配置来源、界面与安全边界", "Configure sources, interface, and safety boundaries"), t("所有设置仅保存在当前浏览器。", "All settings are stored only in this browser."), `<span class="simulation-pill"><i class="fa-solid fa-lock" aria-hidden="true"></i>${t("真实执行关闭", "Live execution off")}</span>`)}
    <div class="settings-grid">
      <section class="settings-panel"><h3>${t("监控来源", "Monitoring sources")}</h3><p>${t("选择 Pulse 与 Agent 可使用的数据来源。", "Choose data sources available to Pulse and Agent.")}</p><div class="settings-list">${settingsToggle("x", "X", t("推文与账号传播轨迹", "Posts and account propagation"))}${settingsToggle("tiktok", "TikTok", t("短视频趋势与模板扩散", "Short-video trends and template spread"))}${settingsToggle("instagram", "Instagram", t("视觉母题与创作者网络", "Visual motifs and creator networks"))}${settingsToggle("telegram", "Telegram", t("公开社区讨论", "Public community discussions"))}</div></section>
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

async function loadAssets({ keepGroup = true } = {}) {
  if (state.assets.loading) return;
  state.assets.loading = true;
  state.assets.error = null;
  renderAssets();
  try {
    const [portfolio, groupsResult, loginWalletResult] = await Promise.all([
      apiRequest(`/api/v1/account/portfolio?period=${state.assets.period}`),
      apiRequest("/api/v1/wallet-groups"),
      state.auth.session ? apiRequest("/api/v1/account/login-wallet-assets") : Promise.resolve({ wallets: [] }),
    ]);
    state.assets.portfolio = portfolio;
    state.assets.mode = groupsResult.mode || "mock";
    state.assets.groups = groupsResult.groups || [];
    state.assets.loginWallets = loginWalletResult.wallets || [];
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
  if (state.assets.launchGroupsLoading) return;
  state.assets.launchGroupsLoading = true;
  try {
    const result = await apiRequest("/api/v1/wallet-groups");
    state.assets.mode = result.mode || "mock";
    state.assets.groups = result.groups || [];
    if (state.view === "launch") renderLaunch();
  } catch (error) {
    showToast(error.message);
  } finally {
    state.assets.launchGroupsLoading = false;
  }
}

function isCookingGroup(group) {
  if (group.purpose === "cooking") return group.walletCount === 1;
  return !group.purpose && group.walletCount === 1;
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

function transferEndpointValue(value, direction = "destination") {
  if (value !== "login_wallet") return { type: "wallet_group", id: value };
  const chain = state.assets.transferChain;
  const identity = state.auth.session?.user?.identities?.find((item) => chain === "solana" ? item.chain === "solana" : item.chain === "evm");
  const address = direction === "source" ? identity?.address || "" : state.assets.transferExternalAddress.trim() || identity?.address || "";
  return { type: "login_wallet", ...(address ? { address } : {}) };
}

function nativeBalances(value = {}) {
  const rows = Object.entries(value).filter(([, amount]) => Number(amount) !== 0);
  return rows.length ? rows.map(([asset, amount]) => `${Number(amount).toLocaleString(undefined, { maximumFractionDigits: 9 })} ${asset}`).join(" · ") : "0 SOL · 0 BNB";
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
    <form id="assetTransferForm"><div class="transfer-route"><label class="field-label">${t("链", "Chain")}<select class="field-select" id="transferChain"><option value="solana" ${state.assets.transferChain === "solana" ? "selected" : ""}>Solana / SOL</option><option value="bsc" ${state.assets.transferChain === "bsc" ? "selected" : ""}>BSC / BNB</option></select></label><label class="field-label">${t("转出钱包组", "From wallet group")}<select class="field-select" id="transferSource">${state.assets.groups.map((group) => `<option value="${group.groupId}" ${source === group.groupId ? "selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}</select></label><label class="field-label">${t("转入对象", "To")}<select class="field-select" id="transferDestination">${transferEndpointOptions(destination, source)}</select></label></div>
      ${destination === "login_wallet" ? `<label class="field-label">${t("提现地址", "Withdrawal address")}<input class="field-input" id="transferExternalAddress" value="${escapeHtml(state.assets.transferExternalAddress)}" placeholder="${state.assets.transferChain === "solana" ? "Solana address" : "0x..."}" required /></label>` : ""}
      <div class="transfer-slider-block"><div><span>${t("转账比例", "Transfer ratio")}</span><strong id="transferPercent">${state.assets.transferFraction}%</strong></div><input id="transferFraction" type="range" min="1" max="100" value="${state.assets.transferFraction}" /><div class="slider-ticks"><span>1%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div></div>
      <div class="transfer-rule"><i class="fa-solid fa-shield-halved"></i><div><strong>${destination !== "login_wallet" ? t("钱包索引 1:1 配对", "1:1 wallet-index pairing") : t("提现到外部地址", "Withdraw to external address")}</strong><span>${t("预览不移动资金；只有再次确认后才会由加密钱包签名并广播。", "Preview does not move funds; encrypted wallets sign and broadcast only after final confirmation.")}</span></div></div>
      <div class="transfer-actions"><button class="secondary-button" type="button" data-action="close-transfer">${t("取消", "Cancel")}</button><button class="primary-button" type="submit" ${state.assets.transferBusy || !destination ? "disabled" : ""}><i class="fa-solid fa-eye"></i>${state.assets.transferBusy ? t("生成中…", "Planning…") : t("预览转账计划", "Preview transfer plan")}</button></div></form>
    ${preview ? `<div class="transfer-preview"><div class="transfer-preview-summary"><span><small>${t("预计金额", "Estimated amount")}</small><strong>${escapeHtml(preview.estimatedAmount)} ${escapeHtml(preview.currency)}</strong></span><span><small>${t("配对数量", "Pairs")}</small><strong>${preview.pairCount}</strong></span><span><small>${t("未匹配", "Unmatched")}</small><strong>${(preview.unmatchedSourceWalletIds?.length || 0) + (preview.unmatchedDestinationWalletIds?.length || 0)}</strong></span><span><small>${t("状态", "Status")}</small><strong>${t("等待最终确认", "Awaiting final confirmation")}</strong></span></div><div class="transfer-pair-list">${pairRows}</div><button class="primary-button transfer-confirm" type="button" data-action="confirm-transfer-plan">${t("确认签名并广播", "Confirm, sign and broadcast")}</button></div>` : ""}
    ${state.assets.transferResult ? `<div class="asset-state"><i class="fa-solid fa-circle-check"></i>${escapeHtml(state.assets.transferResult.status)}${state.assets.transferResult.txHash ? ` · ${escapeHtml(shortAddress(state.assets.transferResult.txHash))}` : ""}</div>` : ""}
  </section>`;
}

function renderAssetsLegacy() {
  const liveWallets = state.assets.mode === "encrypted_vault";
  const selectedGroup = state.assets.groups.find((group) => group.groupId === state.assets.selectedGroupId);
  const periods = ["1d", "7d", "30d", "all"].map((period) => `<button class="period-button ${state.assets.period === period ? "active" : ""}" type="button" data-asset-period="${period}">${period === "all" ? t("全部", "All") : period.toUpperCase()}</button>`).join("");
  const groupCards = state.assets.groups.map((group) => `<button class="wallet-group-card ${group.groupId === state.assets.selectedGroupId ? "active" : ""}" type="button" data-wallet-group="${group.groupId}"><span class="wallet-group-icon"><i class="fa-solid ${group.purpose === "cooking" ? "fa-fire-burner" : "fa-layer-group"}"></i></span><span><strong>${escapeHtml(group.name)}</strong><small>${group.purpose === "cooking" ? t("Cooking · 1 个钱包", "Cooking · 1 wallet") : `${group.walletCount} ${t("个钱包", "wallets")}`}</small></span><b>${escapeHtml(nativeBalances(group.balances))}</b></button>`).join("");
  const walletRows = state.assets.wallets.map((wallet) => `<tr><td><span class="wallet-label"><i class="fa-solid fa-wallet"></i><strong>${escapeHtml(wallet.label)}</strong></span></td><td><code title="${escapeHtml(wallet.addresses?.solana || "")}">SOL ${escapeHtml(shortAddress(wallet.addresses?.solana))}</code><br><code title="${escapeHtml(wallet.addresses?.bsc || "")}">BSC ${escapeHtml(shortAddress(wallet.addresses?.bsc))}</code></td><td>${Object.values(wallet.balances || {}).map((balance) => balance.status === "live" ? `${escapeHtml(balance.amount)} ${escapeHtml(balance.asset)}` : `${escapeHtml(balance.asset)} ${t("暂不可用", "unavailable")}`).join("<br>") || "—"}</td><td><span class="state-pill">${wallet.provisioningStatus === "active" ? t("已加密", "Encrypted") : t("模拟", "Simulation")}</span></td></tr>`).join("");
  const status = state.assets.loading ? `<div class="asset-state"><i class="fa-solid fa-circle-notch fa-spin"></i>${t("正在读取资产…", "Loading assets…")}</div>` : state.assets.error ? `<div class="asset-state error"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${t("资产服务未连接", "Asset service unavailable")}</strong><span>${escapeHtml(state.assets.error)}</span></div><button class="secondary-button" type="button" data-action="refresh-assets">${t("重试", "Retry")}</button></div>` : "";
  const totalWallets = state.assets.groups.reduce((sum, group) => sum + group.walletCount, 0);
  const portfolio = state.assets.portfolio;
  const loginWalletRows = state.assets.loginWallets.map((wallet) => {
    const balances = Object.values(wallet.balances || {}).map((balance) => balance.status === "live" ? `${escapeHtml(balance.amount)} ${escapeHtml(balance.asset)}` : `${escapeHtml(balance.asset)} ${t("暂不可用", "unavailable")}`).join(" · ") || t("未读取到余额", "Balance unavailable");
    return `<div class="login-wallet-row"><span><i class="fa-solid fa-link"></i><strong>${wallet.chain === "solana" ? "Solana" : "EVM / BSC"}</strong><code title="${escapeHtml(wallet.address)}">${escapeHtml(shortAddress(wallet.address))}</code></span><b>${balances}</b></div>`;
  }).join("");
  const loginWalletCard = state.auth.session
    ? `<section class="asset-overview-panel"><div class="asset-section-heading"><div><span>${t("个人资产", "Personal assets")}</span><h2>${t("登录钱包", "Login wallet")}</h2></div><span class="state-pill">${t("链上实时", "Live on-chain")}</span></div><div class="login-wallet-list">${loginWalletRows || `<div class="empty-state">${t("未发现登录钱包", "No login wallet found")}</div>`}</div></section>`
    : `<section class="asset-overview-panel"><div class="asset-section-heading"><div><span>${t("个人资产", "Personal assets")}</span><h2>${t("连接钱包", "Connected wallet")}</h2></div><button class="compact-button" type="button" data-action="login-web3">${t("连接", "Connect")}</button></div><div class="empty-state">${t("连接后显示钱包地址及真实 SOL / BNB 余额。", "Connect to display your wallet address and live SOL / BNB balance.")}</div></section>`;
  viewRoot.innerHTML = `
    ${pageHeading("Assets", t("个人资产与钱包组", "Personal assets and wallet groups"), liveWallets ? t("真实多链钱包已在本地加密仓中创建。", "Real multi-chain wallets are stored in the encrypted vault.") : t("统一查看账户表现、钱包组资产与执行准备。", "Review account performance, wallet-group assets, and execution preparation."), `<span class="simulation-pill"><i class="fa-solid fa-shield-halved"></i>${liveWallets ? t("真实钱包 · 加密保存", "Real wallets · Encrypted") : t("执行准备 · 真实执行关闭", "Execution prep · Live execution off")}</span><button class="secondary-button" type="button" data-action="refresh-assets"><i class="fa-solid fa-arrows-rotate"></i>${t("刷新", "Refresh")}</button>`)}
    ${status}
    ${loginWalletCard}
    <section class="asset-overview-panel account-wallet-card"><div class="account-wallet-tabs"><strong>${t("钱包", "Wallets")} (${totalWallets})</strong><div class="period-switcher">${periods}</div></div><div class="account-balance"><span>${t("链上总余额", "Total on-chain balances")}</span><strong>${portfolio ? escapeHtml(nativeBalances(portfolio.balances)) : "—"}</strong></div><div class="account-profit-grid"><span><small>${t("数据来源", "Data source")}</small><strong>${portfolio?.dataStatus === "live_native_balances" ? t("链上 RPC 实时读取", "Live chain RPC") : "—"}</strong></span><span><small>${t("成交额", "Turnover")}</small><strong>—</strong></span><span><small>${t("已实现盈亏", "Realized P&L")}</small><strong>—</strong></span><span><small>${t("未实现盈亏", "Unrealized P&L")}</small><strong>—</strong></span></div><div class="account-wallet-actions"><button type="button" data-action="deposit-disabled"><i class="fa-solid fa-arrow-down"></i><span>${t("充值", "Deposit")}</span></button><button type="button" data-action="withdraw-disabled"><i class="fa-solid fa-arrow-up"></i><span>${t("提取", "Withdraw")}</span></button><button type="button" data-action="open-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i><span>${t("转账", "Transfer")}</span></button></div></section>
    ${renderTransferPanel()}
    <section class="wallet-groups-layout">
      <div class="wallet-groups-panel"><div class="asset-section-heading"><div><span>${t("钱包组资产", "Wallet-group assets")}</span><h2>${t("钱包组", "Wallet groups")}</h2></div><button class="compact-button" type="button" data-action="open-create-group"><i class="fa-solid fa-plus"></i>${t("新建", "New")}</button></div><div class="wallet-group-list">${groupCards || `<div class="empty-state">${t("还没有钱包组", "No wallet groups yet")}</div>`}</div></div>
      <div class="wallet-detail-panel"><div class="asset-section-heading"><div><span>${t("钱包组管理", "Wallet-group management")}</span><h2>${selectedGroup ? escapeHtml(selectedGroup.name) : t("选择钱包组", "Select a wallet group")}</h2></div>${selectedGroup && selectedGroup.purpose !== "cooking" ? `<button class="compact-button" type="button" data-action="open-add-wallet"><i class="fa-solid fa-plus"></i>${t("添加钱包", "Add wallets")}</button>` : ""}</div>${selectedGroup ? `<div class="wallet-group-metrics"><span><small>${t("钱包数量", "Wallets")}</small><strong>${selectedGroup.walletCount}</strong></span><span><small>${t("组内资产", "Group assets")}</small><strong>${escapeHtml(nativeBalances(selectedGroup.balances))}</strong></span><span><small>${t("钱包组用途", "Group purpose")}</small><strong>${selectedGroup.purpose === "cooking" ? "Cooking" : t("常规", "General")}</strong></span></div><div class="wallet-table-wrap"><table class="wallet-table"><thead><tr><th>${t("钱包", "Wallet")}</th><th>${t("公开地址", "Public address")}</th><th>${t("链上余额", "On-chain balance")}</th><th>${t("状态", "Status")}</th></tr></thead><tbody>${walletRows || `<tr><td colspan="4" class="empty-state">${t("该组暂无钱包", "No wallets in this group")}</td></tr>`}</tbody></table></div>` : `<div class="empty-state large"><i class="fa-solid fa-layer-group"></i>${t("选择一个钱包组查看明细", "Select a wallet group to view details")}</div>`}</div>
    </section>`;
  const addWalletButton = viewRoot.querySelector('[data-action="open-add-wallet"]');
  if (addWalletButton) addWalletButton.insertAdjacentHTML("beforebegin", `<button class="compact-button" type="button" data-action="open-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i>${t("转账", "Transfer")}</button>`);
}

function sumAssetBalance(asset) {
  let total = 0;
  for (const wallet of state.assets.loginWallets) {
    for (const balance of Object.values(wallet.balances || {})) if (balance.asset === asset && balance.status === "live") total += Number(balance.amount || 0);
  }
  for (const group of state.assets.groups) total += Number(group.balances?.[asset] || 0);
  return total;
}

function transferSourceBalance() {
  const unit = state.assets.transferChain === "solana" ? "SOL" : "BNB";
  if (state.assets.transferSource === "login_wallet") return Number(accountWalletBalance(state.assets.transferChain).amount || 0);
  const group = state.assets.groups.find(({ groupId }) => groupId === state.assets.transferSource);
  return Number(group?.balances?.[unit] || 0);
}

function estimatedTransferAmount() {
  const estimate = transferSourceBalance() * state.assets.transferFraction / 100;
  return Number.isFinite(estimate) ? estimate.toLocaleString(undefined, { maximumFractionDigits: 9 }) : "0";
}

function splitAtomicAmount(total, count, distribution) {
  const weights = Array.from({ length: count }, (_, index) => distribution === "random" ? BigInt(index + 1) : 1n);
  const weightTotal = weights.reduce((sum, value) => sum + value, 0n);
  const amounts = weights.map((weight) => total * weight / weightTotal);
  let remainder = total - amounts.reduce((sum, value) => sum + value, 0n);
  for (let index = 0; remainder > 0n; index = (index + 1) % amounts.length) { amounts[index] += 1n; remainder -= 1n; }
  return amounts;
}

async function previewLoginWalletDistribution(idempotencyKey) {
  const groupId = state.assets.transferDestination;
  const group = state.assets.groups.find(({ groupId: id }) => id === groupId);
  if (!group) throw new Error(t("请选择接收钱包组", "Select a destination wallet group"));
  const result = await apiRequest(`/api/v1/wallet-groups/${groupId}/wallets`);
  const chain = state.assets.transferChain;
  const currency = chain === "solana" ? "SOL" : "BNB";
  const decimals = chain === "solana" ? 9 : 18;
  const destinations = (result.wallets || []).map((wallet) => ({ walletId: wallet.walletId, address: chain === "solana" ? wallet.addresses?.solana : wallet.addresses?.bsc })).filter(({ address }) => address);
  if (!destinations.length) throw new Error(t("接收钱包组没有可用地址", "The destination group has no usable addresses"));
  const available = accountWalletBalance(chain).amount || "0";
  const availableAtomic = decimalToAtomic(String(available), decimals);
  let totalAtomic = state.assets.transferAmountMode === "amount" ? decimalToAtomic(state.assets.transferAmount, decimals) : availableAtomic * BigInt(state.assets.transferFraction * 100) / 10_000n;
  if (chain === "solana" && totalAtomic >= availableAtomic) totalAtomic = availableAtomic > 5000n ? availableAtomic - 5000n : 0n;
  if (totalAtomic <= 0n || totalAtomic > availableAtomic) throw new Error(t("转账数量超过可用余额", "Transfer amount exceeds the available balance"));
  const amounts = splitAtomicAmount(totalAtomic, destinations.length, state.assets.transferDistribution);
  const scale = 10n ** BigInt(decimals);
  const format = (atomic) => { const fraction = String(atomic % scale).padStart(decimals, "0").replace(/0+$/, ""); return `${atomic / scale}${fraction ? `.${fraction}` : ""}`; };
  const identity = state.auth.session?.user?.identities?.find((item) => chain === "solana" ? item.chain === "solana" : item.chain === "evm");
  return { clientSigned: true, previewToken: crypto.randomUUID(), confirmationToken: crypto.randomUUID(), idempotencyKey, chain, currency, estimatedAmount: format(totalAtomic), pairCount: destinations.length, unmatchedSourceWalletIds: [], unmatchedDestinationWalletIds: [], allocations: destinations.map((destination, index) => ({ sourceWalletId: "login_wallet", destinationWalletId: destination.walletId, from: identity?.address, to: destination.address, amount: format(amounts[index]), atomic: amounts[index].toString() })) };
}

async function submitLoginWalletDistribution(preview) {
  if (preview.chain === "solana") {
    const source = preview.allocations[0]?.from;
    const providers = [window.okxwallet?.solana, window.phantom?.solana, window.solflare].filter(Boolean);
    let provider = providers.find((item) => item?.publicKey?.toString() === source);
    if (!provider) {
      for (const candidate of providers) {
        try {
          const connected = await candidate.connect();
          const publicKey = connected?.publicKey?.toString() || candidate.publicKey?.toString();
          if (publicKey === source) { provider = candidate; break; }
        } catch {}
      }
    }
    if (!provider || !window.solanaWeb3) throw new Error(t("请在当前 Solana 登录钱包中确认交易", "Confirm the transaction in the connected Solana wallet"));
    const transaction = new window.solanaWeb3.Transaction();
    for (const allocation of preview.allocations) transaction.add(window.solanaWeb3.SystemProgram.transfer({ fromPubkey: new window.solanaWeb3.PublicKey(source), toPubkey: new window.solanaWeb3.PublicKey(allocation.to), lamports: BigInt(allocation.atomic) }));
    const latest = await apiRequest("/api/v1/chains/solana/latest-blockhash");
    transaction.recentBlockhash = latest.blockhash;
    transaction.feePayer = new window.solanaWeb3.PublicKey(source);
    if (typeof provider.signTransaction === "function") {
      const signed = await provider.signTransaction(transaction);
      return await apiRequest("/api/v1/chains/solana/send-transaction", { method: "POST", body: JSON.stringify({ signedTransactionBase64: bytesToBase64(signed.serialize()) }) });
    }
    const result = await provider.signAndSendTransaction(transaction);
    return { signature: result?.signature || result, txHash: result?.signature || result, status: "submitted", confirmed: false };
  }
  if (preview.allocations.length !== 1) throw new Error(t("BSC 登录钱包批量分发需要批量合约，当前只能向一个地址发送", "BSC login-wallet distribution requires the batch contract; only one destination is currently supported"));
  const allocation = preview.allocations[0];
  const provider = await activeEvmProvider(allocation.from);
  if (!provider) throw new Error(t("请切换到当前 BSC 登录钱包", "Switch to the connected BSC wallet"));
  return provider.request({ method: "eth_sendTransaction", params: [{ from: allocation.from, to: allocation.to, value: `0x${BigInt(allocation.atomic).toString(16)}` }] });
}

function transferErrorMessage(error) {
  if (!error) return "";
  if (error.details?.signature) return `${error.message} · ${shortAddress(error.details.signature)}`;
  return error.message || String(error);
}

function transferResultMessage(result) {
  const transactions = Array.isArray(result?.transactions) ? result.transactions : [];
  const failed = transactions.filter((item) => item.status === "failed");
  const succeeded = transactions.filter((item) => item.status !== "failed");
  if (failed.length > 0) {
    const first = failed[0]?.error?.message || failed[0]?.error?.code || result?.error?.message || t("部分转账失败", "Some transfers failed");
    return {
      tone: succeeded.length > 0 ? "warn" : "error",
      text: succeeded.length > 0
        ? `${t("部分完成", "Partially completed")}：${succeeded.length}/${transactions.length} · ${first}`
        : `${t("转账失败", "Transfer failed")}：${first}`,
    };
  }
  const txHashes = [...new Set(transactions.map((item) => item.txHash).filter(Boolean))];
  return {
    tone: "success",
    text: `${t("转账已广播", "Transfer broadcasted")}：${transactions.length || 1} ${t("笔", "transfers")}${txHashes[0] ? ` · ${shortAddress(txHashes[0])}` : ""}`,
  };
}

function setCompactTransferStatus(message, tone = "info") {
  const container = modalBody.querySelector(".compact-transfer-preview");
  if (!container) return;
  let status = container.querySelector(".compact-transfer-status");
  if (!status) {
    status = document.createElement("div");
    status.className = "compact-transfer-status";
    container.appendChild(status);
  }
  status.dataset.tone = tone;
  status.textContent = message;
}

async function executeTransferPreview(preview) {
  if (!preview || state.assets.transferBusy) return;
  state.assets.transferBusy = true;
  state.assets.transferError = null;
  const button = modalBody.querySelector('[data-action="confirm-transfer-plan"]');
  if (button) {
    button.disabled = true;
    button.textContent = t("正在签名并广播…", "Signing and broadcasting…");
  }
  setCompactTransferStatus(t("正在提交链上交易，请等待返回结果。", "Submitting on-chain transaction. Waiting for result."), "info");
  try {
    const result = preview.clientSigned
      ? await submitLoginWalletDistribution(preview)
      : await apiRequest("/api/v1/transfers", {
          method: "POST",
          headers: { "Idempotency-Key": preview.idempotencyKey },
          body: JSON.stringify({ previewToken: preview.previewToken, confirmationToken: preview.confirmationToken, idempotencyKey: preview.idempotencyKey }),
        });
    state.assets.transferResult = result;
    const message = transferResultMessage(result);
    setCompactTransferStatus(message.text, message.tone);
    await loadAssets({ keepGroup: true });
  } catch (error) {
    state.assets.transferError = error;
    setCompactTransferStatus(transferErrorMessage(error), "error");
    console.error("asset transfer failed", error);
  } finally {
    state.assets.transferBusy = false;
    if (button) {
      button.disabled = false;
      button.textContent = t("确认签名并广播", "Confirm, sign and broadcast");
    }
  }
}

function accountWallet(chain = state.assets.accountAssetChain) {
  return state.assets.loginWallets.find((wallet) => chain === "solana" ? wallet.chain === "solana" : wallet.chain !== "solana") || null;
}

function accountWalletBalance(chain = state.assets.accountAssetChain) {
  const wallet = accountWallet(chain);
  const unit = chain === "solana" ? "SOL" : "BNB";
  const balance = Object.values(wallet?.balances || {}).find((item) => item.asset === unit && item.status === "live");
  return { wallet, unit, amount: balance?.amount || "0" };
}

function accountChainOptions(chain) {
  return `<option value="solana" ${chain === "solana" ? "selected" : ""}>Solana · SOL</option><option value="bsc" ${chain === "bsc" ? "selected" : ""}>BSC · BNB</option>`;
}

function openAccountAssets(mode = "overview") {
  const chain = state.assets.accountAssetChain;
  const { wallet, unit, amount } = accountWalletBalance(chain);
  const address = wallet?.address || "";
  const selector = `<label class="account-chain-select"><span>${t("链", "Network")}</span><select class="field-select" id="accountAssetChain">${accountChainOptions(chain)}</select></label>`;
  if (mode === "deposit") {
    openModal({ kicker: t("账户资产", "Account assets"), title: t("充币", "Deposit"), content: `<div class="account-asset-flow" data-account-mode="deposit">${selector}<div class="account-address-card"><span>${t("充币地址", "Deposit address")}</span><strong>${address ? escapeHtml(address) : t("未连接该链地址", "No address connected for this network")}</strong>${address ? `<button type="button" data-copy-address="${escapeHtml(address)}"><i class="fa-regular fa-copy"></i>${t("复制", "Copy")}</button>` : ""}</div><div class="account-asset-balance"><span>${t("当前余额", "Current balance")}</span><strong>${escapeHtml(amount)} ${unit}</strong></div><button class="primary-button account-wide-action" type="button" data-modal-action="close">${t("完成", "Done")}</button></div>` });
    return;
  }
  if (mode === "withdraw") {
    openModal({ kicker: t("账户资产", "Account assets"), title: t("提取", "Withdraw"), content: `<form class="account-asset-flow" id="accountWithdrawForm" data-account-mode="withdraw">${selector}<label class="account-input-block"><span>${t("目标地址", "Destination address")}</span><input class="field-input" name="destination" required placeholder="${chain === "solana" ? "Solana address" : "0x..."}" /></label><label class="account-input-block"><span>${t("数量", "Amount")}</span><div class="account-amount-input"><input class="field-input" name="amount" id="accountWithdrawAmount" inputmode="decimal" required placeholder="0.00" /><b>${unit}</b><button type="button" data-account-all="${escapeHtml(amount)}">${t("全部", "All")}</button></div></label><div class="account-available"><span>${t("可提取", "Available")}</span><strong>${escapeHtml(amount)} ${unit}</strong></div><button class="primary-button account-wide-action" type="submit" ${wallet ? "" : "disabled"}>${t("提取", "Withdraw")}</button></form>` });
    return;
  }
  const sol = accountWalletBalance("solana");
  const bsc = accountWalletBalance("bsc");
  openModal({ kicker: t("登录钱包", "Connected wallet"), title: t("账户资产", "Account assets"), content: `<div class="account-asset-overview"><div class="account-address-summary"><span>${t("已连接资产", "Connected assets")}</span><strong>${sol.amount} SOL · ${bsc.amount} BNB</strong></div><div class="account-wallet-lines"><span><b>Solana</b><code>${sol.wallet ? escapeHtml(shortAddress(sol.wallet.address)) : "—"}</code><strong>${sol.amount} SOL</strong></span><span><b>BSC</b><code>${bsc.wallet ? escapeHtml(shortAddress(bsc.wallet.address)) : "—"}</code><strong>${bsc.amount} BNB</strong></span></div><div class="account-asset-actions"><button class="primary-button" type="button" data-account-action="deposit"><i class="fa-solid fa-arrow-down"></i>${t("充币", "Deposit")}</button><button class="secondary-button" type="button" data-account-action="withdraw"><i class="fa-solid fa-arrow-up"></i>${t("提取", "Withdraw")}</button></div></div>` });
}

function decimalToAtomic(value, decimals) {
  const normalized = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(t("请输入正确的数量", "Enter a valid amount"));
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) throw new Error(t("数量精度过高", "Amount has too many decimal places"));
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function activeEvmProvider(address) {
  const candidates = [window.okxwallet?.ethereum, window.binancew3w?.ethereum, ...(window.ethereum?.providers || []), window.ethereum].filter(Boolean);
  for (const provider of [...new Set(candidates)]) {
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      if (accounts.some((item) => item.toLowerCase() === address.toLowerCase())) return provider;
    } catch {}
  }
  return null;
}

async function submitAccountWithdrawal(chain, destination, amount) {
  const { wallet, amount: available } = accountWalletBalance(chain);
  if (!wallet) throw new Error(t("未连接该链地址", "No address connected for this network"));
  const decimals = chain === "solana" ? 9 : 18;
  const atomicAmount = decimalToAtomic(amount, decimals);
  if (atomicAmount <= 0n) throw new Error(t("提取数量必须大于 0", "Withdrawal amount must be greater than zero"));
  if (atomicAmount > decimalToAtomic(available, decimals)) throw new Error(t("提取数量超过可用余额", "Withdrawal amount exceeds the available balance"));
  if (chain === "bsc") {
    const provider = await activeEvmProvider(wallet.address);
    if (!provider) throw new Error(t("请在当前浏览器钱包中切换到该 BSC 地址", "Switch your browser wallet to this BSC address"));
    const chainId = await provider.request({ method: "eth_chainId" });
    if (Number.parseInt(chainId, 16) !== 56) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] });
    return provider.request({ method: "eth_sendTransaction", params: [{ from: wallet.address, to: destination, value: `0x${atomicAmount.toString(16)}` }] });
  }
  const providers = [window.okxwallet?.solana, window.phantom?.solana, window.solflare].filter(Boolean);
  const provider = providers.find((item) => item.publicKey?.toString() === wallet.address);
  if (!provider || !window.solanaWeb3) throw new Error(t("请在当前浏览器钱包中切换到该 Solana 地址", "Switch your browser wallet to this Solana address"));
  const transaction = new window.solanaWeb3.Transaction().add(window.solanaWeb3.SystemProgram.transfer({ fromPubkey: new window.solanaWeb3.PublicKey(wallet.address), toPubkey: new window.solanaWeb3.PublicKey(destination), lamports: atomicAmount }));
  const latest = await apiRequest("/api/v1/chains/solana/latest-blockhash");
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = new window.solanaWeb3.PublicKey(wallet.address);
  return provider.signAndSendTransaction(transaction);
}

const nativeAssetImages = {
  SOL: "https://solana.com/zh/src/img/branding/solanaLogoMark.png",
};

function renderPnlAnalysis(network, unit) {
  const periods = ["1d", "3d", "7d", "30d", "90d"].map((period) => `<button type="button" class="${state.assets.period === period ? "active" : ""}" data-asset-period="${period}">${period === "30d" ? t("1月", "1M") : period === "90d" ? t("3月", "3M") : period.toUpperCase()}</button>`).join("");
  return `<div class="pnl-toolbar-periods">${periods}</div><section class="pnl-metric-grid">
    <article><span>${t("已实现收益", "Realized P&L")} <i class="fa-regular fa-circle-question"></i></span><strong>+0 ${unit}</strong><div class="pnl-flat-line"></div><footer><small>${t("总收益", "Total P&L")}</small><b>+0 ${unit} (0.00%)</b><small>${t("未实现收益", "Unrealized P&L")}</small><b>+0 ${unit}</b></footer></article>
    <article><span>${t("收益最高的代币", "Top-performing token")} <i class="fa-regular fa-circle-question"></i></span><strong>+0 ${unit} <small>0.00%</small></strong><div class="empty-bars"><i></i><i></i><i></i></div></article>
    <article><span>${t("胜率", "Win rate")} <i class="fa-regular fa-circle-question"></i></span><strong>0.00%</strong><div class="pnl-distribution"><header><span>${t("单币收益率", "Token return")}</span><span>${t("币种数", "Tokens")}</span></header><span>&gt;500% <b>0</b></span><span>0% ~ 500% <b>0</b></span><span>-50% ~ 0% <b>0</b></span><span>&lt;-50% <b>0</b></span></div></article>
    <article><span>${t("买入/卖出交易", "Buy / sell trades")}</span><strong>0 <small>|</small> 0</strong><div class="pnl-turnover"><small>${t("成交额", "Turnover")}</small><i></i><span>${t("买入", "Buy")} 0 ${unit}</span><span>${t("卖出", "Sell")} 0 ${unit}</span><small>${t("平均每笔买入", "Average buy")}</small><b>0 ${unit}</b></div></article>
    <article><span>${t("偏好的代币市值", "Preferred token market cap")} <i class="fa-regular fa-circle-question"></i></span><strong>&lt;$100K</strong><div class="pnl-market-cap"><header><span>${t("市值", "Market cap")}</span><span>${t("买入次数", "Buys")}</span></header><span>&lt;$100K <b>0</b></span><span>$100K ~ $1M <b>0</b></span><span>$1M ~ $10M <b>0</b></span><span>$10M ~ $100M <b>0</b></span><span>&gt;$100M <b>0</b></span></div></article>
  </section><div class="pnl-ledger-tabs"><button class="active">${t("近期收益", "Recent P&L")}</button><button>${t("活跃仓位", "Active positions")}</button><button>DEX ${t("订单", "orders")}</button><button>${t("发射代币", "Launched tokens")}</button><span><i class="fa-solid fa-arrows-rotate"></i>${t("发射账本实时更新", "Launch ledger live")}</span></div><div class="pnl-empty-ledger"><i class="fa-solid fa-chart-pie"></i><strong>${t("暂无发射盈亏记录", "No launch P&L records")}</strong><span>${t("完成真实发射或绑定买入后，这里会按 Meme 项目汇总所有相关钱包的盈亏。", "After a live launch or bound buy, P&L is aggregated by Meme project across every participating wallet.")}</span></div>`;
}

function renderAssets() {
  const network = state.assets.networkFilter === "bsc" ? "bsc" : "solana";
  const unit = network === "solana" ? "SOL" : "BNB";
  const total = sumAssetBalance(unit);
  const selectedGroup = state.assets.groups.find((group) => group.groupId === state.assets.selectedGroupId);
  const visibleGroups = state.assets.groups.filter((group) => network === "solana" ? group.network === "solana" : group.network === "evm");
  const groupRows = visibleGroups.map((group) => `<tr class="${group.groupId === state.assets.selectedGroupId ? "selected-row" : ""}"><td><button class="group-name-button" type="button" data-wallet-group="${group.groupId}"><i class="fa-solid ${group.purpose === "cooking" ? "fa-fire-burner" : "fa-layer-group"}"></i><span><strong>${escapeHtml(group.name)}</strong><small>${group.purpose === "cooking" ? "Cooking" : t("常规", "General")}</small></span></button></td><td><span class="network-badge">${network === "solana" ? "SOL" : "EVM"}</span></td><td>${group.walletCount}</td><td>${escapeHtml(group.balances?.[unit] || "0")} ${unit}</td><td>${group.executionMode === "encrypted_vault" ? t("真实钱包", "Live wallets") : t("模拟", "Simulation")}</td><td><button class="table-action" type="button" data-wallet-group="${group.groupId}">${t("管理", "Manage")}</button></td></tr>`).join("");
  const walletRows = state.assets.wallets.map((wallet) => { const address = walletAddressForGroup(wallet, selectedGroup); const balance = Object.values(wallet.balances || {}).find((item) => item.asset === unit); return `<tr><td><strong>${escapeHtml(wallet.label)}</strong></td><td><code>${escapeHtml(shortAddress(address || "—"))}</code></td><td>${escapeHtml(balance?.amount || "0")} ${unit}</td><td><span class="state-pill">${wallet.provisioningStatus === "active" ? t("已加密", "Encrypted") : t("模拟", "Simulation")}</span></td></tr>`; }).join("");
  const nativeImage = nativeAssetImages[unit];
  const assetRows = total > 0 ? `<tr><td><span class="compact-token">${nativeImage ? `<img src="${nativeImage}" alt="${unit}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}<strong>${unit}</strong></span></td><td>${total.toLocaleString(undefined,{maximumFractionDigits:9})}</td><td>≈ ${total.toLocaleString(undefined,{maximumFractionDigits:9})} ${unit}</td><td><span class="asset-share-bar"><i style="width:100%"></i></span>100%</td></tr>` : "";
  viewRoot.innerHTML = `<div class="compact-assets-page assets-v3"><header class="compact-assets-header"><div><span>ASSETS</span><h1>${t("资产", "Assets")}</h1></div><button class="secondary-button" type="button" data-action="refresh-assets"><i class="fa-solid fa-arrows-rotate"></i>${t("刷新", "Refresh")}</button></header>
  <nav class="asset-primary-tabs"><button class="${state.assets.section === "pnl" ? "active" : ""}" type="button" data-assets-section="pnl">${t("盈亏分析", "P&L analysis")}</button><button class="${state.assets.section === "portfolio" ? "active" : ""}" type="button" data-assets-section="portfolio">${t("资产组合", "Portfolio")}</button><button class="${state.assets.section === "groups" ? "active" : ""}" type="button" data-assets-section="groups">${t("钱包组", "Wallet groups")}</button></nav>
  <div class="asset-toolbar"><select class="compact-select" id="assetNetworkFilter"><option value="solana" ${network === "solana" ? "selected" : ""}>Solana</option><option value="bsc" ${network === "bsc" ? "selected" : ""}>BSC</option></select><span class="balance-chip">${t("总余额", "Total balance")}: <strong>${total.toLocaleString(undefined,{maximumFractionDigits:9})} ${unit}</strong></span>${state.assets.section === "portfolio" ? `<span class="balance-chip">${t("代币数", "Tokens")}: <strong>${total > 0 ? 1 : 0}</strong></span>` : ""}<div class="toolbar-spacer"></div>${state.assets.section === "groups" ? `<button class="compact-button" type="button" data-action="open-export"><i class="fa-solid fa-file-export"></i>${t("导出", "Export")}</button><button class="compact-button" type="button" data-action="open-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i>${t("转账", "Transfer")}</button><button class="primary-button compact" type="button" data-action="open-create-group"><i class="fa-solid fa-plus"></i>${t("新建钱包组", "New group")}</button>` : ""}</div>
  ${state.assets.section === "pnl" ? renderPnlAnalysis(network, unit) : state.assets.section === "portfolio" ? `<section class="compact-data-panel portfolio-only-assets"><div class="compact-panel-tabs"><button class="active">${t("币种", "Assets")}</button><button>${t("交易历史", "History")}</button><span>${t("当前仅包含已验证的链上资产", "Verified on-chain assets only")}</span></div><div class="compact-table-wrap"><table class="compact-asset-table"><thead><tr><th>${t("资产", "Asset")}</th><th>${t("余额", "Balance")}</th><th>${t("折合", "Value")}</th><th>${t("资产占比", "Allocation")}</th></tr></thead><tbody>${assetRows || `<tr><td colspan="4" class="empty-state">${t(`暂无 ${unit} 网络资产`, `No ${unit} assets`)}</td></tr>`}</tbody></table></div></section>` : `<section class="compact-data-panel"><div class="compact-panel-tabs"><strong>${t("钱包组", "Wallet groups")} (${visibleGroups.length})</strong><span>${network === "solana" ? "Solana" : "EVM / BSC"}</span></div><div class="compact-table-wrap"><table class="compact-asset-table"><thead><tr><th>${t("名称", "Name")}</th><th>${t("网络", "Network")}</th><th>${t("钱包数", "Wallets")}</th><th>${t("余额", "Balance")}</th><th>${t("状态", "Status")}</th><th>${t("操作", "Action")}</th></tr></thead><tbody>${groupRows || `<tr><td colspan="6" class="empty-state">${t("暂无该网络的钱包组", "No wallet groups on this network")}</td></tr>`}</tbody></table></div>${selectedGroup && visibleGroups.some((group) => group.groupId === selectedGroup.groupId) ? `<div class="compact-group-detail"><div class="detail-heading"><div><span>${unit} · ${selectedGroup.purpose === "cooking" ? "Cooking" : t("常规", "General")}</span><h2>${escapeHtml(selectedGroup.name)}</h2></div><div><button class="compact-button" type="button" data-action="deposit-disabled">${t("充值", "Deposit")}</button><button class="compact-button" type="button" data-action="open-transfer">${t("转账", "Transfer")}</button>${selectedGroup.purpose !== "cooking" ? `<button class="compact-button" type="button" data-action="open-add-wallet">${t("添加钱包", "Add wallet")}</button>` : ""}</div></div><div class="compact-table-wrap"><table class="compact-asset-table"><thead><tr><th>${t("钱包", "Wallet")}</th><th>${t("地址", "Address")}</th><th>${t("链上余额", "On-chain balance")}</th><th>${t("状态", "Status")}</th></tr></thead><tbody>${walletRows}</tbody></table></div></div>` : ""}</section>`}</div>`;
}

function renderCurrentView() {
  viewRoot.classList.toggle("go-workspace-root", state.view === "go");
  updateNavigation();
  applyStaticTranslations();
  if (state.view === "go") renderGo();
  else if (state.view === "assets") renderAssets();
  else renderPulseConnected();
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

function openPulseOpportunity(id) {
  const item = opportunities.find((opportunity) => opportunity.id === id);
  if (!item) return;
  const evidence = (item.evidence || []).map((record) => `
    <li>
      <a href="${escapeHtml(record.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(record.publisher || record.title || "Source")}</a>
      <small>${escapeHtml(record.title || "")}</small>
    </li>
  `).join("");
  const missing = (item.missingEvidence || []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
  const risks = (item.riskFlags || []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join("");
  openModal({
    kicker: `${escapeHtml(item.source)} ? ${t("????", "Evidence brief")}`,
    title: state.language === "zh" ? item.titleZh : item.titleEn,
    content: `
      <p>${escapeHtml(state.language === "zh" ? item.bodyZh : item.bodyEn)}</p>
      <div class="modal-metrics">
        <div class="modal-metric"><span>${t("????", "Review status")}</span><strong>${escapeHtml(item.score)}</strong></div>
        <div class="modal-metric"><span>${t("????", "Public evidence")}</span><strong>${escapeHtml(item.momentum)}</strong></div>
        <div class="modal-metric"><span>${t("????", "Evidence gaps")}</span><strong>${escapeHtml(item.reach)}</strong></div>
      </div>
      <h3>${t("????", "Evidence sources")}</h3>
      <ul>${evidence || `<li>${t("??????", "No public evidence")}</li>`}</ul>
      ${risks ? `<h3>${t("????", "Risk flags")}</h3><ul>${risks}</ul>` : ""}
      ${missing ? `<h3>${t("????", "Missing evidence")}</h3><ul>${missing}</ul>` : ""}
      <div class="modal-actions">
        <button class="secondary-button" type="button" data-modal-action="close">${t("??", "Close")}</button>
        <button class="primary-button" type="button" data-modal-action="agent" data-opportunity-id="${escapeHtml(item.id)}"><i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> ${t("?? Go ??", "Analyze in Go")}</button>
      </div>
    `,
  });
}

async function openAuth(mode) {
  if (mode === "logout") {
    await apiRequest("/api/v1/auth/logout", { method: "POST", body: "{}" });
    state.auth.session = null;
    state.assets.loginWallets = [];
    updateAuthButtons();
    if (state.view === "assets") await loadAssets();
    showToast(t("已退出登录", "Signed out"));
    return;
  }
  openModal({ kicker: t("安全连接", "Secure connection"), title: t("连接钱包", "Connect wallet"), content: `<p>${t("选择你常用的钱包。连接后仅签署一次性登录消息，不会创建交易或产生费用。", "Choose your wallet. You will only sign a one-time login message; no transaction or fee is involved.")}</p><div class="wallet-connect-list"><span>${t("钱包", "Wallets")}</span><button type="button" data-web3-login="okx"><img class="wallet-brand" src="https://www.okx.com/favicon.ico" alt="OKX Wallet" /><strong>OKX Wallet</strong><small>${t("连接", "Connect")}</small><i class="fa-solid fa-chevron-right"></i></button><button type="button" data-web3-login="binance"><img class="wallet-brand" src="https://public.bnbstatic.com/static/images/common/favicon.ico" alt="Binance Wallet" /><strong>Binance Wallet</strong><small>${t("连接", "Connect")}</small><i class="fa-solid fa-chevron-right"></i></button><button type="button" data-web3-login="phantom"><img class="wallet-brand" src="https://docs.phantom.com/resources/images/Phantom_SVG_Icon.svg" alt="Phantom" /><strong>Phantom</strong><small>${t("连接", "Connect")}</small><i class="fa-solid fa-chevron-right"></i></button><button type="button" data-web3-login="metamask"><img class="wallet-brand" src="https://metamask.io/favicon.ico" alt="MetaMask" /><strong>MetaMask</strong><small>${t("连接", "Connect")}</small><i class="fa-solid fa-chevron-right"></i></button><button type="button" data-web3-login="solflare"><img class="wallet-brand" src="https://solflare.com/favicon.ico" alt="Solflare" /><strong>Solflare</strong><small>${t("连接", "Connect")}</small><i class="fa-solid fa-chevron-right"></i></button></div><div class="wallet-connect-note"><i class="fa-solid fa-shield-halved"></i>${t("NarraOps 不会读取助记词或私钥。", "NarraOps never reads your seed phrase or private key.")}</div>` });
}

function groupNetworkLabel(group) {
  if (group.network === "solana") return "SOL";
  if (group.network === "evm") return "EVM";
  return t("多链", "Multi-chain");
}

function walletAddressForGroup(wallet, group) {
  return group?.network === "solana" ? wallet.addresses?.solana : wallet.addresses?.bsc || wallet.addresses?.robinhood || wallet.addresses?.solana;
}

function renderAssetsCompactLegacy() {
  const selectedGroup = state.assets.groups.find((group) => group.groupId === state.assets.selectedGroupId);
  const visibleGroups = state.assets.groups.filter((group) => state.assets.networkFilter === "all" || group.network === state.assets.networkFilter || group.network === "multi");
  const loginRows = state.assets.loginWallets.filter((wallet) => state.assets.networkFilter === "all" || (state.assets.networkFilter === "solana" ? wallet.chain === "solana" : wallet.chain !== "solana")).map((wallet) => {
    const live = Object.values(wallet.balances || {}).filter((item) => item.status === "live");
    return live.map((balance) => `<tr><td><span class="compact-token"><i class="fa-solid ${wallet.chain === "solana" ? "fa-sun" : "fa-link"}"></i><strong>${escapeHtml(balance.asset)}</strong></span></td><td>${wallet.chain === "solana" ? "Solana" : "EVM"}</td><td><code>${escapeHtml(shortAddress(wallet.address))}</code></td><td><strong>${escapeHtml(balance.amount)} ${escapeHtml(balance.asset)}</strong></td><td><span class="state-pill">${t("链上", "Live")}</span></td><td><button class="table-action" type="button" data-action="open-transfer">${t("转账", "Transfer")}</button></td></tr>`).join("");
  }).join("");
  const groupAssetRows = visibleGroups.map((group) => `<tr><td><span class="compact-token"><i class="fa-solid fa-layer-group"></i><strong>${escapeHtml(group.name)}</strong></span></td><td>${groupNetworkLabel(group)}</td><td>${group.walletCount} ${t("个钱包", "wallets")}</td><td><strong>${escapeHtml(nativeBalances(group.balances))}</strong></td><td><span class="state-pill">${group.executionMode === "encrypted_vault" ? t("已加密", "Encrypted") : t("模拟", "Simulation")}</span></td><td><button class="table-action" type="button" data-wallet-group="${group.groupId}">${t("查看", "View")}</button></td></tr>`).join("");
  const groupRows = visibleGroups.map((group) => `<tr class="${group.groupId === state.assets.selectedGroupId ? "selected-row" : ""}"><td><button class="group-name-button" type="button" data-wallet-group="${group.groupId}"><i class="fa-solid ${group.purpose === "cooking" ? "fa-fire-burner" : "fa-layer-group"}"></i><span><strong>${escapeHtml(group.name)}</strong><small>${group.purpose === "cooking" ? "Cooking" : t("常规", "General")}</small></span></button></td><td><span class="network-badge">${groupNetworkLabel(group)}</span></td><td>${group.walletCount}</td><td>${escapeHtml(nativeBalances(group.balances))}</td><td>${group.executionMode === "encrypted_vault" ? t("真实钱包", "Live wallets") : t("模拟", "Simulation")}</td><td><button class="table-action" type="button" data-wallet-group="${group.groupId}">${t("管理", "Manage")}</button></td></tr>`).join("");
  const walletRows = state.assets.wallets.map((wallet) => { const address = walletAddressForGroup(wallet, selectedGroup); return `<tr><td><strong>${escapeHtml(wallet.label)}</strong></td><td><code title="${escapeHtml(address || "")}">${escapeHtml(shortAddress(address || "—"))}</code></td><td>${Object.values(wallet.balances || {}).map((balance) => `${escapeHtml(balance.amount || "0")} ${escapeHtml(balance.asset)}`).join(" · ") || "—"}</td><td><span class="state-pill">${wallet.provisioningStatus === "active" ? t("已加密", "Encrypted") : t("模拟", "Simulation")}</span></td></tr>`; }).join("");
  const identity = state.auth.session?.user?.identities?.[0];
  const total = state.assets.portfolio ? nativeBalances(state.assets.portfolio.balances) : "—";
  viewRoot.innerHTML = `<div class="compact-assets-page">
    <header class="compact-assets-header"><div><span>ASSETS</span><h1>${t("资产", "Assets")}</h1></div><div class="compact-header-actions"><button class="secondary-button" type="button" data-action="refresh-assets"><i class="fa-solid fa-arrows-rotate"></i>${t("刷新", "Refresh")}</button></div></header>
    ${state.assets.error ? `<div class="asset-state error">${escapeHtml(state.assets.error)}</div>` : ""}
    <nav class="asset-primary-tabs"><button class="${state.assets.section === "portfolio" ? "active" : ""}" type="button" data-assets-section="portfolio">${t("资产组合", "Portfolio")}</button><button class="${state.assets.section === "groups" ? "active" : ""}" type="button" data-assets-section="groups">${t("钱包组", "Wallet groups")}</button></nav>
    <div class="asset-toolbar"><select class="compact-select" id="assetAccountFilter"><option>${identity ? escapeHtml(shortAddress(identity.address)) : t("连接钱包", "Connect wallet")}</option></select><select class="compact-select" id="assetNetworkFilter"><option value="all" ${state.assets.networkFilter === "all" ? "selected" : ""}>${t("全部网络", "All networks")}</option><option value="solana" ${state.assets.networkFilter === "solana" ? "selected" : ""}>Solana</option><option value="evm" ${state.assets.networkFilter === "evm" ? "selected" : ""}>EVM</option></select><span class="balance-chip">${t("总余额", "Total balance")}: <strong>${escapeHtml(total)}</strong></span><div class="toolbar-spacer"></div>${state.assets.section === "portfolio" ? `<button class="compact-button" type="button" data-action="deposit-disabled"><i class="fa-solid fa-arrow-down"></i>${t("充值", "Deposit")}</button><button class="compact-button" type="button" data-action="withdraw-disabled"><i class="fa-solid fa-arrow-up"></i>${t("提现", "Withdraw")}</button><button class="primary-button compact" type="button" data-action="open-transfer"><i class="fa-solid fa-arrow-right-arrow-left"></i>${t("转账", "Transfer")}</button>` : `<button class="primary-button compact" type="button" data-action="open-create-group"><i class="fa-solid fa-plus"></i>${t("新建钱包组", "New group")}</button>`}</div>
    ${state.assets.section === "portfolio" ? `<section class="compact-data-panel"><div class="compact-panel-tabs"><button class="active">${t("币种", "Assets")}</button><button>${t("交易历史", "History")}</button><span>${t("链上余额实时读取", "Live on-chain balances")}</span></div><div class="compact-table-wrap"><table class="compact-asset-table"><thead><tr><th>${t("资产", "Asset")}</th><th>${t("网络", "Network")}</th><th>${t("地址 / 钱包组", "Address / group")}</th><th>${t("余额", "Balance")}</th><th>${t("状态", "Status")}</th><th>${t("操作", "Action")}</th></tr></thead><tbody>${loginRows}${groupAssetRows}${!loginRows && !groupAssetRows ? `<tr><td colspan="6" class="empty-state">${t("暂无资产", "No assets")}</td></tr>` : ""}</tbody></table></div></section>` : `<section class="compact-data-panel"><div class="compact-panel-tabs"><strong>${t("钱包组", "Wallet groups")} (${visibleGroups.length})</strong><span>${t("每个钱包组只属于一条链", "Each group belongs to one network")}</span></div><div class="compact-table-wrap"><table class="compact-asset-table"><thead><tr><th>${t("名称", "Name")}</th><th>${t("网络", "Network")}</th><th>${t("钱包数", "Wallets")}</th><th>${t("余额", "Balance")}</th><th>${t("状态", "Status")}</th><th>${t("操作", "Action")}</th></tr></thead><tbody>${groupRows || `<tr><td colspan="6" class="empty-state">${t("暂无钱包组", "No wallet groups")}</td></tr>`}</tbody></table></div>${selectedGroup ? `<div class="compact-group-detail"><div class="detail-heading"><div><span>${groupNetworkLabel(selectedGroup)} · ${selectedGroup.purpose === "cooking" ? "Cooking" : t("常规", "General")}</span><h2>${escapeHtml(selectedGroup.name)}</h2></div><div><button class="compact-button" type="button" data-action="deposit-disabled">${t("充值", "Deposit")}</button><button class="compact-button" type="button" data-action="open-transfer">${t("转账", "Transfer")}</button>${selectedGroup.purpose !== "cooking" ? `<button class="compact-button" type="button" data-action="open-add-wallet">${t("添加钱包", "Add wallet")}</button>` : ""}</div></div><div class="compact-table-wrap"><table class="compact-asset-table"><thead><tr><th>${t("钱包", "Wallet")}</th><th>${t("地址", "Address")}</th><th>${t("链上余额", "On-chain balance")}</th><th>${t("状态", "Status")}</th></tr></thead><tbody>${walletRows || `<tr><td colspan="4" class="empty-state">${t("暂无钱包", "No wallets")}</td></tr>`}</tbody></table></div></div>` : ""}</section>`}
  </div>`;
}

function updateAuthButtons() {
  const primary = document.querySelector("[data-auth]");
  const identity = state.auth.session?.user?.identities?.[0];
  if (identity) {
    primary.dataset.auth = "logout";
    primary.innerHTML = `<i class="fa-solid fa-wallet"></i>${shortAddress(identity.address)}`;
  } else {
    primary.dataset.auth = "web3";
    primary.innerHTML = `<i class="fa-solid fa-wallet"></i>${t("连接", "Connect")}`;
  }
}

async function loadAuthSession() {
  try { const result = await apiRequest("/api/v1/auth/session"); state.auth.session = result.authenticated ? result : null; }
  catch { state.auth.session = null; }
  finally {
    state.auth.loading = false;
    updateAuthButtons();
    if (state.auth.session && !state.auth.session.user.onboardingCompleted) window.setTimeout(openOnboarding, 250);
  }
}

function walletProvider(walletId) {
  if (walletId === "okx") return { chain: "evm", provider: window.okxwallet?.ethereum || window.okxwallet };
  if (walletId === "binance") return { chain: "evm", provider: window.binancew3w?.ethereum || window.BinanceChain || window.ethereum?.providers?.find((item) => item.isBinance || item.isBinanceWallet) };
  if (walletId === "metamask") return { chain: "evm", provider: window.ethereum?.providers?.find((item) => item.isMetaMask && !item.isPhantom) || (window.ethereum?.isMetaMask ? window.ethereum : null) };
  if (walletId === "phantom") return { chain: "solana", provider: window.phantom?.solana };
  if (walletId === "solflare") return { chain: "solana", provider: window.solflare };
  return { chain: "evm", provider: window.ethereum };
}

function openOnboarding() {
  openModal({ kicker: "NarraOps", title: t("欢迎来到叙事发现工作台", "Welcome to the narrative discovery workspace"), content: `<p class="onboarding-lead">${t("NarraOps 帮助 Meme Dev 发现、筛选和解释可 Meme 化的互联网叙事，并把高潜力叙事转成可审阅的发射预案。", "NarraOps helps meme devs discover, filter, and explain memeable internet narratives, then turn high-potential narratives into reviewable launch-ready plans.")}</p><div class="onboarding-grid"><article><i class="fa-solid fa-wave-square"></i><strong>Pulse</strong><span>${t("查看叙事机会、公开证据、风险和机会状态。", "Review narrative opportunities, public evidence, risks, and opportunity status.")}</span></article><article><i class="fa-solid fa-wand-magic-sparkles"></i><strong>Go</strong><span>${t("把链接、文本或 Pulse 机会转成固定 Schema 的预案。", "Turn links, text, or Pulse opportunities into fixed-schema plans.")}</span></article><article><i class="fa-solid fa-wallet"></i><strong>Assets</strong><span>${t("管理钱包组、资产视图和执行准备，真实执行默认关闭。", "Manage wallet groups, asset views, and execution preparation with live execution disabled by default.")}</span></article></div><button class="primary-button onboarding-start" type="button" data-modal-action="complete-onboarding">${t("我知道了，开始使用", "Got it, start using NarraOps")}</button>` });
}

async function linkSolanaIdentity(provider) {
  if (!provider?.connect || !provider?.signMessage) return false;
  const connection = await provider.connect();
  const address = (connection.publicKey || provider.publicKey).toString();
  if (state.auth.session?.user?.identities?.some((identity) => identity.address === address)) return true;
  const challenge = await apiRequest("/api/v1/auth/web3/challenge", { method: "POST", body: JSON.stringify({ chain: "solana", address }) });
  const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
  const bytes = signed.signature || signed;
  const signature = btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""));
  state.auth.session = await apiRequest("/api/v1/auth/web3/link", { method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, signature }) });
  return true;
}

async function web3Login(walletId) {
  if (state.auth.busy) return;
  state.auth.busy = true;
  try {
    const selection = walletProvider(walletId);
    const chain = selection.chain;
    let address; let chainId; let signature;
    if (chain === "evm") {
      const provider = selection.provider;
      if (!provider) throw new Error(t("未检测到该钱包，请确认扩展已安装并启用。", "Wallet not detected. Make sure the extension is installed and enabled."));
      [address] = await provider.request({ method: "eth_requestAccounts" });
      chainId = Number.parseInt(await provider.request({ method: "eth_chainId" }), 16);
      const challenge = await apiRequest("/api/v1/auth/web3/challenge", { method: "POST", body: JSON.stringify({ chain, address, chainId }) });
      signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] });
      state.auth.session = await apiRequest("/api/v1/auth/web3/verify", { method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, signature }) });
      if (walletId === "okx" && window.okxwallet?.solana) {
        try { await linkSolanaIdentity(window.okxwallet.solana); }
        catch { showToast(t("钱包已连接，但 SOL 地址关联未完成，请重新连接后确认两次签名。", "Wallet connected, but the SOL address was not linked. Reconnect and approve both signatures.")); }
      }
    } else {
      const provider = selection.provider;
      if (!provider?.connect || !provider?.signMessage) throw new Error(t("未检测到该钱包，请确认扩展已安装并启用。", "Wallet not detected. Make sure the extension is installed and enabled."));
      const connection = await provider.connect();
      address = (connection.publicKey || provider.publicKey).toString();
      const challenge = await apiRequest("/api/v1/auth/web3/challenge", { method: "POST", body: JSON.stringify({ chain, address }) });
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), "utf8");
      const bytes = signed.signature || signed;
      signature = btoa(Array.from(bytes, (value) => String.fromCharCode(value)).join(""));
      state.auth.session = await apiRequest("/api/v1/auth/web3/verify", { method: "POST", body: JSON.stringify({ challengeId: challenge.challengeId, signature }) });
    }
    closeModal();
    updateAuthButtons();
    if (state.view === "assets") await loadAssets();
    showToast(t("钱包登录成功", "Wallet sign-in successful"));
    if (!state.auth.session.user.onboardingCompleted) window.setTimeout(openOnboarding, 180);
  } catch (error) { showToast(error.message); }
  finally { state.auth.busy = false; }
}

function openCreateGroup() {
  openModal({
    kicker: t("钱包组管理", "Wallet-group management"),
    title: t("新建钱包组", "Create wallet group"),
    content: `<form class="form-stack" id="createWalletGroupForm"><label class="field-label">${t("钱包组名称", "Group name")}<input class="field-input" name="name" maxlength="48" required placeholder="${t("例如：核心发射组", "e.g. Core launch")}" /></label><label class="field-label">${t("网络", "Network")}<select class="field-select" name="network" required><option value="solana">Solana</option><option value="evm">EVM</option></select></label><p>${t("钱包组创建后固定为单一网络，避免跨链地址混在同一组中。", "A group is permanently assigned to one network so addresses never mix across chains.")}</p><label class="field-label">${t("钱包组用途", "Group purpose")}<select class="field-select" name="purpose" id="walletGroupPurpose"><option value="general">${t("常规钱包组", "General wallet group")}</option><option value="cooking">${t("Cooking 钱包组", "Cooking wallet group")}</option></select></label><label class="field-label" id="walletCountField">${t("初始钱包数量", "Initial wallet count")}<input class="field-input" name="walletCount" type="number" min="1" max="100" value="3" required /></label><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit">${t("创建钱包组", "Create group")}</button></div></form>`,
  });
}

function openTransferDialog(destination = null) {
  if (!state.assets.groups.length) return showToast(t("请先创建钱包组", "Create a wallet group first"));
  const chainNetwork = state.assets.transferChain === "solana" ? "solana" : "evm";
  const compatible = state.assets.groups.filter((group) => group.network === chainNetwork || group.network === "multi");
  if (!compatible.some((group) => group.groupId === state.assets.transferSource) && state.assets.transferSource !== "login_wallet") state.assets.transferSource = compatible[0]?.groupId || "login_wallet";
  if (destination) state.assets.transferDestination = destination;
  if (!state.assets.transferDestination || state.assets.transferDestination === state.assets.transferSource || !compatible.some((group) => group.groupId === state.assets.transferDestination)) state.assets.transferDestination = compatible.find((group) => group.groupId !== state.assets.transferSource)?.groupId || "login_wallet";
  const source = state.assets.transferSource;
  const target = state.assets.transferDestination;
  const sourceGroup = compatible.find((group) => group.groupId === source);
  const targetGroup = compatible.find((group) => group.groupId === target);
  const route = source === "login_wallet" ? "1 → N" : target === "login_wallet" ? "N → 1" : "N → N";
  const routeText = source === "login_wallet" ? t("登录钱包向钱包组分发", "Login wallet distributes to a group") : target === "login_wallet" ? t("钱包组归集到登录钱包", "Group consolidates to the login wallet") : t("钱包组按序一一对应", "Groups pair wallets by index");
  const endpointOptions = (selected, excluded) => `<option value="login_wallet" ${selected === "login_wallet" ? "selected" : ""} ${excluded === "login_wallet" ? "disabled" : ""}>${t("登录钱包", "Login wallet")}</option>${compatible.map((group) => `<option value="${group.groupId}" ${selected === group.groupId ? "selected" : ""} ${excluded === group.groupId ? "disabled" : ""}>${escapeHtml(group.name)} · ${group.walletCount}</option>`).join("")}`;
  const amountControl = state.assets.transferAmountMode === "amount" ? `<label class="field-label">${t("转账总额", "Total amount")}<div class="amount-with-unit"><input class="field-input" id="transferAmount" type="number" min="0" step="any" value="${escapeHtml(state.assets.transferAmount)}" required /><span>${state.assets.transferChain === "solana" ? "SOL" : "BNB"}</span></div></label>` : `<div class="compact-range"><div><span>${t("转账比例", "Transfer ratio")}</span><strong id="transferPercent">${state.assets.transferFraction}%</strong></div><input id="transferFraction" type="range" min="1" max="100" value="${state.assets.transferFraction}" /><div class="transfer-live-amount"><span>${t("预计转账总额", "Estimated transfer total")}</span><strong><b id="transferEstimatedAmount">${estimatedTransferAmount()}</b> ${state.assets.transferChain === "solana" ? "SOL" : "BNB"}</strong></div></div>`;
  openModal({ kicker: `${route} · ${routeText}`, title: t("转账", "Transfer"), content: `<form class="form-stack compact-transfer-form" id="assetTransferForm"><label class="field-label">${t("链", "Network")}<select class="field-select" id="transferChain"><option value="solana" ${state.assets.transferChain === "solana" ? "selected" : ""}>Solana / SOL</option><option value="bsc" ${state.assets.transferChain === "bsc" ? "selected" : ""}>BSC / BNB</option></select></label><div class="transfer-endpoints"><label class="field-label">${t("发送方", "From")}<select class="field-select" id="transferSource">${endpointOptions(source, target)}</select></label><i class="fa-solid fa-arrow-right"></i><label class="field-label">${t("接收方", "To")}<select class="field-select" id="transferDestination">${endpointOptions(target, source)}</select></label></div>${target === "login_wallet" ? `<label class="field-label">${t("接收地址", "Destination address")}<input class="field-input" id="transferExternalAddress" value="${escapeHtml(state.assets.transferExternalAddress)}" placeholder="${state.assets.transferChain === "solana" ? "Solana address" : "0x..."}" /></label>` : ""}<div class="transfer-mode-grid"><label class="field-label">${t("数量方式", "Amount rule")}<select class="field-select" id="transferAmountMode"><option value="fraction" ${state.assets.transferAmountMode === "fraction" ? "selected" : ""}>${t("按余额比例", "Balance percentage")}</option><option value="amount" ${state.assets.transferAmountMode === "amount" ? "selected" : ""}>${t("指定总额", "Fixed total")}</option></select></label><label class="field-label">${t("分配方式", "Distribution")}<select class="field-select" id="transferDistribution"><option value="equal" ${state.assets.transferDistribution === "equal" ? "selected" : ""}>${t("等额", "Equal")}</option><option value="random" ${state.assets.transferDistribution === "random" ? "selected" : ""}>${t("随机", "Random")}</option></select></label></div>${amountControl}<p>${sourceGroup && targetGroup && sourceGroup.walletCount !== targetGroup.walletCount ? t("两个钱包组数量不同，预览会标出未匹配的钱包。", "The group sizes differ; unmatched wallets will be shown in preview.") : t("预览不会移动资金，最终确认后才会签名并广播。", "Preview never moves funds. Signing and broadcasting require final confirmation.")}</p><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit">${t("预览转账", "Preview transfer")}</button></div></form>` });
}

function openExportDialog() {
  const groups = state.assets.groups.filter((group) => group.executionMode === "encrypted_vault");
  if (!groups.length) return showToast(t("没有可导出的真实钱包组", "No live wallet group is available for export"));
  openModal({ kicker: t("私钥导出", "Private-key export"), title: t("导出钱包组", "Export wallet group"), content: `<form class="form-stack" id="walletExportForm"><label class="field-label">${t("选择钱包组", "Wallet group")}<select class="field-select" name="groupId">${groups.map((group) => `<option value="${group.groupId}">${escapeHtml(group.name)} · ${group.walletCount}</option>`).join("")}</select></label><div class="export-danger"><i class="fa-solid fa-triangle-exclamation"></i><span>${t("文件包含可直接控制资产的私钥。下载后请离线保存，NarraOps 无法撤销已导出的密钥。", "This file contains keys that directly control funds. Store it offline; exported keys cannot be revoked by NarraOps.")}</span></div><label class="field-label">${t("输入“确认导出私钥”", "Type EXPORT PRIVATE KEYS")}<input class="field-input" name="confirmation" autocomplete="off" required /></label><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="danger-button" type="submit"><i class="fa-solid fa-file-arrow-down"></i>${t("导出文本文件", "Export text file")}</button></div></form>` });
}

function openAddWallets() {
  if (!state.assets.selectedGroupId) return;
  openModal({
    kicker: t("钱包组管理", "Wallet-group management"),
    title: t("添加加密钱包", "Add encrypted wallets"),
    content: `<form class="form-stack" id="addWalletsForm"><label class="field-label">${t("添加数量", "Number to add")}<input class="field-input" name="count" type="number" min="1" max="200" value="1" required /></label><p>${t("将为每个钱包生成真实 Solana 与 EVM 地址，密钥仅以加密密文保存。", "Each wallet receives real Solana and EVM addresses; keys are stored only as encrypted ciphertext.")}</p><div class="modal-actions"><button class="secondary-button" type="button" data-modal-action="close">${t("取消", "Cancel")}</button><button class="primary-button" type="submit">${t("添加钱包", "Add wallets")}</button></div></form>`,
  });
}

function openDepositAddresses() {
  const selected = state.assets.groups.find((group) => group.groupId === state.assets.selectedGroupId);
  if (!selected || !state.assets.wallets.length) return showToast(t("请先选择钱包组", "Select a wallet group first"));
  const rows = state.assets.wallets.map((wallet) => `<div class="transfer-pair"><span>${escapeHtml(wallet.label)}</span><div><small>Solana / SOL</small><code>${escapeHtml(wallet.addresses?.solana || "—")}</code><br><small>BSC / BNB</small><code>${escapeHtml(wallet.addresses?.bsc || "—")}</code></div><button class="secondary-button" type="button" data-copy-address="${escapeHtml(wallet.addresses?.solana || "")}">${t("复制 SOL 地址", "Copy SOL address")}</button></div>`).join("");
  openModal({ kicker: t("真实链上充值", "Live on-chain deposit"), title: `${selected.name} · ${t("充值地址", "Deposit addresses")}`, content: `<p>${t("请仅向对应链地址发送原生资产。Solana 地址接收 SOL，BSC 地址接收 BNB。", "Send native assets only on the matching chain: SOL to Solana addresses and BNB to BSC addresses.")}</p><div class="transfer-pair-list">${rows}</div><div class="modal-actions"><button class="primary-button" type="button" data-modal-action="close">${t("完成", "Done")}</button></div>` });
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
      contentZh: "发射预案已创建。它会把叙事、名称、Ticker、来源链接、图片、目标链、平台和钱包组整理为可审阅的固定 Schema。",
      contentEn: "A launch-ready plan is ready. It organizes the narrative, name, ticker, source links, image, target chain, platform, and wallet group into a reviewable fixed schema.",
      suggestionZh: "先补齐来源链接和图片，再审阅链、平台与钱包组。",
      suggestionEn: "Complete the source links and image first, then review the chain, platform, and wallet group.",
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

function shouldUsePulsePlan(command) {
  if (state.go.pendingOpportunityId) return true;
  return /\/(pulse|narrative|launch|plan)\b|execution plan|????|?? go|analyze in go|pulse opportunity|opportunity id/i.test(command);
}

function replacePendingMessage(pendingId, message) {
  const pendingIndex = state.conversation.findIndex((item) => item.pendingId === pendingId);
  if (pendingIndex === -1) {
    state.conversation.push(message);
  } else {
    state.conversation.splice(pendingIndex, 1, message);
  }
  renderConversation();
}

async function submitPulsePlan(command, pendingId) {
  const opportunityId = state.go.pendingOpportunityId;
  state.go.busy = true;
  try {
    const payload = await apiRequest("/api/v1/go/plan", {
      method: "POST",
      body: JSON.stringify({
        opportunityId,
        message: command,
        command: command.startsWith("/") ? command : undefined,
        context: {
          language: state.language,
          currentView: state.view,
        },
      }),
    });
    const plan = payload.plan || payload.card?.data || {};
    replacePendingMessage(pendingId, {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: payload.message?.content || "??? Pulse ??????????????????????",
      contentEn: payload.message?.content || "Built a review-only execution plan from Pulse evidence. Live execution remains disabled.",
      suggestionZh: payload.message?.suggestion || "???????????????????",
      suggestionEn: payload.message?.suggestion || "Review evidence gaps and risks before moving into a launch draft.",
      card: payload.card || {
        type: "execution_plan",
        status: plan.status || "review_only",
        data: plan,
      },
    });
  } catch (error) {
    replacePendingMessage(pendingId, {
      role: "agent",
      timestamp: getMessageTime(),
      contentZh: `Go ???????${error instanceof Error ? error.message : String(error)}`,
      contentEn: `Go plan generation failed: ${error instanceof Error ? error.message : String(error)}`,
      suggestionZh: "??? /api/v1/go/plan ??????????",
      suggestionEn: "Confirm /api/v1/go/plan is deployed, then retry.",
    });
  } finally {
    state.go.busy = false;
    state.go.pendingOpportunityId = null;
  }
}

function submitAgentCommand(value) {
  const command = value.trim();
  if (!command || state.go.busy) return;
  const pendingId = `pending-${Date.now()}`;
  state.conversation.push({ role: "user", content: command, timestamp: getMessageTime() });
  state.conversation.push({ role: "agent", pending: true, pendingId, timestamp: getMessageTime() });
  renderConversation();
  const input = document.querySelector("#agentInput");
  if (input) {
    input.value = "";
    input.style.height = "";
  }

  if (shouldUsePulsePlan(command)) {
    void submitPulsePlan(command, pendingId);
    return;
  }

  window.setTimeout(() => {
    replacePendingMessage(pendingId, getAgentResponse(command));
  }, 0);
}

function switchView(view) {
  if (!allowedViews.has(view)) return;
  state.view = view;
  window.location.hash = view;
  renderCurrentView();
  if (view === "assets" && !state.assets.portfolio && !state.assets.loading) loadAssets();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelectorAll("[data-view-trigger]").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.viewTrigger));
});

accountAssetsButton.addEventListener("click", async () => {
  if (!state.auth.session) return openAuth("web3");
  if (!state.assets.loginWallets.length && !state.assets.loading) await loadAssets();
  openAccountAssets();
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
    openPulseOpportunity(opportunity.dataset.opportunity);
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

  if (event.target.closest("[data-internal-launch]")) {
    const form = document.querySelector("#launchParameterForm");
    if (form) await submitInternalLaunch(form);
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

  const assetsSection = event.target.closest("[data-assets-section]")?.dataset.assetsSection;
  if (assetsSection) {
    state.assets.section = assetsSection;
    renderAssets();
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
    await loadPulse();
    showToast(t("公开证据已刷新。", "Public evidence refreshed."));
  } else if (action === "view-all") {
    showToast(t("完整机会库将在数据源接入后开放。", "The full opportunity library opens after source integration."));
  } else if (action === "language") {
    state.language = state.language === "zh" ? "en" : "zh";
    localStorage.setItem("narraops-language", state.language);
    renderCurrentView();
  } else if (action === "theme") {
    themeButton.click();
    renderCurrentView();
  } else if (action === "refresh-assets") {
    await loadAssets();
  } else if (action === "login-web3") {
    await openAuth("web3");
  } else if (action === "open-create-group") {
    openCreateGroup();
  } else if (action === "open-export") {
    openExportDialog();
  } else if (action === "open-add-wallet") {
    openAddWallets();
  } else if (action === "open-transfer") {
    openTransferDialog();
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
  } else if (action === "deposit-disabled") {
    openDepositAddresses();
  } else if (action === "withdraw-disabled") {
    openTransferDialog("login_wallet");
  } else if (action === "confirm-transfer-plan") {
    const preview = state.assets.transferPreview;
    if (!preview) return;
    await executeTransferPreview(preview);
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
      const amountInput = state.assets.transferAmountMode === "amount" ? { amountMode: "amount", amount: state.assets.transferAmount } : { amountMode: "fraction", fractionBps: state.assets.transferFraction * 100 };
      const preview = state.assets.transferSource === "login_wallet"
        ? await previewLoginWalletDistribution(idempotencyKey)
        : await apiRequest("/api/v1/transfers/preview", { method: "POST", body: JSON.stringify({ chain: state.assets.transferChain, source: transferEndpointValue(state.assets.transferSource, "source"), destination: transferEndpointValue(state.assets.transferDestination), ...amountInput, distribution: state.assets.transferDistribution, idempotencyKey }) });
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
  if (event.target.id === "accountWithdrawForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    const destination = String(form.get("destination") || "").trim();
    const amount = String(form.get("amount") || "").trim();
    try {
      const result = await submitAccountWithdrawal(state.assets.accountAssetChain, destination, amount);
      closeModal();
      showToast(`${t("交易已提交", "Transaction submitted")}: ${typeof result === "string" ? shortAddress(result) : shortAddress(result?.signature || "")}`);
      window.setTimeout(() => loadAssets(), 1800);
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.id === "assetTransferForm") {
    event.preventDefault();
    const idempotencyKey = crypto.randomUUID();
    try {
      const amountInput = state.assets.transferAmountMode === "amount" ? { amountMode: "amount", amount: state.assets.transferAmount } : { amountMode: "fraction", fractionBps: state.assets.transferFraction * 100 };
      const preview = state.assets.transferSource === "login_wallet"
        ? await previewLoginWalletDistribution(idempotencyKey)
        : await apiRequest("/api/v1/transfers/preview", { method: "POST", body: JSON.stringify({ chain: state.assets.transferChain, source: transferEndpointValue(state.assets.transferSource, "source"), destination: transferEndpointValue(state.assets.transferDestination), ...amountInput, distribution: state.assets.transferDistribution, idempotencyKey }) });
      state.assets.transferPreview = { ...preview, idempotencyKey };
      state.assets.transferError = null;
      modalBody.querySelector(".compact-transfer-preview")?.remove();
      const rows = (preview.allocations || []).slice(0, 8).map((item, index) => `<div class="compact-preview-row"><span>${index + 1}</span><code>${escapeHtml(shortAddress(item.from || item.sourceWalletId || t("登录钱包", "Login wallet")))}</code><i class="fa-solid fa-arrow-right"></i><code>${escapeHtml(shortAddress(item.to || item.destinationWalletId || t("登录钱包", "Login wallet")))}</code><strong>${escapeHtml(item.amount)} ${escapeHtml(preview.currency)}</strong></div>`).join("");
      modalBody.insertAdjacentHTML("beforeend", `<div class="compact-transfer-preview"><div><strong>${t("转账总额", "Total transfer")}: ${escapeHtml(preview.estimatedAmount)} ${escapeHtml(preview.currency)}</strong><span>${preview.pairCount} ${t("笔", "transfers")} · ${(preview.unmatchedSourceWalletIds?.length || 0) + (preview.unmatchedDestinationWalletIds?.length || 0)} ${t("个未匹配", "unmatched")}</span></div>${rows ? `<div class="compact-preview-list">${rows}</div>` : ""}<button class="primary-button" type="button" data-action="confirm-transfer-plan">${t("确认签名并广播", "Confirm, sign and broadcast")}</button></div>`);
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.id === "walletExportForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    const expected = state.language === "zh" ? "确认导出私钥" : "EXPORT PRIVATE KEYS";
    if (String(form.get("confirmation") || "").trim() !== expected) return showToast(t("确认文字不正确", "Confirmation text does not match"));
    try {
      const groupId = String(form.get("groupId"));
      const result = await apiRequest(`/api/v1/wallet-groups/${groupId}/exports`, { method: "POST", headers: { "X-Reauthenticated-At": new Date().toISOString(), "X-MFA-Verified": "true" }, body: JSON.stringify({ confirmExport: true, reason: "user_requested_text_export" }) });
      const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = result.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      closeModal();
      showToast(t("私钥文件已导出", "Private-key file exported"));
    } catch (error) { showToast(error.message); }
    return;
  }
  if (event.target.id === "createWalletGroupForm") {
    event.preventDefault();
    const form = new FormData(event.target);
    try {
      const purpose = form.get("purpose");
      const group = await apiRequest("/api/v1/wallet-groups", { method: "POST", body: JSON.stringify({ name: form.get("name"), network: form.get("network"), purpose, walletCount: purpose === "cooking" ? 1 : Number(form.get("walletCount")) }) });
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
  if (event.target.id === "accountAssetChain") {
    state.assets.accountAssetChain = event.target.value;
    openAccountAssets(event.target.closest("[data-account-mode]")?.dataset.accountMode || "overview");
    return;
  }
  if (event.target.id === "transferDestination") {
    state.assets.transferDestination = event.target.value;
    state.assets.transferPreview = null;
    openTransferDialog();
    return;
  }
  if (event.target.id === "transferSource") {
    state.assets.transferSource = event.target.value;
    state.assets.transferPreview = null;
    openTransferDialog();
    return;
  }
  if (event.target.id === "transferChain") {
    state.assets.transferChain = event.target.value;
    state.assets.transferSource = "login_wallet";
    state.assets.transferDestination = null;
    state.assets.transferPreview = null;
    openTransferDialog();
    return;
  }
  if (event.target.id === "transferAmountMode") {
    state.assets.transferAmountMode = event.target.value;
    state.assets.transferPreview = null;
    openTransferDialog();
    return;
  }
  if (event.target.id === "transferDistribution") {
    state.assets.transferDistribution = event.target.value;
    state.assets.transferPreview = null;
    openTransferDialog();
    return;
  }
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
  if (event.target.id === "transferExternalAddress") {
    state.assets.transferExternalAddress = event.target.value;
    state.assets.transferPreview = null;
    return;
  }
  if (event.target.id !== "agentInput") return;
  event.target.style.height = "auto";
  event.target.style.height = `${Math.min(event.target.scrollHeight, 144)}px`;
});

viewRoot.addEventListener("change", (event) => {
  if (event.target.id === "assetNetworkFilter") {
    state.assets.networkFilter = event.target.value;
    renderAssets();
    return;
  }
  if (event.target.id === "transferChain") {
    state.assets.transferChain = event.target.value;
    state.assets.transferPreview = null;
    renderAssets();
    return;
  }
  if (event.target.id === "buyAllocationMode") {
    const random = event.target.value === "TOTAL_RANDOM";
    const equalField = document.querySelector("#equalBoundBuyAmountField");
    const randomField = document.querySelector("#randomBoundBuyTotalField");
    if (equalField) equalField.hidden = random;
    if (randomField) randomField.hidden = !random;
    return;
  }
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

modal.addEventListener("click", async (event) => {
  const accountAction = event.target.closest("[data-account-action]")?.dataset.accountAction;
  if (accountAction) {
    openAccountAssets(accountAction);
    return;
  }
  const allAmount = event.target.closest("[data-account-all]")?.dataset.accountAll;
  if (allAmount != null) {
    const input = modal.querySelector("#accountWithdrawAmount");
    if (input) input.value = allAmount;
    return;
  }
  if (event.target.closest('[data-action="confirm-transfer-plan"]')) {
    const preview = state.assets.transferPreview;
    if (!preview) return;
    event.preventDefault();
    event.stopPropagation();
    await executeTransferPreview(preview);
    return;
  }
  const web3Chain = event.target.closest("[data-web3-login]")?.dataset.web3Login;
  if (web3Chain) {
    await web3Login(web3Chain);
    return;
  }
  const copyAddress = event.target.closest("[data-copy-address]")?.dataset.copyAddress;
  if (copyAddress) {
    await navigator.clipboard.writeText(copyAddress);
    showToast(t("地址已复制", "Address copied"));
    return;
  }
  const action = event.target.closest("[data-modal-action]")?.dataset.modalAction;
  if (action === "close") closeModal();
  if (action === "complete-onboarding") {
    try {
      await apiRequest("/api/v1/auth/onboarding/complete", { method: "POST", body: "{}" });
      if (state.auth.session?.user) state.auth.session.user.onboardingCompleted = true;
    } catch (error) { showToast(error.message); }
    closeModal();
  }
  if (action === "agent") {
    const opportunityId = event.target.closest("[data-opportunity-id]")?.dataset.opportunityId || null;
    closeModal();
    state.go.pendingOpportunityId = opportunityId;
    switchView("go");
    window.setTimeout(() => {
      if (opportunityId) {
        submitAgentCommand(`/plan ${opportunityId}`);
        return;
      }
      const input = document.querySelector("#agentInput");
      if (input) {
        input.value = "/narrative ";
        input.focus();
      }
    }, 0);
  }
});

modal.addEventListener("input", (event) => {
  if (event.target.id === "transferFraction") {
    state.assets.transferFraction = Number(event.target.value);
    const label = modal.querySelector("#transferPercent");
    if (label) label.textContent = `${state.assets.transferFraction}%`;
    const estimate = modal.querySelector("#transferEstimatedAmount");
    if (estimate) estimate.textContent = estimatedTransferAmount();
  }
  if (event.target.id === "transferExternalAddress") state.assets.transferExternalAddress = event.target.value;
  if (event.target.id === "transferAmount") state.assets.transferAmount = event.target.value;
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
  if (state.view === "pulse") loadPulse();
  if (state.view === "assets" && !state.assets.portfolio && !state.assets.loading) loadAssets();
  if (state.view === "launch") loadLaunchGroups();
});

let resizeTimer;
window.addEventListener("resize", () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(drawVisibleCharts, 120);
});

updateTheme();
renderCurrentView();
loadAuthSession();
if (state.view === "pulse") loadPulse();
if (state.view === "assets") loadAssets();
if (state.view === "launch") loadLaunchGroups();
