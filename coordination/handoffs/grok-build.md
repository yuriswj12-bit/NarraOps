# Grok Build handoff — NarraOps Agent 工作链

> 生成日期：2026-08-23 · 交接给 Grok Build 联合协作
> 源事实：`coordination/PROJECT_STATE.md`、`coordination/CURRENT_TASK.md`、
> `coordination/DECISIONS.md`、`coordination/TASK_BOARD.md`、当前 `main` 提交。

## 1. 项目是什么

NarraOps 是一个 **Agentic Meme Launch OS**：把「叙事发现 → 分析 → meme 发射 → 钱包操作」
串成一条工作链。第一级产品面只有三个：

- **Go** — Agent 对话、分析、发射草稿、任务卡片、受控执行入口
- **Pulse** — 证据驱动的叙事发现 + 采样 Pump.fun 市场/Dev 钱包情报
- **Assets** — 认证钱包组、余额、托管/导出、转账、发射钱包选择、直接 Swap 准备

Launchpads / Swap 是 Go / Assets 工作流里的能力，不是第一级导航。Invite 不在范围。

## 2. 当前技术栈与部署

- **单域部署**：Vercel 一个项目承载 `/`、`/app`、`/api/v1/*`、`/api/v1/events`。
  浏览器一律用相对路径 `/api/v1`。
- **生产 URL**：`https://www.narraops.xyz`（Vercel 项目 `hek/narra-ops`）。
- **分支**：`main`，origin `https://github.com/yuriswj12-bit/NarraOps.git`。
  当前 HEAD：`faabb06`，工作树干净。
- **核心构建产物**：
  - `api/v1/agent/runtime.cjs` — Agent Runtime 打包（`npm run build:agent-runtime`）
  - `api/v1/launch-planner.cjs` — launch planner 打包
  - `app.js` — 前端打包（`npm run build:frontend`）
  - Vercel 构建执行 `build:vercel`（前端 + 两个 bundle + 静态准备）。
  这些产物被 gitignore，但每次 `vercel --prod` 构建都会重新生成。
- **数据**：Supabase（RLS + service-role-only RPC）。生产迁移已应用到
  `20260810070000`。生产 env：`SUPABASE_URL` / `SUPABASE_SECRET_KEY`、
  `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL=deepseek-v4-flash`（OpenCode Go，
  `https://opencode.ai/zen/go/v1`）、`GMGN_API_KEY` 等。

## 3. Agent 聊天链路（最近的工作核心）

普通聊天（非发射/非分析意图）走**流式 SSE**，实现如下：

```
前端 streamPlainChat(frontend/src/app.ts)
  → POST /api/v1/agent/chat/stream
  → api/v1/agent/runtime.ts: streamAgentChat
      → detectNarrativeChatIntent(text)        // 叙事意图判定
      → 若命中：查 pulse_narrative_candidates 按 5 类别分组
      → task.result.pulse_narratives.categories
  → backend/agents/llm-provider.ts: streamAgentReply
      → DeepSeek 流式，纯文本，逐 delta 输出
  → SSE: event:start → event:delta{content} → event:done
```

- **叙事 5 类别**（与 Pulse 前端一致）：
  `politics_satire` / `events` / `animals_characters` / `internet_culture` /
  `crypto_native`。
- **意图判定**：`detectNarrativeChatIntent`（`api/v1/agent/runtime.ts`）负责把
  “有哪些叙事”“看看有什么热点”“有无可发射的叙事”等识别为叙事查询；
  前端 `isLaunchIntent` / `isNarrativeDiscoveryQuestion`（`frontend/src/app.ts`）
  决定走流式聊天还是发射任务路径。
- **流式输出规范**（提示词在 `llm-provider.ts: streamAgentReply`）：按给定类别
  组织回复，每类给出数量与逐条明细；从叙事原文识别 token name/symbol
  （如 `$BTC`/`$OP`），识别不出标“未识别/unknown”，**禁止编造** symbol/价格。

## 4. 发射模板卡片

- 发射卡片（`launch_draft`）是**前端渲染的表单**（`renderLaunchDraftCard`，
  `frontend/src/app.ts`），字段：name/symbol/description/image_url/首买 SOL/
  X/Website/Cooking 钱包组/捆绑钱包组/捆绑总买/滑点。
- 生成路径：`/launch <url|text>` 或前端识别为发射意图 → 任务路径
  `POST /conversations/:id/messages` → 后端 `launch.meme`（`agent-handlers.ts`）。
- **必须登录**（Web3 钱包），匿名会 401。
- **自动预填**：只从当前句 + 已确认 Memory（`memoryPrefillForLaunch`），不扫全历史。
- 无来源（用户只说“给我发射模板”）时，`launch.meme` 已改为**跳过网络请求**，
  直接生成空白可编辑模板卡片（`preparation_status: requires_enrichment`）。

## 5. 最近提交（按时间，老→新）

| Commit | 内容 |
|---|---|
| `76f6451` / `53c0d3c` | 普通聊天流式化 + 流式辅助函数 |
| `a547506` | 流式聊天注入实时 Pulse 叙事 |
| `56a3fe6` | 修复流式 SSE 跨 chunk 缓冲导致的乱码 |
| `9d44bd1` | 修复叙事意图被“发射”排除词误伤 |
| `f4da95d` | 前端叙事询问优先走流式聊天（不再改写成 /launch） |
| `c706b35` | 叙事输出按 5 类别分组 + 提取 name/symbol |
| `1127d43` | 扩展叙事意图识别（有哪些/哪些/现在有哪些等） |
| `a5f971b` | 无 URL 发射意图直接生成空白模板卡片 |
| `faabb06` | 前后端扩充发射意图识别（发币/创建代币/上币等），排除发射历史查询 |

## 6. 已验证 / 测试

- `npm run typecheck`（shared/frontend/backend-api 三套 tsconfig）通过。
- `npm run test:api` = `npm run build:agent-runtime && npm --prefix backend/api test`。
  最近基线 **151/151**（含新增回归：叙事意图分类、无 URL 空白模板卡片、
  parser 新表述）。偶发 1 个失败来自 GMGN 429 外部限流（`integrations` 里
  GMGN 依赖用例），重跑可过，**与代码无关**。
- `npm run build:frontend` / `npm run build:agent-runtime` 通过。
- 生产流式实测：首 delta ~0.5–2s，总时长 ~2–6.5s，`done` 正常，无乱码。

## 7. 下一步 / 待办

1. **前端多轮流式健壮性**：用户偶发“第三条转圈消失、刷新后回复出现”。
   已定位为后端回复已生成但前端实时渲染在某条上未刷新。当前已加强
   SSE 解析/超时/空响应兜底；如果复现，优先查 `streamPlainChat` 在
   `renderConversation` 被并发覆盖或 pending 气泡丢失的路径。
2. **叙事质量**：当前 Pulse 采集的多为新闻标题（Trump 民调、Bitcoin 价格、
   Manchester 事件），多数无 meme 代币 name/symbol。用户认可“质量不高就都
   输出”，后续可提高采集对 meme 叙事的针对性。
3. **发射卡片体验**：用户希望“检测到发射模板意图就直接弹卡片，不说废话”。
   无 URL 已能出空白模板；可考虑更聪明的参数预填（当前只当前句+Memory）。
4. **Pump 强制 / Swap / Transfer 网关**：语义 shadow 已上线、enforcement
   保持关闭，未切入 provider-neutral Tool/Execution Gateway（见
   `docs/engineering/financial-gateway-rollout.md`）。

## 8. 关键文件地图

- `frontend/src/app.ts` — `streamPlainChat`、`submitAgentConversation`、
  `isLaunchIntent`、`isNarrativeDiscoveryQuestion`、`renderLaunchDraftCard`、
  `restoreGoConversation`（刷新恢复）、`renderConversation`。
- `api/v1/agent/runtime.ts` — `streamAgentChat`、`detectNarrativeChatIntent`、
  `serverSupabase()`、`getRuntime()`。
- `api/v1/[...path].ts` — 统一 API 边界：`/chat/stream` SSE、conversation、
  auth、Pulse 等所有路由。
- `backend/agents/llm-provider.ts` — `streamAgentReply`（流式）、
  `generateAgentReply`（非流式）、`generateStructuredLaunchContent`、
  `emptyLaunchContent`、`sanitizeAgentTask`、`boundedJsonValue`。
  ⚠️ 文件是 **UTF-8 BOM + CRLF**，简单字符串匹配编辑会失败，需按 `\r\n`。
- `backend/agents/agent-handlers.ts` — `launch.meme`、`meme.analyze`、
  `resolveLaunchContext`、`readPublicLink`。
- `backend/agents/go-command-parser.ts` / `go-command-catalog.ts` —
  自然语言/斜杠命令 → 意图 type。
- `backend/api/tests/` — `agent-runtime.test.ts`(15)、`agent-runtime-v2.test.ts`(43)、
  `api.test.ts`、`integrations.test.ts`（parser 断言）、`vercel-handler.test.ts`。
- `coordination/` — `PROJECT_STATE.md`、`DECISIONS.md`、`CURRENT_TASK.md`、
  `TASK_BOARD.md`、`handoffs/`。

## 9. 硬约束（不要破坏）

- **Build in public**：密钥只进 Vercel 服务端 env，绝不提交 Git。
  `.gitignore` 已含 `.env*` 和 `.vercel`。
- **资金安全**：Agent 输出/计划/批准**不是**动钱授权。每次不可逆的发射、Swap、
  转账、导出、删除都必须保持显式用户确认 + 认证 actor 边界。绝不在浏览器/API
  载荷、日志、Git、模型上下文或通用库字段里放私钥。
- **绝不伪造生产数据**：缺失的 LLM/行情/RPC/数据库 = unavailable/data-gap，
  不用 mock 冒充实时结果。
- **保留 Vercel `/api/v1/*` catch-all 与生成的 Runtime/launch-planner bundle**，
  除非有验证过的全路由替换方案。
- 不引入 HertzFlow 运行时依赖；GMGN 只做只读情报。
- 状态语义保持：`submitted` ≠ `confirmed`；未知结果 → `reconciliation_required`，
  不盲目重播。

## 10. 部署/验证命令速查

```bash
npm run typecheck          # 三套 tsconfig
npm run build:frontend     # app.js
npm run build:agent-runtime  # runtime.cjs
npm run test:api           # build:agent-runtime + backend/api 全量测试
npx vercel --prod --force --yes   # 部署生产并 alias 到 www.narraops.xyz
git push origin main       # 推送（已连 Vercel git 会自动触发构建）
```