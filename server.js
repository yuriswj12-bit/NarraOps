const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5188);
const API_UPSTREAM = process.env.NARRAOPS_API_UPSTREAM || "http://127.0.0.1:5190";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const WORKSPACE_FILE = path.join(DATA_DIR, "workspace.json");
const WORKSPACE_VERSION = 1;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function proxyApiRequest(req, res, requestUrl) {
  let target;
  try {
    target = new URL(`${requestUrl.pathname}${requestUrl.search}`, API_UPSTREAM);
  } catch {
    sendJson(res, 500, {
      error: {
        code: "AGENT_UPSTREAM_INVALID",
        message: "NARRAOPS_API_UPSTREAM is not a valid URL.",
      },
    });
    return;
  }

  const transport = target.protocol === "https:" ? https : http;
  const headers = { ...req.headers, host: target.host };
  delete headers.connection;

  const upstreamRequest = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamResponse) => {
      const responseHeaders = { ...upstreamResponse.headers };
      if (String(responseHeaders["content-type"] || "").includes("text/event-stream")) {
        responseHeaders["cache-control"] = "no-cache, no-transform";
        responseHeaders.connection = "keep-alive";
        responseHeaders["x-accel-buffering"] = "no";
      }
      res.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
      upstreamResponse.pipe(res);
    },
  );

  upstreamRequest.on("error", (error) => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    sendJson(res, 502, {
      error: {
        code: "AGENT_UPSTREAM_UNAVAILABLE",
        message: `NarraOps API is unavailable: ${error.message}`,
      },
    });
  });

  req.on("aborted", () => upstreamRequest.destroy());
  req.pipe(upstreamRequest);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function defaultWorkspace() {
  return {
    version: WORKSPACE_VERSION,
    savedAt: null,
    state: {},
    sources: [],
    signals: [],
    walletGroups: [],
    records: [],
  };
}

function scrubSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(scrubSensitive);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const blocked = /^(privateKey|private_key|secretKey|secret_key|mnemonic|seedPhrase|seed_phrase|apiKey|api_key)$/i;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      blocked.test(key) ? "[redacted]" : scrubSensitive(entry),
    ]),
  );
}

function sanitizeWorkspace(input = {}, options = {}) {
  const source = input && typeof input === "object" ? input : {};
  const state = source.state && typeof source.state === "object" ? scrubSensitive(source.state) : {};
  return {
    version: WORKSPACE_VERSION,
    savedAt:
      options.touch === false && typeof source.savedAt === "string"
        ? source.savedAt
        : new Date().toISOString(),
    state,
    sources: Array.isArray(source.sources) ? scrubSensitive(source.sources) : [],
    signals: Array.isArray(source.signals) ? scrubSensitive(source.signals) : [],
    walletGroups: Array.isArray(source.walletGroups) ? scrubSensitive(source.walletGroups) : [],
    records: Array.isArray(source.records) ? scrubSensitive(source.records).slice(0, 250) : [],
  };
}

function readWorkspace() {
  try {
    if (!fs.existsSync(WORKSPACE_FILE)) {
      return defaultWorkspace();
    }
    const parsed = JSON.parse(fs.readFileSync(WORKSPACE_FILE, "utf8"));
    return sanitizeWorkspace(parsed, { touch: false });
  } catch {
    return defaultWorkspace();
  }
}

function writeWorkspace(workspace) {
  const next = sanitizeWorkspace(workspace);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function slugWords(text) {
  const cleaned = String(text || "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/[^a-zA-Z0-9\s$#@-]/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  return words.slice(0, 4);
}

function buildAgentDraft(signal = {}, brief = "", language = "en") {
  const words = slugWords(`${brief} ${signal.title || ""} ${signal.angle || ""}`);
  const baseName =
    signal.name ||
    words
      .slice(0, 2)
      .map((word) => word.replace(/^[$#@]/, ""))
      .filter(Boolean)
      .join(" ") ||
    "Narrative Coin";
  const ticker =
    signal.ticker ||
    (words[0] || "NARR")
      .replace(/^[$#@]/, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase() ||
    "NARR";
  const story =
    brief && brief.trim()
      ? `${signal.angle || "A live internet signal is being packaged into a launchable meme narrative."}\n\nUser angle: ${brief.trim()}`
      : signal.angle || "A live internet signal is being packaged into a launchable meme narrative.";

  if (language === "zh") {
    const zhStory =
      brief && brief.trim()
        ? `${signal.angle || "一个实时互联网信号正在被包装成可发射的 meme 叙事。"}\n\n用户角度：${brief.trim()}`
        : signal.angle || "一个实时互联网信号正在被包装成可发射的 meme 叙事。";
    return {
      name: baseName,
      ticker,
      story: zhStory,
      launchTweet: `${baseName} 是把时间线时刻变成可交易叙事的 meme。\n\nTicker: $${ticker}\n信号来源：${signal.source || "operator input"}\n核心叙事：${zhStory.split("\n")[0]}`,
      telegram: `置顶：$${ticker} 发射房间已开启。\n\n叙事：${zhStory.split("\n")[0]}\n\n规则：只认官方链接，谨防仿冒，关键动作保留链上凭证。`,
      operations: `前 24 小时运营计划：\n1. 发布发射长推。\n2. 置顶 CA 和官方链接。\n3. 开启 meme 创作比赛。\n4. 追踪 CA + $${ticker} 提及。\n5. 只有在国库状态清晰后，再准备销毁、回购、捐赠或奖励文案。`,
      risk: "风险监控：追踪创建者账号叙事漂移、恶意引用、删除源帖、仿冒链接和流动性投诉。",
      agentTrace: {
        model: "local-rule-agent",
        confidence: signal.score ? clamp(Number(signal.score) / 100, 0.4, 0.98) : 0.72,
      },
    };
  }

  return {
    name: baseName,
    ticker,
    story,
    launchTweet: `${baseName} is the tradeable version of a timeline moment before consensus.\n\nTicker: $${ticker}\nSignal: ${signal.source || "operator input"}\nThesis: ${story.split("\n")[0]}`,
    telegram: `Pinned: $${ticker} launch room is live.\n\nNarrative: ${story.split("\n")[0]}\n\nRules: verify official links, avoid impersonators, keep receipts on-chain.`,
    operations: `First 24h ops:\n1. Publish launch thread.\n2. Pin CA and official links.\n3. Start meme creation contest.\n4. Monitor CA + $${ticker} mentions.\n5. Prepare burn, buyback, donation, or rewards copy only after treasury status is clear.`,
    risk: `Risk watch: track creator account drift, hostile quote posts, deleted source posts, impersonator links, and liquidity complaints before amplifying.`,
    agentTrace: {
      model: "local-rule-agent",
      confidence: signal.score ? clamp(Number(signal.score) / 100, 0.4, 0.98) : 0.72,
    },
  };
}

function scanSources(sources = [], language = "en") {
  const now = new Date();
  const normalizedSources = sources.map((source, index) => ({
    ...source,
    status: "live",
    lastSeen: `${index + 1}m`,
  }));

  const generatedSignals = normalizedSources.slice(0, 6).map((source, index) => {
    const isZh = language === "zh";
    const score = clamp(92 - index * 5 + (source.platform === "X" ? 3 : 0), 62, 98);
    const grade = score >= 90 ? "S" : score >= 80 ? "A" : score >= 70 ? "B" : "C";
    const handle = source.handle || "operator source";
    const platform = source.platform || "Custom";
    const keyword = slugWords(`${handle} ${source.focus || ""}`)[0] || "Signal";
    return {
      id: `sig-${Date.now()}-${index}`,
      title: isZh
        ? `${platform} 来源 ${handle} 出现可复用 meme 信号`
        : `${platform} source ${handle} shows repeatable meme signal`,
      source: handle,
      network: platform,
      grade,
      score,
      comparable: index < 2
        ? isZh ? "对标案例峰值：$10M+" : "Comparable case peak: $10M+"
        : isZh ? "对标案例峰值：待复核" : "Comparable case peak: under review",
      sentiment: index % 2 === 0 ? (isZh ? "加速" : "accelerating") : (isZh ? "上升" : "rising"),
      risk: index > 3 ? (isZh ? "中" : "medium") : (isZh ? "低" : "low"),
      angle: isZh
        ? `围绕 "${keyword}" 的 ${platform} 媒体重复模式，可以在市场命名它之前转化为可发射叙事。`
        : `A repeated ${platform} media pattern around "${keyword}" can be turned into a launch narrative before the market fully names it.`,
      name: `${keyword.replace(/^[$#@]/, "") || "Signal"} Loop`,
      ticker: (keyword.replace(/^[$#@]/, "") || "LOOP").slice(0, 8).toUpperCase(),
    };
  });

  return {
    scannedAt: now.toISOString(),
    sources: normalizedSources,
    signals: generatedSignals,
    record: {
      type: language === "zh" ? "扫描完成" : "Scan completed",
      detail: language === "zh"
        ? `${generatedSignals.length} 个 Agent 评分信号已刷新`
        : `${generatedSignals.length} agent-ranked signals refreshed`,
      route: language === "zh" ? "叙事 API" : "Narrative API",
      status: "done",
    },
  };
}

function buildLaunchPackage(payload = {}) {
  const isZh = payload.language === "zh";
  const draft = payload.draft || {};
  const chain = payload.chain === "bsc" ? "BSC" : "Solana";
  const platform = payload.platform || (chain === "BSC" ? "FourMeme" : "Pump.fun");
  const contributionRate = Number(payload.contributionRate || 0);
  const walletGroups = Array.isArray(payload.walletGroups) ? payload.walletGroups : [];
  const selectedGroup = walletGroups[0] || { name: "Operator Wallet Group", wallets: 0 };

  return {
    packageId: `pkg-${Date.now()}`,
    chain,
    platform,
    token: {
      name: draft.name || "Narrative Coin",
      ticker: draft.ticker || "NARR",
    },
    checklist: [
      { item: isZh ? "代币身份" : "Token identity", status: draft.name && draft.ticker ? (isZh ? "就绪" : "ready") : (isZh ? "需要输入" : "needs input") },
      { item: isZh ? "发射文案" : "Launch copy", status: draft.launchTweet ? (isZh ? "就绪" : "ready") : (isZh ? "需要输入" : "needs input") },
      { item: isZh ? "社区房间文案" : "Community room copy", status: draft.telegram ? (isZh ? "就绪" : "ready") : (isZh ? "需要输入" : "needs input") },
      { item: isZh ? "钱包组" : "Wallet group", status: selectedGroup.wallets > 0 ? (isZh ? "就绪" : "ready") : (isZh ? "需要钱包组" : "needs wallet group") },
      { item: isZh ? "贡献条款" : "Contribution terms", status: isZh ? `已选择 ${contributionRate}%` : `${contributionRate}% selected` },
    ],
    executionPlan: {
      walletGroup: selectedGroup.name,
      walletCount: selectedGroup.wallets || 0,
      mode: payload.launchMode === "auto"
        ? isZh ? "匹配后自动" : "auto after match"
        : isZh ? "先确认" : "confirm first",
      note: isZh
        ? "当前 MVP 尚未连接真实执行适配器，本发射包只作为安全规划输出。"
        : "Execution adapters are not connected in this MVP. This package is safe planning output only.",
    },
  };
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      product: "NarraOps",
      mode: "local-mvp",
      time: new Date().toISOString(),
    });
    return;
  }

  if (pathname === "/api/workspace" && req.method === "GET") {
    sendJson(res, 200, {
      workspace: readWorkspace(),
    });
    return;
  }

  if (pathname === "/api/workspace" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, {
      workspace: writeWorkspace(body.workspace || body),
    });
    return;
  }

  if (pathname === "/api/source/scan" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, scanSources(body.sources || [], body.language || "en"));
    return;
  }

  if (pathname === "/api/narrative/generate" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, {
      draft: buildAgentDraft(body.signal || {}, body.brief || "", body.language || "en"),
    });
    return;
  }

  if (pathname === "/api/launch/package" && req.method === "POST") {
    const body = await readBody(req);
    sendJson(res, 200, {
      launchPackage: buildLaunchPackage(body),
    });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = decodeURIComponent(filePath.split("?")[0]);
  const absolutePath = path.resolve(ROOT, `.${filePath}`);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const ext = path.extname(absolutePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      proxyApiRequest(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || "Internal server error",
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`NarraOps local server: http://127.0.0.1:${PORT}`);
  console.log(`Agent API proxy: ${new URL(API_UPSTREAM).origin}`);
  console.log("Mode: local MVP, no wallet or chain execution");
});
