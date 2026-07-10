const STORAGE_KEY = "narraops.workspace.v1";
const LANGUAGE_KEY = "narraops.language";

const state = {
  activeView: "dashboard",
  selectedSignalId: "sig-ai-mask",
  contributionRate: Number(localStorage.getItem("narraops.contributionRate") || 4),
  language: localStorage.getItem(LANGUAGE_KEY) || "en",
  customBrief: "",
  launchMode: "manual",
  chain: "sol",
  platform: "Pump.fun",
  generated: null,
  lastLaunchPackage: null,
  armedLaunches: [
    {
      id: "arm-01",
      trigger: "@marketobserver posts with image + AI mascot keyword",
      chain: "Solana",
      walletGroup: "Alpha Launch Group",
      mode: "Confirm first",
      status: "armed",
    },
  ],
};

const sources = [
  {
    id: "src-x-01",
    platform: "X",
    handle: "@marketobserver",
    focus: "new posts, images, cultural phrases",
    status: "live",
    lastSeen: "2m",
  },
  {
    id: "src-tt-01",
    platform: "TikTok",
    handle: "@clipradar",
    focus: "viral short clips, creator memes",
    status: "live",
    lastSeen: "7m",
  },
  {
    id: "src-ig-01",
    platform: "Instagram",
    handle: "@visualloops",
    focus: "high-reuse media, characters, comments",
    status: "queued",
    lastSeen: "18m",
  },
  {
    id: "src-tg-01",
    platform: "Telegram",
    handle: "Launch chatter list",
    focus: "early meme repeats, ticker mentions",
    status: "live",
    lastSeen: "4m",
  },
];

const signals = [
  {
    id: "sig-ai-mask",
    title: "Masked AI mascot clip is spreading across comment threads",
    source: "@marketobserver",
    network: "X",
    grade: "S",
    score: 94,
    comparable: "Comparable case peak: $42M",
    sentiment: "accelerating",
    risk: "low",
    angle: "A character that looks like a bot pretending to be human becomes the symbol for agent-native internet culture.",
    name: "MaskBot",
    ticker: "MASKBOT",
  },
  {
    id: "sig-glitch",
    title: "Game glitch phrase became a repeated reply format",
    source: "@clipradar",
    network: "TikTok",
    grade: "A",
    score: 86,
    comparable: "Comparable case peak: $9.8M",
    sentiment: "rising",
    risk: "medium",
    angle: "The internet treats broken simulation moments as a shared market joke.",
    name: "GlitchLoop",
    ticker: "GLITCH",
  },
  {
    id: "sig-catchphrase",
    title: "Creator catchphrase is being remixed into financial slang",
    source: "@visualloops",
    network: "Instagram",
    grade: "A",
    score: 82,
    comparable: "Comparable case peak: $6.4M",
    sentiment: "volatile",
    risk: "watch",
    angle: "A short phrase becomes a ritual signal for people who buy chaos before it becomes consensus.",
    name: "Before Consensus",
    ticker: "BCONS",
  },
  {
    id: "sig-telegram",
    title: "Telegram groups repeat the same absurd ticker request",
    source: "Launch chatter list",
    network: "Telegram",
    grade: "B",
    score: 71,
    comparable: "Comparable case peak: $730K",
    sentiment: "early",
    risk: "medium",
    angle: "A community-born ticker becomes the meme before the token exists.",
    name: "Ticker First",
    ticker: "TICKR",
  },
];

const historicalCases = [
  { name: "GOAT", chain: "SOL", peak: "$800M+", tag: "AI narrative" },
  { name: "CHILLGUY", chain: "SOL", peak: "$500M+", tag: "internet character" },
  { name: "WIF", chain: "SOL", peak: "$4B+", tag: "media identity" },
  { name: "MUBARAK", chain: "BSC", peak: "$100M+", tag: "culture event" },
];

const walletGroups = [
  {
    name: "Alpha Launch Group",
    chain: "SOL",
    wallets: 24,
    balance: "18.42 SOL",
    buyPlan: "random 0.12-0.35 SOL",
    sellPlan: "25 / 50 / 75 / 100%",
  },
  {
    name: "BSC Fast Group",
    chain: "BSC",
    wallets: 18,
    balance: "9.73 BNB",
    buyPlan: "ladder 0.04 BNB",
    sellPlan: "profit tiers",
  },
  {
    name: "Community Rewards",
    chain: "SOL",
    wallets: 8,
    balance: "4.12 SOL",
    buyPlan: "manual",
    sellPlan: "locked",
  },
];

const records = [
  {
    time: "12:18",
    type: "Signal scored",
    detail: "Masked AI mascot moved to S grade",
    route: "Narrative Agent",
    status: "done",
  },
  {
    time: "12:09",
    type: "Launch armed",
    detail: "@marketobserver trigger linked to Alpha Launch Group",
    route: "Signal-to-Launch",
    status: "armed",
  },
  {
    time: "11:47",
    type: "Community pack",
    detail: "Generated 8 X posts and 3 Telegram responses",
    route: "Community Agent",
    status: "done",
  },
];

const UI_TRANSLATIONS = {
  zh: {
    "Agentic Launch OS": "智能体发行操作系统",
    Dashboard: "仪表盘",
    Narratives: "叙事",
    "Signal-to-Launch": "信号到发射",
    "Meme Builder": "Meme 构建器",
    "Launch Console": "发射控制台",
    "Wallet Ops": "钱包运营",
    "Community Ops": "社区运营",
    Records: "记录",
    "Agent Status": "Agent 状态",
    Listening: "监听中",
    Signals: "信号",
    "Armed launches": "已布防发射",
    "Run scan": "运行扫描",
    Settlement: "结算",
    "Contribution Engine": "贡献结算引擎",
    Close: "关闭",
    "Selected rate": "当前比例",
    "Settlement wallet": "隔离结算钱包",
    "User-selected contribution": "用户选择贡献比例",
    "Calculated only from the selected launch wallet group's realized total profit.": "只按所选发射钱包组的已实现总盈利计算。",
    "No profit means no contribution. Loss wallets are not charged.": "没有盈利就不收取贡献，亏损钱包不参与扣款。",
    "Positive wallets route their share into the settlement wallet before treasury transfer.": "盈利钱包按净盈利占比转入隔离结算钱包，再进入国库。",
    "Future incentive reference": "未来激励参考",
    "Contribution records can be used for future ecosystem rewards, ambassador access, launch partner lists, and whitelist scoring.": "贡献记录可用于未来生态奖励、项目大使、合作发射名单和白名单评分。",
    "Signal, build, launch, operate.": "发现信号，构建叙事，准备发射，持续运营。",
    "Track social signals and score launchable narratives.": "追踪社交信号并评估可发射叙事。",
    "Arm social triggers for Solana or BSC launches.": "为 Solana 或 BSC 发射设置社交触发器。",
    "Turn one signal into a launch-ready story pack.": "把一个信号转成可发射叙事包。",
    "Prepare chain, platform, media, and wallet execution.": "准备链、平台、媒体和钱包执行。",
    "Plan wallet groups, execution flow, settlement, and treasury routing.": "规划钱包组、执行流、结算和国库路径。",
    "Operate X, Telegram, contests, spaces, and sentiment loops.": "运营 X、Telegram、活动、Space 和情绪循环。",
    "Review agent actions, launch plans, and execution history.": "查看 Agent 动作、发射计划和执行历史。",
    "Top signal": "最高信号",
    "Launch readiness": "发射准备度",
    "Name, ticker, ops plan ready": "名称、符号、运营方案已准备",
    "Wallet groups": "钱包组",
    "SOL + BSC configured": "SOL + BSC 已配置",
    "Contribution rate": "贡献比例",
    "User selected": "用户选择",
    "Operator path": "操作路径",
    "Use NarraOps as a working console: discover a meme angle, turn it into launch material, prepare execution, then keep the community alive after launch.": "把 NarraOps 当作工作台：发现 meme 角度，转成发射材料，准备执行，并在发射后持续运营社区。",
    "Open watcher": "打开监听器",
    "01 Listen": "01 监听",
    "Add X, TikTok, Instagram, Telegram, or custom media sources.": "添加 X、TikTok、Instagram、Telegram 或自定义媒体源。",
    "02 Score": "02 评分",
    "Rank narratives against historical launches and sentiment drift.": "根据历史发射案例和情绪变化给叙事排序。",
    "03 Build": "03 构建",
    "Generate token identity, launch copy, and operations plan.": "生成代币身份、发射文案和运营计划。",
    "04 Operate": "04 运营",
    "Run wallet ops, contribution settlement, and community campaigns.": "执行钱包运营、贡献结算和社区活动。",
    "Active narrative": "当前叙事",
    "Build meme pack": "构建 Meme 包",
    Signal: "信号",
    Meme: "Meme",
    Launch: "发射",
    Ops: "运营",
    "X posts, Telegram, contest, sentiment loop": "X 发帖、Telegram、比赛、情绪循环",
    "Top signals": "高分信号",
    Open: "打开",
    "Recent actions": "最近动作",
    All: "全部",
    "Monitored sources": "监控源",
    "Tracked accounts, media feeds, and community channels.": "被追踪的账号、媒体流和社区频道。",
    "Source URL or handle": "来源链接或账号",
    Platform: "平台",
    "Add source": "添加来源",
    "Launchable narratives": "可发射叙事",
    "Scored against historical cases, media reuse potential, and sentiment drift.": "按历史案例、媒体复用潜力和情绪漂移评分。",
    "Historical case memory": "历史案例记忆",
    peak: "峰值",
    "Arm trigger": "设置触发器",
    "Watch target": "监听目标",
    "Trigger phrase": "触发关键词",
    Chain: "链",
    Mode: "模式",
    "Confirm first": "先确认",
    "Auto after match": "匹配后自动",
    "Wallet group": "钱包组",
    "Arm watcher": "启用监听",
    "Simulate trigger": "模拟触发",
    "Current trigger signal": "当前触发信号",
    "Auto path": "自动路径",
    "Signal match -> Agent draft -> launch package -> wallet group execution plan -> community pack.": "信号匹配 -> Agent 草案 -> 发射包 -> 钱包组执行计划 -> 社区运营包。",
    "Armed launch watchers": "已启用监听器",
    "Meme brief": "Meme 简报",
    "Input link, post, or angle": "输入链接、帖子或角度",
    "Selected signal": "已选信号",
    "Generate launch pack": "生成发射包",
    "Send to launch": "发送到发射",
    Identity: "身份",
    "Token name": "代币名称",
    Ticker: "符号",
    Narrative: "叙事",
    "Generated assets": "生成资产",
    "Launch tweet": "发射推文",
    "Telegram pinned message": "Telegram 置顶消息",
    "24h operations plan": "24 小时运营计划",
    "Narrative risk watch": "叙事风险监控",
    "Launch package": "发射包",
    "Build launch package": "构建发射包",
    "Dev wallet": "Dev 钱包",
    "Dev Wallet 01": "Dev 钱包 01",
    "Dev Wallet 02": "Dev 钱包 02",
    "01 Identity": "01 身份",
    "02 Social binding": "02 社交绑定",
    "X post, Telegram room, launch copy ready.": "X 帖子、Telegram 群、发射文案已准备。",
    "03 Wallet group": "03 钱包组",
    "Buy/sell amounts preconfigured.": "买入和卖出数量已预配置。",
    "04 Contribution": "04 贡献",
    "Launch checklist": "发射清单",
    "API launch package": "API 发射包",
    "Launch output": "发射输出",
    "Package ID": "包 ID",
    Description: "描述",
    Post: "帖子",
    "Create operational groups for launch buying, selling, treasury actions, rewards, or settlement routing.": "创建用于发射买入、卖出、国库动作、奖励或结算路径的钱包组。",
    "Group name": "组名",
    Wallets: "钱包数",
    Balance: "余额",
    "Add group": "添加组",
    "Buy plan": "买入计划",
    "Sell plan": "卖出计划",
    "Contribution settlement preview": "贡献结算预览",
    "Profit rule": "盈利规则",
    "Compare selected wallet group total balance before buy and after sell. If the group is net profitable, positive wallets route 4% of group profit by net-gain share.": "比较所选钱包组买入前和卖出后的总余额。若钱包组整体盈利，盈利钱包按净盈利占比转出贡献。",
    "Before buy": "买入前",
    "After sell": "卖出后",
    "Group profit": "组盈利",
    Contribution: "贡献",
    "Open settlement": "打开结算",
    "Tracked mentions": "追踪提及",
    Sentiment: "情绪",
    "positive / creative": "正向 / 创作型",
    "FUD risk": "FUD 风险",
    Low: "低",
    "creator account stable": "创建者账号稳定",
    "Community content pack": "社区内容包",
    "X, Telegram, contest, and treasury action drafts.": "X、Telegram、比赛和国库动作草案。",
    "Generate new pack": "生成新内容包",
    "X update": "X 更新",
    "Telegram response": "Telegram 回复",
    "Meme contest": "Meme 创作比赛",
    "Operations action": "运营动作",
    Copy: "复制",
    "Activity records": "活动记录",
    "Clear demo records": "清除演示记录",
    "Scan refreshed by local API": "本地 API 已刷新扫描",
    "Scan refreshed locally": "已在本地刷新扫描",
    "Add a source first": "请先添加来源",
    "Name the wallet group first": "请先填写钱包组名称",
    "Wallet group added": "钱包组已添加",
    "Launch pack generated by local API": "本地 API 已生成发射包",
    "Launch pack generated locally": "已在本地生成发射包",
    "Launch package ready": "发射包已准备",
    "Launch package ready locally": "本地发射包已准备",
    "Community pack refreshed": "社区内容包已刷新",
    Copied: "已复制",
    "Watcher armed": "监听器已启用",
    "Demo records cleared": "演示记录已清除",
    "Workspace loaded from local server": "已从本地服务加载工作区",
    ready: "就绪",
    "needs input": "需要输入",
    "needs wallet group": "需要钱包组",
    "confirm first": "先确认",
    "auto after match": "匹配后自动",
    done: "完成",
    armed: "已启用",
    live: "在线",
    queued: "队列中",
    low: "低",
    medium: "中",
    watch: "观察",
    accelerating: "加速",
    rising: "上升",
    volatile: "波动",
    early: "早期",
  },
};

const ZH_TO_EN = Object.fromEntries(
  Object.entries(UI_TRANSLATIONS.zh).map(([english, chinese]) => [chinese, english]),
);

let applyingWorkspace = false;
let serverSaveTimer = null;
let lastServerSavePayload = "";

function getWorkspacePayload() {
  return {
    state: {
      activeView: state.activeView,
      selectedSignalId: state.selectedSignalId,
      contributionRate: state.contributionRate,
      language: state.language,
      customBrief: state.customBrief,
      launchMode: state.launchMode,
      chain: state.chain,
      platform: state.platform,
      generated: state.generated,
      lastLaunchPackage: state.lastLaunchPackage,
      armedLaunches: state.armedLaunches,
    },
    sources,
    signals,
    walletGroups,
    records,
  };
}

function applyWorkspace(saved) {
  if (!saved || typeof saved !== "object") return false;
  if (saved.state && typeof saved.state === "object") {
    Object.assign(state, {
      activeView: saved.state.activeView || state.activeView,
      selectedSignalId: saved.state.selectedSignalId || state.selectedSignalId,
      contributionRate: Number(saved.state.contributionRate ?? state.contributionRate),
      language: saved.state.language || state.language,
      customBrief: saved.state.customBrief || "",
      launchMode: saved.state.launchMode || state.launchMode,
      chain: saved.state.chain || state.chain,
      platform: saved.state.platform || state.platform,
      generated: saved.state.generated || state.generated,
      lastLaunchPackage: saved.state.lastLaunchPackage || state.lastLaunchPackage,
      armedLaunches: Array.isArray(saved.state.armedLaunches)
        ? saved.state.armedLaunches
        : state.armedLaunches,
    });
  }

  if (Array.isArray(saved.sources)) {
    sources.splice(0, sources.length, ...saved.sources);
  }
  if (Array.isArray(saved.signals)) {
    signals.splice(0, signals.length, ...saved.signals);
  }
  if (Array.isArray(saved.walletGroups)) {
    walletGroups.splice(0, walletGroups.length, ...saved.walletGroups);
  }
  if (Array.isArray(saved.records)) {
    records.splice(0, records.length, ...saved.records);
  }
  return true;
}

function loadWorkspace() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    saved = null;
  }
  applyWorkspace(saved);
}

function saveWorkspace() {
  const payload = getWorkspacePayload();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  scheduleServerSave(payload);
}

function hasStoredWorkspace(saved) {
  if (!saved || typeof saved !== "object") return false;
  const hasArrays =
    (Array.isArray(saved.sources) && saved.sources.length > 0) ||
    (Array.isArray(saved.signals) && saved.signals.length > 0) ||
    (Array.isArray(saved.walletGroups) && saved.walletGroups.length > 0) ||
    (Array.isArray(saved.records) && saved.records.length > 0);
  return hasArrays || Object.keys(saved.state || {}).length > 0;
}

function scheduleServerSave(payload = getWorkspacePayload()) {
  if (appServedFromFile() || applyingWorkspace) return;
  const serialized = JSON.stringify(payload);
  if (serialized === lastServerSavePayload) return;
  lastServerSavePayload = serialized;
  window.clearTimeout(serverSaveTimer);
  serverSaveTimer = window.setTimeout(() => {
    postJson("/api/workspace", { workspace: payload }).catch(() => {
      lastServerSavePayload = "";
    });
  }, 250);
}

const titleMap = {
  dashboard: ["Dashboard", "Signal, build, launch, operate."],
  narratives: ["Narrative Intelligence", "Track social signals and score launchable narratives."],
  signal: ["Signal-to-Launch", "Arm social triggers for Solana or BSC launches."],
  builder: ["Meme Builder", "Turn one signal into a launch-ready story pack."],
  launch: ["Launch Console", "Prepare chain, platform, media, and wallet execution."],
  wallets: ["Wallet Ops", "Plan wallet groups, execution flow, settlement, and treasury routing."],
  community: ["Community Ops", "Operate X, Telegram, contests, spaces, and sentiment loops."],
  records: ["Records", "Review agent actions, launch plans, and execution history."],
};

const root = document.getElementById("viewRoot");
const toast = document.getElementById("toast");

function selectedSignal() {
  return signals.find((signal) => signal.id === state.selectedSignalId) || signals[0];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function textForLanguage(english, chinese) {
  return state.language === "zh" ? chinese : english;
}

function translateText(value) {
  const text = String(value);
  const trimmed = text.trim();
  if (!trimmed) return text;

  const map = state.language === "zh" ? UI_TRANSLATIONS.zh : ZH_TO_EN;
  const translated = map[trimmed];
  if (!translated) return text;
  return text.replace(trimmed, translated);
}

function translateNodeText(rootElement) {
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ["SCRIPT", "STYLE", "TEXTAREA"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }
  nodes.forEach((node) => {
    node.nodeValue = translateText(node.nodeValue);
  });
}

function translateAttributes(rootElement) {
  rootElement.querySelectorAll("[placeholder], [aria-label], [title]").forEach((element) => {
    ["placeholder", "aria-label", "title"].forEach((attribute) => {
      if (element.hasAttribute(attribute)) {
        element.setAttribute(attribute, translateText(element.getAttribute(attribute)));
      }
    });
  });
}

function applyLanguage() {
  document.documentElement.lang = state.language === "zh" ? "zh-CN" : "en";
  const button = document.getElementById("languageToggleBtn");
  if (button) {
    button.textContent = state.language === "zh" ? "EN" : "中文";
    button.setAttribute(
      "aria-label",
      state.language === "zh" ? "Switch to English" : "切换到中文",
    );
  }
  translateNodeText(document.body);
  translateAttributes(document.body);
}

function showToast(message) {
  toast.textContent = translateText(message);
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function apiBase() {
  if (window.location.protocol === "http:" || window.location.protocol === "https:") {
    return "";
  }
  return "http://127.0.0.1:5188";
}

function appServedFromFile() {
  return !(window.location.protocol === "http:" || window.location.protocol === "https:");
}

async function loadServerWorkspace() {
  if (appServedFromFile()) return;
  try {
    const response = await fetch(`${apiBase()}/api/workspace`, { cache: "no-store" });
    if (!response.ok) return;
    const result = await response.json();
    if (!hasStoredWorkspace(result.workspace)) {
      scheduleServerSave(getWorkspacePayload());
      return;
    }
    applyingWorkspace = true;
    const applied = applyWorkspace(result.workspace);
    applyingWorkspace = false;
    if (applied) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(getWorkspacePayload()));
      render();
      showToast("Workspace loaded from local server");
    }
  } catch {
    applyingWorkspace = false;
  }
}

async function postJson(path, payload) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

function addRecord(type, detail, route, status = "done") {
  const now = new Date();
  records.unshift({
    time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    type,
    detail,
    route,
    status,
  });
  saveWorkspace();
  renderSideStats();
}

function gradeClass(grade) {
  return grade.toLowerCase();
}

function buildDraft(signal = selectedSignal(), brief = state.customBrief) {
  const extra = brief.trim() ? `\n\nUser angle: ${brief.trim()}` : "";
  if (state.language === "zh") {
    const zhExtra = brief.trim() ? `\n\n用户角度：${brief.trim()}` : "";
    return {
      name: signal.name,
      ticker: signal.ticker,
      story: `${signal.angle}${zhExtra}`,
      launchTweet: `${signal.name} 是把时间线信号变成可交易叙事的 meme。\n\nTicker: $${signal.ticker}\n信号来源：${signal.source}\n核心叙事：${signal.angle}`,
      telegram:
        `置顶：$${signal.ticker} 发射房间已开启。\n\n叙事：${signal.angle}\n\n规则：只认官方链接，谨防仿冒，关键动作保留链上凭证。`,
      operations:
        `前 24 小时运营计划：\n1. 发布发射长推。\n2. 开启 Telegram meme 素材比赛。\n3. 追踪 CA + $${signal.ticker} 相关提及。\n4. 只有在国库状态清晰后，再准备回购 / 销毁 / 捐赠文案。\n5. 每 4 小时做一次社区情绪检查。`,
      risk:
        `风险监控：来源账号情绪为 ${signal.sentiment}；当前叙事风险为 ${signal.risk}。重点观察删帖、创作者反对、恶意引用和仿冒链接。`,
    };
  }
  return {
    name: signal.name,
    ticker: signal.ticker,
    story: `${signal.angle}${extra}`,
    launchTweet: `${signal.name} is for the timeline that spots the meme before consensus.\n\nTicker: $${signal.ticker}\nSignal: ${signal.source}\nThesis: ${signal.angle}`,
    telegram:
      `Pinned: $${signal.ticker} launch room is live.\n\nNarrative: ${signal.angle}\n\nRules: verify links, avoid impersonators, keep receipts on-chain.`,
    operations:
      `First 24h ops:\n1. Publish launch thread.\n2. Open Telegram contest for meme assets.\n3. Track CA + $${signal.ticker} mentions.\n4. Prepare buyback / burn / donation wording only after treasury status is clear.\n5. Run sentiment check every 4 hours.`,
    risk:
      `Risk watch: source account sentiment is ${signal.sentiment}; current narrative risk is ${signal.risk}. Monitor deleted posts, creator objections, and hostile quote posts.`,
  };
}

function ensureDraft() {
  if (!state.generated) {
    state.generated = buildDraft();
  }
  return state.generated;
}

function renderSideStats() {
  document.getElementById("sideSignalCount").textContent = String(signals.length);
  document.getElementById("sideArmedCount").textContent = String(state.armedLaunches.length);
  document.getElementById("treasuryRateText").textContent = `${state.contributionRate}%`;
  document.getElementById("drawerRateText").textContent = `${state.contributionRate}%`;
  document.getElementById("contributionRate").value = String(state.contributionRate);
}

function render() {
  const [title, subtitle] = titleMap[state.activeView];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = subtitle;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === state.activeView);
  });

  const views = {
    dashboard: renderDashboard,
    narratives: renderNarratives,
    signal: renderSignalToLaunch,
    builder: renderBuilder,
    launch: renderLaunchConsole,
    wallets: renderWalletOps,
    community: renderCommunityOps,
    records: renderRecords,
  };
  root.innerHTML = views[state.activeView]();
  renderSideStats();
  applyLanguage();
}

function renderDashboard() {
  const signal = selectedSignal();
  const draft = ensureDraft();
  return `
    <section class="grid-4">
      <div class="metric-card">
        <div class="label">Top signal</div>
        <div class="metric-value">${escapeHtml(signal.grade)} / ${signal.score}</div>
        <div class="metric-foot">${escapeHtml(signal.network)} · ${escapeHtml(signal.sentiment)}</div>
      </div>
      <div class="metric-card">
        <div class="label">Launch readiness</div>
        <div class="metric-value">82%</div>
        <div class="metric-foot">Name, ticker, ops plan ready</div>
      </div>
      <div class="metric-card">
        <div class="label">Wallet groups</div>
        <div class="metric-value">${walletGroups.length}</div>
        <div class="metric-foot">SOL + BSC configured</div>
      </div>
      <div class="metric-card">
        <div class="label">Contribution rate</div>
        <div class="metric-value">${state.contributionRate}%</div>
        <div class="metric-foot">User selected</div>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Operator path</h2>
          <p>Use NarraOps as a working console: discover a meme angle, turn it into launch material, prepare execution, then keep the community alive after launch.</p>
        </div>
        <button class="secondary-button" data-action="go-signal">Open watcher</button>
      </div>
      <div class="launch-flow">
        <div class="launch-step"><strong>01 Listen</strong><p>Add X, TikTok, Instagram, Telegram, or custom media sources.</p></div>
        <div class="launch-step"><strong>02 Score</strong><p>Rank narratives against historical launches and sentiment drift.</p></div>
        <div class="launch-step"><strong>03 Build</strong><p>Generate token identity, launch copy, and operations plan.</p></div>
        <div class="launch-step"><strong>04 Operate</strong><p>Run wallet ops, contribution settlement, and community campaigns.</p></div>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Active narrative</h2>
          <p>${escapeHtml(signal.angle)}</p>
        </div>
        <button class="primary-button" data-action="open-builder">Build meme pack</button>
      </div>
      <div class="launch-flow">
        <div class="launch-step"><strong>Signal</strong><p>${escapeHtml(signal.title)}</p></div>
        <div class="launch-step"><strong>Meme</strong><p>${escapeHtml(draft.name)} / $${escapeHtml(draft.ticker)}</p></div>
        <div class="launch-step"><strong>Launch</strong><p>${escapeHtml(state.chain.toUpperCase())} · ${escapeHtml(state.platform)}</p></div>
        <div class="launch-step"><strong>Ops</strong><p>X posts, Telegram, contest, sentiment loop</p></div>
      </div>
    </section>

    <section class="grid-2">
      <div class="panel">
        <div class="section-head">
          <h2>Top signals</h2>
          <button class="small-button" data-action="go-narratives">Open</button>
        </div>
        <div class="signal-list">${signals.slice(0, 3).map(renderSignalCard).join("")}</div>
      </div>
      <div class="panel">
        <div class="section-head">
          <h2>Recent actions</h2>
          <button class="small-button" data-action="go-records">All</button>
        </div>
        <div class="records-list">${records.slice(0, 5).map(renderRecordRow).join("")}</div>
      </div>
    </section>
  `;
}

function renderNarratives() {
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Monitored sources</h2>
          <p>Tracked accounts, media feeds, and community channels.</p>
        </div>
        <button class="primary-button" data-action="scan">Run scan</button>
      </div>
      <div class="toolbar">
        <label class="field">
          <span class="field-label">Source URL or handle</span>
          <input class="input" id="newSourceInput" placeholder="@account or https://..." />
        </label>
        <label class="field">
          <span class="field-label">Platform</span>
          <select class="select" id="newSourcePlatform">
            <option>X</option>
            <option>TikTok</option>
            <option>Instagram</option>
            <option>Telegram</option>
          </select>
        </label>
        <button class="secondary-button" data-action="add-source">Add source</button>
      </div>
      <div class="source-list" style="margin-top:18px;">${sources.map(renderSourceCard).join("")}</div>
    </section>

    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Launchable narratives</h2>
          <p>Scored against historical cases, media reuse potential, and sentiment drift.</p>
        </div>
      </div>
      <div class="signal-list">${signals.map(renderSignalCard).join("")}</div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Historical case memory</h2>
      </div>
      <div class="grid-4">
        ${historicalCases
          .map(
            (item) => `
          <div class="metric-card">
            <div class="label">${escapeHtml(item.tag)}</div>
            <div class="metric-value">${escapeHtml(item.name)}</div>
            <div class="metric-foot">${escapeHtml(item.chain)} · peak ${escapeHtml(item.peak)}</div>
          </div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderSignalToLaunch() {
  const signal = selectedSignal();
  return `
    <section class="grid-2">
      <div class="panel">
        <h2>Arm trigger</h2>
        <div class="inline-fields">
          <label class="field">
            <span class="field-label">Watch target</span>
            <input class="input" id="watchTarget" value="@marketobserver" />
          </label>
          <label class="field">
            <span class="field-label">Trigger phrase</span>
            <input class="input" id="watchTrigger" value="AI mascot OR launchable image" />
          </label>
        </div>
        <div class="inline-fields" style="margin-top:14px;">
          <label class="field">
            <span class="field-label">Chain</span>
            <select class="select" id="chainSelect">
              <option value="sol" ${state.chain === "sol" ? "selected" : ""}>Solana</option>
              <option value="bsc" ${state.chain === "bsc" ? "selected" : ""}>BSC</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Mode</span>
            <select class="select" id="launchModeSelect">
              <option value="manual" ${state.launchMode === "manual" ? "selected" : ""}>Confirm first</option>
              <option value="auto" ${state.launchMode === "auto" ? "selected" : ""}>Auto after match</option>
            </select>
          </label>
          <label class="field">
            <span class="field-label">Wallet group</span>
            <select class="select" id="walletGroupSelect">
              ${walletGroups.map((group) => `<option>${escapeHtml(group.name)}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="button-row" style="margin-top:20px;">
          <button class="primary-button" data-action="arm-launch">Arm watcher</button>
          <button class="secondary-button" data-action="simulate-trigger">Simulate trigger</button>
        </div>
      </div>
      <div class="panel">
        <h2>Current trigger signal</h2>
        ${renderSignalCard(signal)}
        <div class="drawer-card" style="margin-top:14px;">
          <div class="label">Auto path</div>
          <p>Signal match -> Agent draft -> launch package -> wallet group execution plan -> community pack.</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Armed launch watchers</h2>
      </div>
      <div class="timeline-list">
        ${state.armedLaunches
          .map(
            (item) => `
            <div class="timeline-item">
              <strong>${escapeHtml(item.chain)}</strong>
              <div>
                <div>${escapeHtml(item.trigger)}</div>
                <div class="record-meta">${escapeHtml(item.walletGroup)} · ${escapeHtml(item.mode)}</div>
              </div>
              <span class="pill green">${escapeHtml(item.status)}</span>
            </div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderBuilder() {
  const signal = selectedSignal();
  const draft = ensureDraft();
  return `
    <section class="grid-2">
      <div class="panel">
        <h2>Meme brief</h2>
        <label class="field">
          <span class="field-label">Input link, post, or angle</span>
          <textarea class="textarea" id="briefInput">${escapeHtml(state.customBrief)}</textarea>
        </label>
        <div class="drawer-card" style="margin:14px 0;">
          <div class="label">Selected signal</div>
          <p>${escapeHtml(signal.title)}</p>
        </div>
        <div class="button-row">
          <button class="primary-button" data-action="generate-draft">Generate launch pack</button>
          <button class="secondary-button" data-action="send-to-launch">Send to launch</button>
        </div>
      </div>
      <div class="panel">
        <h2>Identity</h2>
        <div class="grid-2">
          <div class="metric-card">
            <div class="label">Token name</div>
            <div class="metric-value">${escapeHtml(draft.name)}</div>
          </div>
          <div class="metric-card">
            <div class="label">Ticker</div>
            <div class="metric-value">$${escapeHtml(draft.ticker)}</div>
          </div>
        </div>
        <div class="drawer-card" style="margin-top:14px;">
          <div class="label">Narrative</div>
          <p>${escapeHtml(draft.story)}</p>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="section-head">
        <h2>Generated assets</h2>
      </div>
      <div class="output-grid">
        ${renderOutputCard("Launch tweet", draft.launchTweet)}
        ${renderOutputCard("Telegram pinned message", draft.telegram)}
        ${renderOutputCard("24h operations plan", draft.operations)}
        ${renderOutputCard("Narrative risk watch", draft.risk)}
      </div>
    </section>
  `;
}

function renderLaunchConsole() {
  const draft = ensureDraft();
  const launchPackage = state.lastLaunchPackage;
  const checklist =
    launchPackage?.checklist || [
      { item: "Token media", status: "ready" },
      { item: "X post binding", status: "ready" },
      { item: "Telegram room", status: "ready" },
      { item: "Dev wallet", status: "ready" },
      { item: "Wallet group plan", status: "ready" },
      { item: "Contribution signature", status: "ready" },
    ];
  return `
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Launch package</h2>
          <p>${escapeHtml(draft.name)} / $${escapeHtml(draft.ticker)}</p>
        </div>
        <button class="primary-button" data-action="build-package">Build launch package</button>
      </div>
      <div class="inline-fields">
        <label class="field">
          <span class="field-label">Chain</span>
          <select class="select" id="launchChain">
            <option value="sol" ${state.chain === "sol" ? "selected" : ""}>Solana</option>
            <option value="bsc" ${state.chain === "bsc" ? "selected" : ""}>BSC</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Platform</span>
          <select class="select" id="platformSelect">
            <option ${state.platform === "Pump.fun" ? "selected" : ""}>Pump.fun</option>
            <option ${state.platform === "LetsBonk" ? "selected" : ""}>LetsBonk</option>
            <option ${state.platform === "FourMeme" ? "selected" : ""}>FourMeme</option>
            <option ${state.platform === "Clanker" ? "selected" : ""}>Clanker</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Dev wallet</span>
          <select class="select">
            <option>Dev Wallet 01</option>
            <option>Dev Wallet 02</option>
          </select>
        </label>
        <label class="field">
          <span class="field-label">Wallet group</span>
          <select class="select">
            ${walletGroups.map((group) => `<option>${escapeHtml(group.name)}</option>`).join("")}
          </select>
        </label>
      </div>
    </section>

    <section class="launch-flow">
      <div class="launch-step"><strong>01 Identity</strong><p>${escapeHtml(draft.name)} · $${escapeHtml(draft.ticker)}</p></div>
      <div class="launch-step"><strong>02 Social binding</strong><p>X post, Telegram room, launch copy ready.</p></div>
      <div class="launch-step"><strong>03 Wallet group</strong><p>Buy/sell amounts preconfigured.</p></div>
      <div class="launch-step"><strong>04 Contribution</strong><p>${state.contributionRate}% selected, profit-only settlement.</p></div>
    </section>

    <section class="grid-2">
      <div class="panel">
        <h2>Launch checklist</h2>
        <div class="timeline-list">
          ${checklist
            .map(
              (item) => `
              <div class="timeline-item">
                <span class="pill ${String(item.status).includes("needs") ? "amber" : "green"}">${escapeHtml(item.status)}</span>
                <strong>${escapeHtml(item.item)}</strong>
                <span>OK</span>
              </div>`,
            )
            .join("")}
        </div>
      </div>
      <div class="panel">
        <h2>${launchPackage ? "API launch package" : "Launch output"}</h2>
        ${
          launchPackage
            ? `<div class="drawer-card" style="margin-bottom:14px;">
                <div class="label">Package ID</div>
                <p>${escapeHtml(launchPackage.packageId)} / ${escapeHtml(launchPackage.chain)} / ${escapeHtml(launchPackage.platform)}</p>
              </div>`
            : ""
        }
        ${renderOutputCard("Description", draft.story)}
        <div style="height:14px;"></div>
        ${renderOutputCard("Post", draft.launchTweet)}
      </div>
    </section>
  `;
}

function renderWalletOps() {
  return `
    <section class="wallet-matrix">
      <div class="panel">
        <div class="section-head">
          <div>
            <h2>Wallet groups</h2>
            <p>Create operational groups for launch buying, selling, treasury actions, rewards, or settlement routing.</p>
          </div>
        </div>
        <div class="toolbar wallet-toolbar">
          <label class="field">
            <span class="field-label">Group name</span>
            <input class="input" id="walletGroupName" placeholder="Launch Group A" />
          </label>
          <label class="field compact-field">
            <span class="field-label">Chain</span>
            <select class="select" id="walletGroupChain">
              <option>SOL</option>
              <option>BSC</option>
            </select>
          </label>
          <label class="field compact-field">
            <span class="field-label">Wallets</span>
            <input class="input" id="walletGroupCount" type="number" min="1" max="500" value="12" />
          </label>
          <label class="field compact-field">
            <span class="field-label">Balance</span>
            <input class="input" id="walletGroupBalance" type="number" min="0" step="0.001" value="0" />
          </label>
          <button class="secondary-button" data-action="add-wallet-group">Add group</button>
        </div>
        <div class="grid-2">
          ${walletGroups
            .map(
              (group) => `
            <div class="wallet-group">
              <div class="signal-meta">
                <span class="pill cyan">${escapeHtml(group.chain)}</span>
                <span class="pill">${group.wallets} wallets</span>
              </div>
              <h3>${escapeHtml(group.name)}</h3>
              <div class="metric-value">${escapeHtml(group.balance)}</div>
              <div class="mini-table">
                <div class="mini-row"><span>Buy plan</span><strong>${escapeHtml(group.buyPlan)}</strong><span></span></div>
                <div class="mini-row"><span>Sell plan</span><strong>${escapeHtml(group.sellPlan)}</strong><span></span></div>
              </div>
            </div>`,
            )
            .join("")}
        </div>
      </div>
      <div class="panel">
        <h2>Contribution settlement preview</h2>
        <div class="drawer-card">
          <div class="label">Profit rule</div>
          <p>Compare selected wallet group total balance before buy and after sell. If the group is net profitable, positive wallets route ${state.contributionRate}% of group profit by net-gain share.</p>
        </div>
        <div class="mini-table">
          <div class="mini-row"><span>Before buy</span><strong>18.420 SOL</strong><span></span></div>
          <div class="mini-row"><span>After sell</span><strong>21.860 SOL</strong><span></span></div>
          <div class="mini-row"><span>Group profit</span><strong>3.440 SOL</strong><span></span></div>
          <div class="mini-row"><span>Contribution</span><strong>${(3.44 * state.contributionRate / 100).toFixed(4)} SOL</strong><span></span></div>
        </div>
        <button class="secondary-button" style="margin-top:16px;" data-action="open-contribution">Open settlement</button>
      </div>
    </section>
  `;
}

function renderCommunityOps() {
  const draft = ensureDraft();
  const posts =
    state.language === "zh"
      ? [
          {
            title: "X update",
            body: `$${draft.ticker} 不是另一个 ticker，而是一个时间线信号：市场先看见了 meme，才看见图表。`,
          },
          {
            title: "Telegram response",
            body: "CA 已置顶。只从官方频道验证账号链接。比赛细节和奖励规则会在发射稳定后发布。",
          },
          {
            title: "Meme contest",
            body: `第一轮：创作最好的 ${draft.name} 图片。奖励用 $${draft.ticker} 支付，由社区投票决定获奖者。`,
          },
          {
            title: "Operations action",
            body: "如果情绪连续 6 小时保持正向，准备销毁或捐赠公告。如果 FUD 上升，优先发布钱包凭证。",
          },
        ]
      : [
          {
            title: "X update",
            body: `$${draft.ticker} is not another ticker. It is a timeline signal: the market saw the meme before it saw the chart.`,
          },
          {
            title: "Telegram response",
            body: `CA pinned. Verify the account links only from official channels. Contest details and reward rules will be posted after launch stability check.`,
          },
          {
            title: "Meme contest",
            body: `Round 1: create the best ${draft.name} image. Rewards paid in $${draft.ticker}. Community vote decides winners.`,
          },
          {
            title: "Operations action",
            body: `If sentiment stays positive for 6h, prepare a burn or donation announcement. If FUD rises, publish wallet receipts first.`,
          },
        ];
  return `
    <section class="grid-3">
      <div class="metric-card">
        <div class="label">Tracked mentions</div>
        <div class="metric-value">1,284</div>
        <div class="metric-foot">$${escapeHtml(draft.ticker)} + CA + project name</div>
      </div>
      <div class="metric-card">
        <div class="label">Sentiment</div>
        <div class="metric-value">68%</div>
        <div class="metric-foot">positive / creative</div>
      </div>
      <div class="metric-card">
        <div class="label">FUD risk</div>
        <div class="metric-value">Low</div>
        <div class="metric-foot">creator account stable</div>
      </div>
    </section>
    <section class="panel">
      <div class="section-head">
        <div>
          <h2>Community content pack</h2>
          <p>X, Telegram, contest, and treasury action drafts.</p>
        </div>
        <button class="primary-button" data-action="refresh-community">Generate new pack</button>
      </div>
      <div class="content-grid grid-2">
        ${posts
          .map(
            (post) => `
            <div class="content-card">
              <div class="section-head">
                <h3>${escapeHtml(post.title)}</h3>
                <button class="copy-button" data-copy="${escapeHtml(post.body)}">Copy</button>
              </div>
              <div class="content-body">${escapeHtml(post.body)}</div>
            </div>`,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderRecords() {
  return `
    <section class="panel">
      <div class="section-head">
        <h2>Activity records</h2>
        <button class="secondary-button" data-action="clear-records">Clear demo records</button>
      </div>
      <div class="records-list">${records.map(renderRecordRow).join("")}</div>
    </section>
  `;
}

function renderSignalCard(signal) {
  return `
    <button class="signal-card ${signal.id === state.selectedSignalId ? "selected" : ""}" data-action="select-signal" data-id="${escapeHtml(signal.id)}">
      <div>
        <div class="signal-meta">
          <span class="pill cyan">${escapeHtml(signal.network)}</span>
          <span>${escapeHtml(signal.source)}</span>
          <span>${escapeHtml(signal.comparable)}</span>
        </div>
        <h3>${escapeHtml(signal.title)}</h3>
        <p>${escapeHtml(signal.angle)}</p>
        <div class="signal-meta">
          <span class="pill green">score ${signal.score}</span>
          <span class="pill ${signal.risk === "low" ? "green" : signal.risk === "watch" ? "amber" : "rose"}">risk ${escapeHtml(signal.risk)}</span>
          <span class="pill">${escapeHtml(signal.sentiment)}</span>
        </div>
      </div>
      <div class="grade ${gradeClass(signal.grade)}">${escapeHtml(signal.grade)}</div>
    </button>
  `;
}

function renderSourceCard(source) {
  return `
    <div class="source-card">
      <div>
        <div class="signal-meta">
          <span class="pill cyan">${escapeHtml(source.platform)}</span>
          <span class="pill ${source.status === "live" ? "green" : "amber"}">${escapeHtml(source.status)}</span>
        </div>
        <h3>${escapeHtml(source.handle)}</h3>
        <p>${escapeHtml(source.focus)}</p>
      </div>
      <div class="label">${escapeHtml(source.lastSeen)}</div>
    </div>
  `;
}

function renderOutputCard(title, body) {
  return `
    <div class="output-card">
      <div class="section-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="copy-button" data-copy="${escapeHtml(body)}">Copy</button>
      </div>
      <pre>${escapeHtml(body)}</pre>
    </div>
  `;
}

function renderRecordRow(record) {
  return `
    <div class="record-row">
      <strong>${escapeHtml(record.time)}</strong>
      <div>
        <div>${escapeHtml(record.type)}</div>
        <div class="record-meta">${escapeHtml(record.detail)}</div>
      </div>
      <span class="pill">${escapeHtml(record.route)}</span>
      <span class="pill ${record.status === "done" ? "green" : "amber"}">${escapeHtml(record.status)}</span>
    </div>
  `;
}

function selectView(view) {
  state.activeView = view;
  saveWorkspace();
  render();
}

async function runScan() {
  try {
    const result = await postJson("/api/source/scan", { sources, language: state.language });
    if (Array.isArray(result.sources)) {
      sources.splice(0, sources.length, ...result.sources);
    }
    if (Array.isArray(result.signals) && result.signals.length) {
      signals.splice(0, signals.length, ...result.signals);
      state.selectedSignalId = result.signals[0].id;
      state.generated = null;
    }
    addRecord(
      result.record?.type || "Scan completed",
      result.record?.detail || `${signals.length} signals refreshed`,
      result.record?.route || "Narrative API",
      result.record?.status || "done",
    );
    showToast("Scan refreshed by local API");
    render();
    return;
  } catch {
    sources.forEach((source, index) => {
      source.status = "live";
      source.lastSeen = `${index + 1}m`;
    });
    signals[0].score = Math.min(99, signals[0].score + 1);
    addRecord("Scan completed", `${signals.length} signals refreshed`, "Local fallback");
    showToast("Scan refreshed locally");
    render();
  }
}

function addSource() {
  const input = document.getElementById("newSourceInput");
  const platform = document.getElementById("newSourcePlatform");
  const handle = input?.value.trim();
  if (!handle) {
    showToast("Add a source first");
    return;
  }
  sources.unshift({
    id: `src-${Date.now()}`,
    platform: platform.value,
    handle,
    focus: "new media, repeated phrases, launchable signals",
    status: "queued",
    lastSeen: "new",
  });
  addRecord("Source added", `${platform.value} · ${handle}`, "Narrative Agent");
  render();
}

function addWalletGroup() {
  const nameInput = document.getElementById("walletGroupName");
  const chainInput = document.getElementById("walletGroupChain");
  const countInput = document.getElementById("walletGroupCount");
  const balanceInput = document.getElementById("walletGroupBalance");
  const name = nameInput?.value.trim();
  const chain = chainInput?.value || "SOL";
  const wallets = Math.max(1, Number(countInput?.value || 1));
  const balance = Math.max(0, Number(balanceInput?.value || 0));

  if (!name) {
    showToast("Name the wallet group first");
    return;
  }

  walletGroups.unshift({
    name,
    chain,
    wallets,
    balance: `${balance.toFixed(chain === "SOL" ? 3 : 4)} ${chain === "SOL" ? "SOL" : "BNB"}`,
    buyPlan: "not configured",
    sellPlan: "25 / 50 / 75 / 100%",
  });
  addRecord("Wallet group added", `${name} · ${wallets} wallets`, "Wallet Ops");
  showToast("Wallet group added");
  render();
}

async function generateDraft() {
  const input = document.getElementById("briefInput");
  state.customBrief = input?.value || "";
  try {
    const result = await postJson("/api/narrative/generate", {
      signal: selectedSignal(),
      brief: state.customBrief,
      language: state.language,
    });
    state.generated = result.draft || buildDraft(selectedSignal(), state.customBrief);
    addRecord("Meme pack generated", `$${state.generated.ticker} launch assets`, "Narrative API");
    showToast("Launch pack generated by local API");
  } catch {
    state.generated = buildDraft(selectedSignal(), state.customBrief);
    addRecord("Meme pack generated", `$${state.generated.ticker} launch assets`, "Local fallback");
    showToast("Launch pack generated locally");
  }
  render();
}

function armLaunch() {
  const target = document.getElementById("watchTarget")?.value || "@marketobserver";
  const trigger = document.getElementById("watchTrigger")?.value || "launchable signal";
  const chainSelect = document.getElementById("chainSelect");
  const launchModeSelect = document.getElementById("launchModeSelect");
  const walletGroupSelect = document.getElementById("walletGroupSelect");
  state.chain = chainSelect?.value || state.chain;
  state.launchMode = launchModeSelect?.value || state.launchMode;
  state.armedLaunches.unshift({
    id: `arm-${Date.now()}`,
    trigger: `${target} · ${trigger}`,
    chain: state.chain === "sol" ? "Solana" : "BSC",
    walletGroup: walletGroupSelect?.value || walletGroups[0].name,
    mode: state.launchMode === "auto" ? "Auto after match" : "Confirm first",
    status: "armed",
  });
  addRecord("Launch armed", `${target} watcher configured`, "Signal-to-Launch", "armed");
  showToast("Watcher armed");
  render();
}

function simulateTrigger() {
  state.generated = buildDraft(selectedSignal(), "Triggered from watched account update.");
  addRecord("Trigger matched", `${selectedSignal().source} produced launchable signal`, "Signal-to-Launch");
  state.activeView = "builder";
  render();
}

async function buildPackage() {
  const chain = document.getElementById("launchChain");
  const platform = document.getElementById("platformSelect");
  if (chain) state.chain = chain.value;
  if (platform) state.platform = platform.value;
  const draft = ensureDraft();
  try {
    const result = await postJson("/api/launch/package", {
      draft,
      chain: state.chain,
      platform: state.platform,
      contributionRate: state.contributionRate,
      walletGroups,
      launchMode: state.launchMode,
      language: state.language,
    });
    state.lastLaunchPackage = result.launchPackage || null;
    addRecord("Launch package built", `${draft.name} on ${state.chain.toUpperCase()} / ${state.platform}`, "Launch API");
    showToast("Launch package ready");
  } catch {
    state.lastLaunchPackage = null;
    addRecord("Launch package built", `${draft.name} on ${state.chain.toUpperCase()} / ${state.platform}`, "Local fallback");
    showToast("Launch package ready locally");
  }
  render();
}

function refreshCommunity() {
  addRecord("Community pack generated", `${ensureDraft().ticker} content set refreshed`, "Community Agent");
  showToast("Community pack refreshed");
  render();
}

function copyText(text) {
  const value = text || "";
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(value).then(() => showToast("Copied"));
    return;
  }
  const temp = document.createElement("textarea");
  temp.value = value;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand("copy");
  temp.remove();
  showToast("Copied");
}

function openContribution() {
  document.getElementById("drawerOverlay").classList.remove("hidden");
  document.getElementById("contributionDrawer").classList.remove("hidden");
}

function closeContribution() {
  document.getElementById("drawerOverlay").classList.add("hidden");
  document.getElementById("contributionDrawer").classList.add("hidden");
}

function toggleLanguage() {
  state.language = state.language === "zh" ? "en" : "zh";
  localStorage.setItem(LANGUAGE_KEY, state.language);
  saveWorkspace();
  render();
  showToast(state.language === "zh" ? "已切换中文" : "Switched to English");
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => selectView(item.dataset.view));
});

document.getElementById("languageToggleBtn").addEventListener("click", toggleLanguage);
document.getElementById("quickScanBtn").addEventListener("click", runScan);
document.getElementById("openContributionBtn").addEventListener("click", openContribution);
document.getElementById("closeContributionBtn").addEventListener("click", closeContribution);
document.getElementById("drawerOverlay").addEventListener("click", closeContribution);
document.getElementById("contributionRate").addEventListener("input", (event) => {
  state.contributionRate = Number(event.target.value);
  localStorage.setItem("narraops.contributionRate", String(state.contributionRate));
  saveWorkspace();
  renderSideStats();
  if (state.activeView === "wallets" || state.activeView === "launch" || state.activeView === "dashboard") {
    render();
  }
});

root.addEventListener("click", (event) => {
  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    copyText(copyButton.dataset.copy);
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;

  if (action === "select-signal") {
    state.selectedSignalId = button.dataset.id;
    state.generated = buildDraft(selectedSignal(), state.customBrief);
    saveWorkspace();
    render();
    return;
  }
  if (action === "scan") runScan();
  if (action === "add-source") addSource();
  if (action === "generate-draft") generateDraft();
  if (action === "send-to-launch") selectView("launch");
  if (action === "open-builder") selectView("builder");
  if (action === "go-narratives") selectView("narratives");
  if (action === "go-signal") selectView("signal");
  if (action === "go-records") selectView("records");
  if (action === "add-wallet-group") addWalletGroup();
  if (action === "arm-launch") armLaunch();
  if (action === "simulate-trigger") simulateTrigger();
  if (action === "build-package") buildPackage();
  if (action === "refresh-community") refreshCommunity();
  if (action === "open-contribution") openContribution();
  if (action === "clear-records") {
    records.length = 0;
    saveWorkspace();
    showToast("Demo records cleared");
    render();
  }
});

loadWorkspace();
render();
loadServerWorkspace();
