# Grok Build handoff — NarraOps 项目完整交接

> 生成：2026-08-24 · 交接给 Grok Build 接力
> 分支 `main` · 当前 HEAD `fd47c77` · 工作树干净 · 全量 API 测试 **156/156**
> 源事实：`coordination/PROJECT_STATE.md`、`DECISIONS.md`、`CURRENT_TASK.md`、
> `TASK_BOARD.md`、`AGENTS.md`、`README.md`、本文件。

---

## 1. 项目定位

NarraOps 是一个 **Agentic Meme Launch OS**：把「叙事发现 → 分析 → meme 发射 → 钱包操作」
串成一条工作链。第一级产品面只有三个：

- **Go** — Agent 对话、分析、发射草稿、任务卡片、受控执行入口
- **Pulse** — 证据驱动的叙事发现 + 采样 Pump.fun 市场/Dev 钱包情报
- **Assets** — 认证钱包组、余额、托管/导出、转账、发射钱包选择、直接 Swap 准备

Launchpads / Swap 是 Go / Assets 工作流里的能力，不是第一级导航。Invite 不在范围。

**安全硬约束（Build in public）**：密钥只进 Vercel 服务端 env，绝不提交 Git
（`.gitignore` 已含 `.env*`/`.vercel`/`config.json`/`cookies.json`）。Agent 输出/计划
**不是**动钱授权，每次不可逆发射/换币/转账/删除保持显式用户确认 + 认证 actor 边界。
缺失的 LLM/行情/RPC/数据库 = unavailable/data-gap，绝不用 mock 冒充实时结果。

---

## 2. 技术栈、部署、环境

- **单域部署**：Vercel 一个项目承载 `/`、`/app`、`/api/v1/*`、`/api/v1/events`。
  浏览器一律用相对路径 `/api/v1`。
- **生产 URL**：`https://www.narraops.xyz`（Vercel 项目 `hek/narra-ops`，
  projectId `prj_tQkW9UcassZuzTgXNLgOtkRcc4A5`）。误建空项目 `narraops` 未删。
- **仓库**：origin `https://github.com/yuriswj12-bit/NarraOps.git`（main，已登录）。
- **数据**：Supabase（RLS + service-role-only RPC），生产迁移应用到
  `20260810070000`（历史迁移 001–045 全在 `database/migrations/`）。
- **LLM**：DeepSeek V4 Flash，经 OpenCode Go `https://opencode.ai/zen/go/v1`。
  生产 env：`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL=deepseek-v4-flash`。
- **核心构建产物**（gitignore，每次部署重建）：
  - `api/v1/agent/runtime.cjs` ← `npm run build:agent-runtime`
  - `api/v1/launch-planner.cjs`
  - `app.js` ← `npm run build:frontend`
  - Vercel 构建执行 `build:vercel`（前端 + 两个 bundle + 静态准备）。
  勿拆分 Vercel `/api/v1/*` catch-all 与生成的 bundle，除非有全路由 parity 替换。

---

## 3. Agent 聊天链路（当前架构）

普通聊天（非发射/非分析意图）走**流式 SSE**：

```
前端 streamPlainChat(frontend/src/app.ts)
  → POST /api/v1/agent/chat/stream
  → api/v1/agent/runtime.ts: streamAgentChat({ message, language, onDelta, onResult, timeoutMs })
      → shouldOpenLaunchCard(text) 若命中 → 直接跑 launch.meme 返回卡片（不走 LLM）
      → detectNarrativeChatIntent(text) 若命中 → 查 pulse_narrative_candidates 按 5 类分组
      → task.result.pulse_narratives.categories
  → backend/agents/llm-provider.ts: streamAgentReply（DeepSeek 流式纯文本）
  → SSE: event:start → event:delta{content} → event:done
```

- **`streamAgentChat` 当前签名**（`api/v1/agent/runtime.ts`）：
  `{ message, language="en", onDelta, onResult?, timeoutMs=30_000 }`。
  `onResult` 用于卡片路径（发射意图拦截后直接把结构化卡片结果回调给调用方）。
- **`shouldOpenLaunchCard(text)`**（`backend/agents/go-command-parser.ts`）：命中
  “给我模板/预案/发射卡片/再来一套/第二套”等 → 流式端点直接执行 `launch.meme`
  返回 `launch_draft` 卡片（`used_llm:false`），不生成 LLM 散文。已由
  `stream-launch-card.test.ts` 覆盖。
- **叙事意图判定** `detectNarrativeChatIntent`（runtime.ts）：覆盖
  “有哪些叙事/现在有哪些/叙事有哪些/有无可发射的叙事/看看有什么热点/pulse narrative”
  等，并排除发射历史/分析/交易意图。
- **叙事 5 类别**（与 Pulse 前端一致）：
  `politics_satire` / `events` / `animals_characters` / `internet_culture` /
  `crypto_native`。注意表 `category` check 允许 6 个（含 `ai_tech`），但**前端只渲染 5 个**，
  入库时不要写 `ai_tech`。
- **流式输出规范**（`llm-provider.ts: streamAgentReply` 提示词）：按给定类别组织回复，
  每类给数量与逐条明细；从原文识别 token name/symbol（如 `$BTC`/`$OP`），识别不出
  标“未识别/unknown”，**禁止编造** symbol/价格。
- **前端意图分流**（`frontend/src/app.ts`）：`isLaunchIntent`（发射）>
  `isNarrativeDiscoveryQuestion`（叙事查询）> `isSkillOrAnalysisIntent`（分析/交易）。
  发射/分析走任务路径（`POST /conversations/:id/messages`），普通聊天走流式。

---

## 4. 发射卡片（launch_draft）

- 卡片是**前端渲染表单**（`renderLaunchDraftCard`，`frontend/src/app.ts`），字段：
  name/symbol/description/image_url/首买 SOL/X/Website/Cooking 钱包组/捆绑钱包组/
  捆绑总买/滑点。
- **生成路径**：`/launch <url|text>` 或前端发射意图或流式 `shouldOpenLaunchCard` 命中
  → 后端 `launch.meme`（`backend/agents/agent-handlers.ts`）→ `launch_draft` card。
- **必须登录**（Web3 钱包），匿名会 401。
- **自动预填**：只从当前句 + 已确认 Memory（`memoryPrefillForLaunch`），不扫全历史。
  同一轮里带的 cooking/bundled SOL 金额会 prefill 或 patch 已有 draft。
- **无来源**（用户只说“给我发射模板”）：`launch.meme` 跳过网络请求，直接生成空白
  可编辑模板（`preparation_status: requires_enrichment`）。
- 已实现“发射意图直接弹卡片，不讲废话”：`c1c9ff8`/`959288b`/`a25b198`。

---

## 5. Pulse 叙事采集与 X 监控（新增）

- **Pulse 数据源**：`pulse_narrative_candidates` 表（迁移 018）。前端按 5 类别分列显示；
  agent 流式实时查询该表。**任何写进这张表的数据，Pulse 卡片和 Go 对话立即可见。**
- **现有 collector**：Supabase Edge Function `supabase/functions/pulse-narrative-collector`
  （RSS/Google News，`x-narraops-collector-secret` 鉴权 + 5 分钟幂等租约）。
- **`0db0a4b` 变更**：Pulse 只显示 `platform='x'` 的推文卡，去掉 Google News 新闻填充
  （前端 + `pulse-narratives.ts` + collector 同步调整）。
- **外部 X 账号监控（新增）**：
  - `scripts/x-account-monitor/` — Playwright 盯固定 X 账号公开主页 → 提取顶层推文
    （去回复/转帖）→ 规范化卡片 → POST ingest。
  - `supabase/functions/pulse-narrative-ingest/index.ts` — 接收脚本 POST
    （`x-narraops-collector-secret` 鉴权），校验（非 x.com 链接/空正文/超 4h 窗口拒绝），
    归类 5 类，算 `narrative_id`/`expires_at`，upsert 到表，记 collection run。
  - 脚本入库字段：`platform=x, source_type=monitored_account, author_name,
    original_text, source_url, media_urls, published_at, category_hint`。
  - `narrative_id = nar_<sha256(platform\0sourceId\0text.lower())[:20]>`；
    `expires_at = min(published+4h, now+4h)`。
  - 部署 ingest：`npx supabase functions deploy pulse-narrative-ingest` +
    `npx supabase secrets set PULSE_NARRATIVE_COLLECTOR_SECRET=<secret>`。
  - **cookie 不入仓库**（`.gitignore` 已忽略 `config.json`/`cookies.json`）。

---

## 6. 最近提交（main，老→新）

| Commit | 内容 |
|---|---|
| `a617f79`…`cff3576` | 双路径 LLM 回复、匿名纯聊天、超时对齐 |
| `bbd03fd` | 自然语言叙事发现（直连路径） |
| `e987673` | 选中叙事流入可编辑发射 draft |
| `8918c4b` / `e106952` | 按需读 Assets 钱包组 / 聊天建钱包组（后者已随重构移除） |
| `ac18019` | 砍市场/叙事斜杠命令 + 聊天建钱包 |
| `76f6451` / `53c0d3c` | 普通聊天流式化 |
| `a547506` | 流式注入实时 Pulse 叙事 |
| `56a3fe6` | 修复流式 SSE 跨 chunk 缓冲乱码 |
| `9d44bd1` | 修复叙事意图被“发射”排除词误伤 |
| `f4da95d` | 前端叙事询问优先走流式聊天 |
| `c706b35` | 叙事输出按 5 类别分组 + 提取 name/symbol |
| `1127d43` | 扩展叙事意图识别（有哪些/哪些/现在有哪些） |
| `a5f971b` | 无 URL 发射意图直接生成空白模板卡片 |
| `faabb06` | 前后端扩充发射意图识别（发币/创建代币/上币等） |
| `c1c9ff8` | 发射意图直接弹卡片，不生成 LLM 讲解 |
| `959288b` | 模板/预案/再来一套 路由到发射卡片 |
| `a25b198` | 流式聊天拦截“给我模板”→ launch.meme 返回卡片（`shouldOpenLaunchCard`） |
| `cdb201d` / `c856b26` | 钱包组下拉 UI 修复（替换原生 select、关下拉） |
| `0db0a4b` | Pulse 只显示 X 推文，去掉 Google News 填充 |
| `a884b3f` / `fd47c77` | 合并项目上下文文档 / X 监控脚本 + ingest + 修 collector 正则 |

---

## 7. 验证 / 测试

- **测试基线：156/156**（`npm run test:api` = `build:agent-runtime` + `backend/api` 全量）。
  偶发 1 失败来自 GMGN 429 外部限流（`integrations` GMGN 依赖用例），重跑可过，与代码无关。
- **typecheck**：`npm run typecheck`（shared / frontend / backend-api 三套 tsconfig）通过。
- **build**：`npm run build:frontend` / `npm run build:agent-runtime` 通过。
- **生产 health**：`GET /api/v1/health` → persistence=supabase、
  launch=pump_direct_wallet_signature、gmgn=read_only、direct_swap=direct_wallet_signature。
- **新测试文件**：`backend/api/tests/stream-launch-card.test.ts`
  （流式拦截“给我模板”返回 launch_draft、used_llm false、无流式 delta）。
- 测试文件清单：`agent-runtime.test.ts`(15)、`agent-runtime-v2.test.ts`(43)、
  `api.test.ts`、`integrations.test.ts`（parser 断言）、`vercel-handler.test.ts`、
  `stream-launch-card.test.ts`、`launch-transactions.test.ts`、`security.test.ts`、
  `web3-auth.test.ts`、`account-wallets.test.ts`、`user-analytics.test.ts`。
- 生产流式实测：首 delta ~0.5–2s，总时长 ~2–6.5s，done 正常，无乱码。

---

## 8. 已知问题 / 下一步

1. **前端多轮流式健壮性**：用户偶发“第三条转圈消失、刷新后回复出现”。后端已确认
   正常生成回复；前端实时渲染在某条上未刷新（可能 `renderConversation` 被并发覆盖或
   pending 气泡丢失）。已加强 SSE 解析/30s 超时/空响应兜底；如再复现，优先查
   `streamPlainChat` 的多轮状态。
2. **叙事质量**：Pulse 历史采集多为新闻标题，多数无 meme 代币 name/symbol。用户已认可
   “质量不高就都输出”。X 监控脚本（第 5 节）是提升质量的路径——需用户提供 20–50 个
   要盯的账号名单并部署 ingest。
3. **发射卡片预填**：当前只当前句 + Memory；可考虑从对话历史提取 token 参数。
4. **网关切换**：Pump/Swap/Transfer 语义 shadow 已上线、enforcement 关闭，未切入
   provider-neutral Tool/Execution Gateway（见 `docs/engineering/financial-gateway-rollout.md`）。
5. **清理误建 Vercel 项目**：`narraops`（`prj_vDwZjv1up9jGgkmsjIi4gpcJL76h`）未删，
   `vercel project rm` 需匹配 CLI 参数。

---

## 9. 关键文件地图

- `frontend/src/app.ts` — `streamPlainChat`、`submitAgentConversation`、
  `isLaunchIntent`、`isNarrativeDiscoveryQuestion`、`renderLaunchDraftCard`、
  `restoreGoConversation`、`renderConversation`。
- `api/v1/agent/runtime.ts` — `streamAgentChat`（onDelta/onResult）、
  `detectNarrativeChatIntent`、`serverSupabase()`、`getRuntime()`、`createAgentConversation`。
- `api/v1/[...path].ts` — 统一 API 边界：`/chat/stream` SSE、conversation、auth、
  Pulse、health 等全部路由。
- `backend/agents/llm-provider.ts` — `streamAgentReply`（流式）、`generateAgentReply`、
  `generateStructuredLaunchContent`、`emptyLaunchContent`、`sanitizeAgentTask`、
  `boundedJsonValue`。⚠️ 文件 **UTF-8 BOM + CRLF**，简单字符串匹配编辑会失败，
  需按 `\r\n` 精确匹配。
- `backend/agents/agent-handlers.ts` — `launch.meme`、`meme.analyze`、
  `resolveLaunchContext`、`readPublicLink`。
- `backend/agents/go-command-parser.ts` — `shouldOpenLaunchCard`、`parseGoInput`、
  NATURAL_RULES。
- `backend/integrations/pulse-narratives/` — Python 侧采集（`narrative_feed.py`、
  `narrative_pool_worker.py`、`free_source_collectors.py`、`source-registry.example.json`）。
- `supabase/functions/pulse-narrative-collector/` — RSS/新闻 collector（Deno）。
- `supabase/functions/pulse-narrative-ingest/` — 外部 X 监控入库（Deno，新增）。
- `scripts/x-account-monitor/` — Playwright X 账号监控（新增）。
- `coordination/` — `PROJECT_STATE.md`、`DECISIONS.md`、`CURRENT_TASK.md`、
  `TASK_BOARD.md`、`handoffs/`、`NARRAOPS_CONTEXT_FOR_GROK.md`（合并上下文）。
- 数据库迁移：`database/migrations/`（001–045+）。Agent 控制面/工具注册在
  `backend/agent-runtime/`。

---

## 10. 命令速查

```bash
npm run typecheck          # shared + frontend + backend-api
npm run build:frontend     # app.js
npm run build:agent-runtime  # runtime.cjs
npm run test:api           # build:agent-runtime + backend/api 全量（156/156 基线）
npx vercel --prod --force --yes   # 部署生产并 alias www.narraops.xyz
git push origin main       # 推送（已连 Vercel git，会触发构建）

# X 监控脚本
cd scripts/x-account-monitor
npm install && npx playwright install chromium
cp config.example.json config.json   # 填账号 + ingest URL
node monitor.mjs --once              # 手动验证一轮；无 --once 则按 pollMinutes 循环

# ingest 函数部署
npx supabase functions deploy pulse-narrative-ingest
npx supabase secrets set PULSE_NARRATIVE_COLLECTOR_SECRET=<secret>
```

---

## 11. 不要破坏

- 密钥/secret/cookie 绝不进 Git、日志、模型上下文、浏览器载荷或通用库字段。
- 不做真实资金/代币发射测试；不盲目重播未知提交状态；不 collapse `submitted`→`confirmed`。
- 保留 Vercel `/api/v1/*` catch-all 与生成的 Runtime/launch-planner bundle。
- 不引入 HertzFlow 运行时依赖；GMGN 只读。
- 编辑 `llm-provider.ts` 注意 BOM+CRLF；编辑 supabase functions 后需 `deno`/esbuild 语法验证。