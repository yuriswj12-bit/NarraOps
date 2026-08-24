# NarraOps — 完整项目上下文（合并文档，供 Grok 协作使用）

> 以下内容由本地仓库多个文档合并生成，未包含任何密钥/凭据/敏感值。
> 生成日期：2026-08-23 · 分支 main · HEAD faabb06 · 工作树干净

---

<!-- ===== FILE: README.md ===== -->

# NarraOps

NarraOps is an AI-native narrative discovery and meme operations workspace.

It helps Meme Devs reduce the cost of finding, filtering, and understanding memeable internet narratives, then turns selected narratives into editable launch parameters and live launch/trade workflows.

## Product Direction

NarraOps is not trying to become another trading terminal or generic launchpad interface. The product connects narrative discovery to real execution:

- discover narrative opportunities from public internet signals;
- explain the story, evidence, risks, and crowding behind each opportunity;
- turn selected narratives into editable launch parameters;
- use Assets wallet groups for real launch and post-launch trading operations;
- submit irreversible actions only after an explicit final confirmation.

The primary product surfaces are:

- `Pulse`: evidence-backed narrative discovery and opportunity filtering.
- `Go`: Agent workspace for analysis, plan generation, and structured task cards.
- `Assets`: wallet-group, asset view, and execution-preparation surface.

Launch adapters remain backend tools. They are not a first-level product surface.

## Current Product State

This repository contains the current live product implementation. Pulse, GMGN read-only market data, wallet groups, launch, and direct wallet Swap flows use real providers when configured. Provider outages or missing credentials are reported as unavailable/data gaps; they must never be replaced with fabricated data or simulated execution.

Current capabilities include:

- Pulse opportunity cards and public-evidence research fixtures.
- Go Agent conversations, structured cards, task state, and SSE replay.
- Editable launch drafts and live launch adapters with explicit confirmation.
- Wallet groups, transfer previews, and asset views.
- Supabase auth and analytics migration foundation.
- GMGN read-only market data, direct Solana Swap, and launch-platform integrations.

Live signing, transaction submission, custody, and fund execution require authenticated provider configuration and an explicit user confirmation at the point of action.

Pump Launch already has a production prepare/sign/submit flow. Its NarraOps
Agent Runtime integration is being introduced behind independent feature flags:
trusted semantic shadow first, durable approval and execution enforcement only
after observation and rollback gates pass. Shadow records never authorize or
broadcast a transaction.

## Engineering Language Split

NarraOps should not remain a simple JavaScript-only codebase. The long-term codebase should use each language where it is strongest:

- TypeScript: product UI, API routes, Agent workflow, state machines, auth, subscriptions, wallet groups, launch adapter contracts.
- Python: Pulse data collection, evidence processing, source adapters, narrative clustering, blind evaluation, and scoring experiments.
- SQL / Supabase Postgres: users, profiles, stats, Pulse cards, Go conversations, launch-ready plans, wallet groups, usage limits, and audit events.
- OpenAPI / JSON Schema: shared contracts across frontend, backend, Python workers, and database persistence.
- Markdown: product context, architecture decisions, handoffs, and Codex task boundaries.

Existing JavaScript/MJS code may stay in place while behavior is still changing. New core contracts and high-risk state should move toward TypeScript gradually, not through a one-shot rewrite.

## Local Development

Open `index.html` for the static landing preview.

For local API mode:

```powershell
cd .\narraops-product
npm start
```

`npm start` builds the TypeScript frontend entry before starting the local services. Run the engineering checks directly with:

```powershell
npm run typecheck
npm run check
```

Then open:

```text
http://127.0.0.1:5188
```

Browser code should call relative `/api/v1` URLs. Do not hard-code local backend ports in product code.

## Safety Boundaries

- No private keys, seed phrases, wallet secrets, authorization headers, cookies, or production API keys may be committed or logged.
- Agent output is a plan or structured card, not direct permission to execute funds.
- Models must not directly access databases, private keys, signing, or broadcast capabilities.
- `submitted` is not `confirmed`.
- Real execution requires signer isolation, authenticated actor scoping, durable idempotency, policy checks, immutable audit, and confirmation reconciliation.

## Next Implementation Steps

1. Finish Supabase auth, user profile, and usage stats wiring.
2. Persist Pulse cards and evidence details behind a stable schema.
3. Connect Go to fixed-schema launch-ready plan cards.
4. Add frontend consumption of `/api/v1` Agent and Pulse contracts.
5. Add usage limits and basic SaaS-ready analytics.
6. Prepare a staging deployment with health checks, environment management, and rollback notes.



<!-- ===== FILE: AGENTS.md ===== -->

# NarraOps repository rules

Read this file, `coordination/PROJECT_STATE.md`, `coordination/DECISIONS.md`, and
`coordination/CURRENT_TASK.md` before changing code. Shared repository files are
the source of truth across Codex, OpenCode, and other sessions.

## Truth and scope

- Resolve state in this order: current code, current working tree, recent `main`
  commits, current README/rules, then older coordination documents.
- Do not mark an implemented capability pending merely because an old task board
  or handoff says so. Read history and old handoffs only when tracing a cause.
- NarraOps is an Agentic Meme Launch OS. First-level surfaces are `Go / Pulse /
  Assets`; launch and trade adapters are controlled capabilities, not primary
  navigation. Invite is out of the current product boundary.
- Do not reintroduce HertzFlow as a runtime dependency. GMGN supplies read-only
  market intelligence; fund execution uses reviewed direct adapters.

## Architecture

- Public paths stay on one domain: `/`, `/app`, `/api/v1/*`, and
  `/api/v1/events`. Browser code uses relative `/api/v1` URLs.
- Preserve the Vercel `/api/v1/*` catch-all and generated Agent Runtime and
  launch-planner bundles unless a verified replacement covers every route.
- `shared/openapi.yaml` and `shared/schemas/` are contract sources of truth.
  Decimal monetary values cross boundaries as strings.
- TypeScript owns UI/API/runtime boundaries, Python owns Pulse collection and
  evidence processing, SQL/Supabase owns durable state, and OpenAPI/JSON Schema
  owns cross-language contracts.
- Live provider gaps must remain explicit. Never replace unavailable data or
  execution with fabricated, mock, or simulated production results.

## Funds, auth, and safety

- An Agent result, task, plan, or approval suggestion is never authority to move
  funds. Every irreversible launch, swap, transfer, export, or delete keeps the
  explicit user-confirmation and authenticated actor boundary.
- User/browser wallets sign in the browser. Assets-managed wallets stay behind
  server-side encrypted custody controls. Never expose or log secrets.
- Keep `planned`, `waiting_approval`, `reserved`, `submission_pending`,
  `submitted`, `reconciliation_required`, `confirmed`, `failed`, and
  `cancelled` semantically distinct. Submitted is not confirmed.
- Unknown provider outcomes require reconciliation, never blind rebroadcast.
- Tests and canaries must never submit a real-fund transaction.

## Workflow

At task start run `git rev-parse --show-toplevel`, `git branch --show-current`,
and `git status --short`. Preserve unrelated dirty changes and never reset or
rewrite another worktree. Use `git worktree list` before branch/worktree work.

Make the smallest scoped change, update contracts with implementation, and run
the relevant typecheck, tests, build, and `git diff --check`. Do not commit
secrets. Do not push unless the task authorizes publishing.

Before switching provider or Agent, run `/handoff`. At resumption, run `/resume`.
Keep `CURRENT_TASK` small and local-state focused; move only durable facts to
`PROJECT_STATE`, durable architecture reasons to `DECISIONS`, and meaningful
remaining work to `TASK_BOARD`.



<!-- ===== FILE: PRODUCT_CONTEXT.md ===== -->

# NarraOps Product Context

更新时间：2026-07-22

## 如何使用这份文档

这是一份面向产品讨论、合作沟通和 AI 协作的统一上下文，不是上线公告。

与 GPT 或合作方讨论 NarraOps 时，应以本文描述的产品定位、当前产品边界和安全约束为准。任何标记为 Mock、Simulation、Review-only、Disabled 或 Roadmap 的能力，都不得描述为已经可用于真实资金。

## 产品身份

- **Product / Agent Name:** NarraOps
- **Token Name:** NarraOps
- **Ticker:** `NARRA`
- **Category:** On-chain
- **Positioning:** AI-native Narrative Discovery and Meme Operations Workspace
- **Current stage:** 产品建设中，尚未正式上线

一句话介绍：

> NarraOps helps Meme Devs discover, filter and explain memeable internet narratives, then turn selected narratives into reviewable launch-ready plans.

扩展介绍：

> NarraOps is an AI-native narrative discovery workspace that turns public internet signals into evidence-backed opportunity briefs and structured launch-ready plans. Execution tooling remains a controlled backend capability rather than the primary product surface.

## 愿景

NarraOps 的目标是降低 Meme Dev 发现、筛选和判断互联网叙事的成本，让更多有想法的创作者和链上用户能够把叙事转化为可审阅、可执行边界清晰的 Meme 项目预案。

产品希望把过去依赖人工盯盘、社交平台浏览和经验判断的叙事研究流程，转化为可解释、有证据、可复核的 Agent 工作流，并逐步沉淀为 Meme Dev 的叙事情报系统。

核心使命：

1. 发现具有传播潜力的 Meme 叙事。
2. 将叙事转化为可审阅的定位、内容素材和 launch-ready plan。
3. 降低用户完成链上项目创建与运营的技术门槛。
4. 保留钱包组、资产视图和执行准备能力，但不把真实执行作为 V1 主叙事。
5. 推动更开放、更丰富的 Meme 文化发展。

NarraOps 不以操纵市场、制造虚假交易或承诺收益为产品目标。所有资金相关能力必须具备明确授权、风险提示、审计记录和用户确认。

## 目标用户

- 有经验的 Meme Dev：已会使用 GMGN、Axiom 或 Launchpad，但缺少足够的叙事覆盖和筛选效率。
- 准 Meme Dev：能发现内容或掌握流量，但不熟悉发射字段、钱包组和执行准备。
- 观察型用户：不一定立即发射，只想查看互联网叙事趋势、证据和机会状态。

## 核心产品循环

```text
Pulse 发现叙事 -> 证据解释与机会筛选 -> Send to Go
-> Go 生成 launch-ready plan -> 用户审阅和编辑
-> Assets 提供钱包组与执行准备
```

Agent 负责理解意图、整理信息、生成方案和编排任务。涉及钱包、签名、转账、买卖和真实发射时，必须由确定性后端策略与隔离执行层处理，模型不得直接接触私钥或绕过用户确认。

## 产品核心面

### Go

产品核心 Agent 入口。

用户可以输入自然语言、链接、图片或接收 Pulse 传来的结构化机会，生成机会分析、叙事简报、Meme 方案、launch-ready plan 和结构化任务卡片。

计划覆盖的指令类型包括：

- Meme 创建与定位。
- X、TikTok、抖音等平台的 Meme 化叙事推荐。
- On-chain Market、Dev Wallet 和 Meme 项目分析。
- 钱包组创建、转账、资金提取计划。
- Launch-ready plan 生成和可审阅执行准备。

当前状态：对话工作台和多类结构化结果卡片已具备基础实现；资金相关结果仅允许 Simulation/Disabled。

### Pulse

机会发现和叙事证据终端。

展示由公共互联网内容、社交传播、历史 Meme 样本和链上环境形成的机会简报，包括故事摘要、原始来源、证据质量、机会状态、风险和同类拥挤度。

当前状态：页面与 API 合同已具备；Pulse 证据处理、历史分层研究和 RSS 发现基础实现已存在，生产数据源、稳定持久化和前端消费仍待接入。

### Assets

资产与钱包协作工作区。

计划支持：

- 创建和管理钱包组。
- 创建和管理单钱包组。
- 查看钱包与资产概览。
- 生成组间转账、资金提取和批量操作计划。
- 管理钱包删除、导出和恢复流程。

当前状态：资产概览、钱包组、转账预览和安全门禁具有 API 与界面基础实现。真实托管、私钥导出、签名和广播默认关闭。

### 后端 Launch 工具

Launch 相关能力不再作为一级产品面，但保留为 Go 可调用的后端工具能力。

当前保留的适配方向包括：

- Pump.fun / Solana
- Four.Meme / BSC
- Pons / Robinhood Chain

这些能力必须服从用户确认、安全开关、审计记录和真实执行默认关闭的边界。

## Agent 输出形式

Agent 不只返回聊天文本，还应返回可审阅的结构化结果：

- Opportunity Brief
- Narrative Snapshot
- Dev Market Report
- Meme Analysis
- Meme Package
- Launch-ready Plan
- Execution Plan
- Recent Summary
- Task Progress / Failure / Recovery Card

长任务通过 SSE 返回进度和结果事件。前端必须区分 `planned`、`signing`、`submitted`、`confirmed` 和失败状态；`submitted` 不等于成功。

## V1 上线边界

### 当前产品应完成

- 使用 Go 生成机会分析、叙事简报、Meme 方案和 launch-ready plan。
- 使用 Pulse 查看带来源与风险说明的机会简报。
- 创建、编辑和保存标准化发射预案。
- 创建和管理钱包组及资产视图。
- 查看 Agent 任务状态和结构化结果卡片。
- 对敏感操作生成明确标记的模拟计划。

### 当前产品不承诺

- 不承诺收益、Token 价格或发射成功率。
- 不进行未经用户确认的真实自动交易。
- 不允许模型持有私钥、助记词或直接签名。
- 不将交易提交响应描述为链上确认。
- 不承诺多平台真实发射全部可用。
- 不提供托管资金安全或收益保证。
- 不在缺少认证、持久化、审计和对账时启用真实资金。

## 安全原则

1. 私钥和助记词不得进入浏览器、普通 API、日志、Git 或通用数据库字段。
2. Agent 只能生成意图和计划，不能绕过策略服务直接签名。
3. 所有资金操作必须有用户确认、幂等键、金额限制和审计事件。
4. 平台资金与用户钱包组必须使用独立身份、策略和账本。
5. 金额通过 API 传输时使用十进制字符串，避免浮点误差。
6. 只有链上达到规定最终性后，状态才能进入 `confirmed`。
7. 生产执行默认关闭，通过安全验收和显式变更后才能开启。

## 当前技术状态

已经具备：

- 顶部导航式深色产品工作台。
- Go、Pulse、Assets 三个一级产品面；Launch 和 Invite 旧代码仅作为内部可复用能力或后续材料保留，不再作为当前主叙事。
- 中英文切换、响应式布局和结构化 Agent 卡片。
- `/api/v1` Agent、Pulse、Launch、Invite、Assets API 骨架；当前产品入口以 Agent、Pulse 和 Assets 为主。
- Agent 会话、任务、SSE 事件与回放原型。
- 规划型执行状态机、幂等与敏感字段拒绝测试。
- GMGN、HertzFlow 和 Launch Platform 的适配层骨架。
- 钱包组、转账、发射预案和数据库迁移草案。
- Pons 发射与跟买编排原型。

尚未达到生产条件：

- 前端尚未完整消费真实 `/api/v1` 和 SSE。
- 缺少正式认证、授权和用户隔离。
- 主要状态仍是内存存储，未接入生产 PostgreSQL 和任务队列。
- 缺少隔离的 KMS/HSM/MPC/托管签名服务。
- 缺少完整链上广播、最终性对账、失败恢复和不可篡改审计。
- GMGN、HertzFlow、AI 图片、IPFS、RPC 等生产凭证和 SLA 未确定。
- Pons 工厂源码、ABI、升级机制和跟买报价服务仍需正式验证。
- 法务、隐私、风险披露、监控、备份和事故响应尚未完成。

## Token Utility

`NARRA` 首发阶段定位为 NarraOps 产品网络的访问与参与型 Token，不代表股权，也不承诺固定收益。

首发可落地方向：

- NarraOps Beta 和新功能优先访问。
- 更高的 Agent 任务额度和部分高级工作流权限。
- 参与叙事线索提交、社区筛选和贡献活动。
- 记录早期用户、贡献者和合作伙伴的生态身份。

Roadmap 方向：

- Agent-to-Agent 服务调用与结算。
- 社区策展和部分产品方向治理。
- Agent 服务支付与生态协作。

## Platform Revenue

当前商业模式以 SaaS 订阅和使用额度为主。

可行分层：

- Free：少量 Pulse 卡片、基础 Go 分析和有限保存。
- Pro：更多卡片、更高刷新频率、更深证据、更多 Go 预案额度。
- Team：多人项目、共享保存、导出、协作和更高 API/worker 额度。

暂不主打利润分成、发射抽成、交易抽成或收益承诺。这些模式会提前引入归因、成本核算、合规和申诉问题。

## 最适合外部传播的叙事

NarraOps 不是一个只负责生成 Meme 文案的聊天机器人，也不是承诺自动盈利的交易机器人，更不是 GMGN 或 Axiom 的替代交易终端。

它是面向 Meme Dev 的 AI 叙事发现与预案工作台：

```text
Narrative Discovery
-> Evidence-backed Opportunity Filtering
-> Launch-ready Plan
-> Wallet Group and Asset Preparation
```

## 工程语言方向

NarraOps 不应长期停留在简单 JavaScript 原型形态。后续按模块分语言：

- TypeScript：产品 UI、API、Agent 流程、权限、状态机、钱包组、订阅和 Launch Adapter 合同。
- Python：Pulse 数据采集、证据处理、网页解析、叙事聚类、历史样本评估和评分实验。
- SQL / Supabase Postgres：用户、profile、统计、Pulse 卡片、Go 会话、预案、钱包组、额度和审计。
- OpenAPI / JSON Schema：跨语言合同来源。
- Markdown：产品上下文、协作规则、handoff 和 Codex 任务边界。

现有 JS/MJS 代码可以继续保留可运行状态，但新增核心合同和高风险状态应逐步迁向 TypeScript，不做一次性重写。

## 后续需要讨论和决定的问题

与 GPT、产品顾问或合作方继续讨论时，优先回答：

1. Pulse V1 应接入哪些够用且稳定的数据源？
2. 历史 Meme 样本如何转化为可解释的 Reject / Watch / Review / High Priority 规则？
3. Go 的 launch-ready plan 固定字段、编辑流和保存流如何定义？
4. Assets 在 V1 中保留到什么深度，哪些资金执行入口必须隐藏？
5. Supabase Auth、profile、usage stats 和 analytics 如何接入前端与 API？
6. Free / Pro / Team 的额度边界如何设置？
7. 哪些核心 JS/MJS 模块优先 TS 化，哪些保留到后续？
8. 当前产品如何证明产品价值，而不依赖真实自动交易或收益承诺？
9. 上线前必须关闭或隐藏哪些尚未达到生产安全要求的入口？
10. 首发传播应突出“叙事发现”“证据筛选”还是“降低 Meme Dev 研究成本”？



<!-- ===== FILE: coordination/PROJECT_STATE.md ===== -->

# NarraOps current project state

Verified against `main` code and the local working tree on 2026-08-10.

## Product boundary

NarraOps is an Agentic Meme Launch OS that connects narrative discovery to
reviewable launch and wallet operations. The only first-level product surfaces
are:

- **Go** — Agent conversation, analysis, live market tools, editable launch
  drafts, task cards, and controlled execution entry.
- **Pulse** — evidence-backed narrative discovery plus sampled Pump.fun market
  and Dev-wallet intelligence.
- **Assets** — authenticated wallet groups, balances, custody/export controls,
  transfers, launch-wallet selection, and direct Swap preparation.

Launchpads and Swap are capabilities inside Go/Assets workflows. Invite,
referral, and a standalone launchpad/trading-terminal surface are not current
product scope.

## Runtime and application architecture

- One public Vercel domain serves `/`, `/app`, `/api/v1/*`, and
  `/api/v1/events`. `api/v1/[...path].ts` is the consolidated serverless API
  boundary; browser calls remain relative.
- The Vercel build generates and bundles the frontend, Agent Runtime
  (`api/v1/agent/runtime.cjs`), and launch planner
  (`api/v1/launch-planner.cjs`). Do not split the catch-all without replacing
  its full routing and bundle behavior.
- Go uses an OpenAI-compatible live LLM provider and live/read-only integrations.
  Missing providers return unavailable/data-gap results rather than fake data.
- Agent tasks have actor-scoped durable states, optimistic versions, event
  replay, cancellation, bounded recovery, and read APIs. The browser submits a
  task and polls its status; SSE remains available for compatible clients.
- Pulse narrative recommendation now crosses the Runtime-owned fixed Tool
  Registry as `pulse.narratives.list@1.0.0`; actor, permissions, schema
  validation, request trace, and idempotency context are assigned outside the
  model.
- Filtered GMGN trending reads cross the same boundary as
  `market.gmgn.trending@2.0.0`. Published v1 was not changed: migration 044
  advances the catalog to `narraops-agent@2` and `market-research@2` while
  retaining previous immutable versions.
- Narrative scanning and launch-source retrieval cross
  `research.public_link.read@1.0.0`; public content remains untrusted evidence
  and the existing SSRF-safe adapter is called only behind Runtime validation.
- Buy/sell planning resolves actor-owned wallet-group metadata through
  `assets.wallet_groups.list@1.0.0`. It remains a read-only projection;
  private keys, signers, wallet signatures, and execution adapters do not enter
  the Tool result or model context.
- The first financial Tool contract, `launch.pump.broadcast@1.0.0`, exists
  locally with fixed shared schemas, consumed-approval + recent-auth policy,
  immutable reservation/transaction identity, and no automatic retry. The
  local signed harness reaches it through an injected zero-network gateway,
  while it remains unregistered in the production Agent and outside production
  authority.
- Equivalent local-only fixed contracts now exist for
  `swap.solana.broadcast@1.0.0` and `assets.transfer.broadcast@1.0.0`. Both
  require an atomically consumed recent-auth approval and accept only reserved
  execution identity, semantic-envelope digest, state version, and immutable
  transaction hash. They contain no private key or signed transaction bytes,
  have no automatic retry, and are neither published nor connected to
  production authority.
- `GET /api/v1/agent/capabilities` provides a client-neutral discovery contract
  for Go, Pulse, Assets, and future clients. It projects only the current
  published Agent/Skill capability metadata and explicitly withholds system
  instructions, internal identifiers, checksums, binding config, Memory
  content, and execution credentials. Production reports zero published
  financial Tools.
- The Agent control plane now persists immutable Agent/Skill versions and
  actor-bound durable Memory in Supabase. Executable tools, permissions,
  approvals, and provider selection remain Runtime code.
- Runtime knowledge resolution occurs before Model Provider selection.
  `AGENT_KNOWLEDGE_ENABLED=true` in production, and only confirmed bounded
  Memory plus the immutable Agent manifest enter the Model request.
- `backend/agent-runtime/`, Agent v2 schemas, and migrations 023–043 introduce a
  provider-neutral Runtime, safe context references, tool contracts, durable
  approvals, execution reservations, semantic envelopes, Pump transaction
  inspection, and reconciliation.

## Go, Pulse, and Assets status

- **Go:** live conversation/task flow, provider-backed replies, GMGN read-only
  research, Pulse/Assets context references, editable Pump launch drafts, and
  frontend task polling are implemented. Current local UI changes simplify the
  conversation/launch card and harden timeouts and retries.
- **Pulse:** public narrative, market-index, Dev-wallet PnL, and user-state APIs
  are implemented. Inputs are real evidence, direct Solana sampling, and
  read-only GMGN data. Coverage, history warm-up, and source gaps stay visible.
- **Assets:** Web3 signed sessions, actor ownership, wallet groups, encrypted
  wallet provisioning/export, balances, transfers, and Go wallet selection are
  implemented. Current local UI changes harden session loss, load failures,
  wallet/group creation, and deletion behavior.

## Wallet, launch, and Swap boundaries

- Web3 login proves control of the connected Solana/EVM wallet and scopes
  account data. User-owned browser-wallet transactions are built server-side
  but signed by the wallet extension.
- Pump.fun launch uses a direct prepare → browser sign → validate → submit →
  reconcile path. Semantic shadow and approval dual-run are recorded behind
  independent feature flags and cannot authorize or broadcast.
- Solana Swap uses Jupiter to prepare a transaction for an Assets wallet and
  browser signature; NarraOps validates/submits the signed bytes directly.
- Every irreversible action requires explicit confirmation. A provider-accepted
  signature is `submitted`, not `confirmed`; uncertain results become
  `reconciliation_required`. Go displays that state as unknown/reconciling and
  explicitly warns against signing or launching again.
- `AGENT_PUMP_ENFORCEMENT_ENABLED` remains off. The production launch path is
  still the existing direct path while Runtime enforcement is tested.

## Supabase and deployment

- Supabase supplies Web3 identities/sessions, actor-owned conversations/tasks,
  Pulse state, Assets persistence, durable task events, approvals, execution
  reservations, semantic shadows, and append-only audit records under RLS and
  service-role-only RPC boundaries.
- The latest backend handoff records production migrations through 034 as
  applied and rollback canaries as clean. Their repository migration files are
  still uncommitted in this working tree and must be preserved.
- Production semantic shadow and Pump approval dual-run are recorded as enabled;
  Pump enforcement is recorded as absent/off.
- Production also includes Agent control-plane migrations
  `20260810043000` through `20260810061500`. The reviewed
  `narraops-agent@1` and four read-only Skills are published. Self-cleaning
  catalog and authenticated production Memory/knowledge canaries passed and
  left no test users, conversations, tasks, or Memory rows.
- Production deployment `https://narra-dmvju6d5j-hek.vercel.app` is aliased to
  `https://www.narraops.xyz`; Memory API and Runtime knowledge are enabled,
  while Pump enforcement remains off.

## Explicit unfinished work and blockers

- The signed Pump enforcement harness, Supabase concurrent reservation canary,
  and legacy-response compatibility test now pass without broadcasting.
  Enforcement remains off pending an explicit authorized rollout. Automated or
  production tests must not send a real transaction.
- Current verification passes API/Runtime tests (133/133), execution tests
  (35/35), typecheck, 28 Agent schema parses, the Vercel production build, and
  `git diff --check`. Supabase local/remote migrations match through
  `20260810070000`; lint reports one existing unused local variable warning in
  `agent_transition_execution_v1`.
- Model selection for ordinary replies and structured narrative/meme/launch
  content now goes through the Agent-version Model Policy and registered Model
  Gateway. Business handlers retain a compatibility fallback only when the
  optional control-plane dependencies are absent.
- Production catalog and Runtime canary now verify `narraops-agent@2`,
  `pulse.narratives.list@1.0.0`, `market.gmgn.trending@2.0.0`, and
  `assets.wallet_groups.list@1.0.0`, plus the safe public capabilities
  projection and zero published financial Tools; the 13-check canary retries
  and verifies cleanup, and does not sign or broadcast.
- Go exposes an authenticated Memory manager. Proposed user preferences/facts
  are reviewable but cannot enter Agent context until explicit confirmation.
  Production browser QA confirms Go renders, the Memory entry is visible, and
  unauthenticated access stops at wallet login.
- Launch/Swap/Transfer have not cut over from legacy direct handlers to the
  provider-neutral Tool/Execution Gateway; keep the compatibility path until
  parity, reconciliation, and rollback are verified.
- Pulse still has bounded sampling and evidence/history gaps; do not label
  partial coverage as a complete market census.
- The primary working tree contains substantial uncommitted Runtime, migration,
  API, frontend, and styling work. See `coordination/CURRENT_TASK.md` and
  `git status --short` before any edit.



<!-- ===== FILE: coordination/DECISIONS.md ===== -->

# Durable architecture decisions

Only decisions that future Agents must preserve belong here.

1. **Product surfaces are Go / Pulse / Assets.** Launchpads and trading are
   controlled workflow capabilities, not first-level navigation. Invite and
   referral are deferred. This keeps NarraOps focused on narrative-to-operation
   rather than becoming a generic launchpad or trading terminal.

2. **The public app is single-domain.** Keep `/`, `/app`, `/api/v1/*`, and
   `/api/v1/events`; frontend code calls relative paths. The Vercel catch-all is
   intentional because it centralizes serverless routing, shared auth, and the
   generated Agent Runtime/launch-planner bundles.

3. **Contracts are explicit and cross-language.** `shared/openapi.yaml` and
   `shared/schemas/` define API/runtime boundaries. Monetary decimals cross
   boundaries as strings. Product state names must not be collapsed for UI
   convenience.

4. **Production truth is never simulated.** A missing LLM, market feed, RPC,
   database, or provider is an unavailable/data-gap result. Mock fixtures may be
   used only in tests and must never masquerade as live product data or an
   executed transaction.

5. **GMGN is read-only intelligence.** It supplies market/trending/K-line/token
   research. It is not the authority for fund execution. Do not restore old
   GMGN launch/swap wording or execution coupling.

6. **HertzFlow is not a NarraOps runtime dependency.** Historical handoffs and
   visual inspiration may mention it, but the reviewed product runtime no longer
   integrates it. Do not reintroduce profile-local or unverified HertzFlow code.

7. **Wallet signing follows custody ownership.** Connected user wallets sign in
   the browser. Assets-managed wallets use server-side encrypted custody and
   narrowly scoped operations. Private keys never enter ordinary browser/API
   payloads, logs, Git, model context, or general database fields.

8. **Pump and Jupiter are direct execution adapters.** Pump launch is prepared
   and inspected server-side, signed by the user wallet, then validated before
   direct submission. Solana Swap uses a Jupiter-built transaction plus Assets
   wallet/browser signature. Read-only provider results never grant execution.

9. **Agent intent is not fund authority.** Model output may propose a tool call
   or launch plan, but irreversible execution requires an authenticated actor,
   exact intent digest, explicit approval/signature, durable idempotency,
   transaction inspection, audit evidence, and reconciliation.

10. **Execution states preserve crash and provider uncertainty.**
    `submission_pending` claims one signed transaction before the external
    call; `submitted` is written only after provider acceptance of the same
    signature; unknown outcomes become `reconciliation_required` and are never
    blindly rebroadcast.

11. **Agent Runtime migration is incremental.** Keep the current Go/launch/swap
    behavior behind a compatibility facade while v2 context, tasks, approvals,
    envelopes, and execution are shadowed and verified. Feature flags are
    independent. Never enable Pump enforcement before the no-broadcast signed
    harness and rollback gate pass.

12. **Supabase authorization is server-enforced.** Actor ownership, RLS,
    service-role-only financial RPCs, optimistic state versions, and immutable
    audit are boundaries, not optional implementation details. Client timestamps
    or model assertions cannot establish recent authentication or ownership.

13. **Context recovery is deliberately small.** Default Agent context is
    `AGENTS + PROJECT_STATE + DECISIONS + CURRENT_TASK + git status/diff +
    task-related code`. Load TASK_BOARD, handoffs, Git history, GitHub, or
    unrelated code only when needed to choose work or trace a cause.

14. **Agent configuration and memory are a server-only control plane.** Agent
    and Skill definitions are immutable, checksummed versions; Skills contain
    declarative instructions/schema/dependencies but never executable code.
    Durable Memory is actor-bound, source-attributed, lifecycle-versioned, and
    user facts/preferences require explicit confirmation. Models receive only a
    bounded safe projection after Runtime resolution and never receive database
    handles. Global actor Memory has `agent_id = null`; Agent-specific Memory is
    filtered by `agent_id`.

15. **Model policy belongs to the Agent version, not Go or a business
    handler.** Conversation replies and structured launch content use the same
    provider-neutral Model Gateway. Provider adapters may be replaced without
    changing task, tool, approval, execution, or card contracts; an allowed
    provider must also be registered before use.

16. **Published Tool and Skill schemas are immutable.** A business handler
    needing wider inputs publishes a new semantic Tool version and a new Skill
    version, then advances the Agent definition version. Existing versions
    remain registered for replay and compatibility. `market.gmgn.trending@1`
    was therefore preserved while filtered market reads moved to `2.0.0` under
    `market-research@2` and `narraops-agent@2`.



<!-- ===== FILE: coordination/CURRENT_TASK.md ===== -->

# Current task

## Goal

Prioritize the NarraOps Agent as the product operating system: stabilize the
Go Agent main chain (conversation, `/analyze-meme`, `/launch`, session restore),
harden Card/API contracts against field drift, and land the first business
skills and user analytics tools. Wallet/gateway authority rollout is frozen
until the Agent main chain and acceptance coverage are stable.

## Completed

- Agent main-chain audit complete: Go conversation, `/analyze-meme`, `/launch`,
  session restore, and message submission are wired through the conversation
  path with 140/140 API tests; all production Agent routes verified non-404.
- Added a launch-draft token contract test guarding `bundle_buy_total` and
  `initial_buy` against future frontend/backend field drift, plus secret and
  non-object rejection.
- Published `narraops-agent@3` with `launch.plan`/`meme.plan` capabilities and
  the first business skill `meme-launch-plan@1` (declarative, `write_reversible`,
  bound to `research.public_link.read` + `pulse.narratives.list`). Bootstrap
  `--apply` ran successfully against production; `/capabilities` reports v3 and
  five skills with zero published financial tools.
- Added actor-scoped user analytics: `createUserAnalyticsService` queries only
  the authenticated user's `go_launch_drafts` and `asset_transfers` and returns
  safe aggregates. New `account.launches.summary`, `account.project.performance`,
  and `account.pnl.summary` handlers are wired through `/my-launches`,
  `/my-projects`, `/my-pnl` and Chinese natural-language intents. Handlers return
  `data-gap` without an actor or configured service. API now 145/145; deployed
  to `narra-j1df1kp99-hek.vercel.app` (anonymous task access returns 401 as
  expected for actor-scoped data).
- Published the three analytics skills (`user-launches-summary`,
  `user-project-performance`, `user-pnl-summary`) into the production catalog
  and added Go frontend cards (`user_launch_summary` /
  `user_project_performance` / `user_pnl_summary`) with metrics and per-entry
  lists. Production `/capabilities` now reports Agent v3 with 8 skills
  (4 read + meme-launch-plan + 3 analytics), zero published financial tools.
  Bootstrap applied with the user-provided service-role key.
- Wired `meme-launch-plan` end-to-end: `launch.meme` results carry
  `skill: "meme-launch-plan"`, the Go launch draft card renders the skill tag,
  and a runtime test asserts `/launch` produces an editable launch_draft card
  with launch parameters and required wallet-group selections. Deployed to
  `narra-fos3e7025-hek.vercel.app`; production bundle includes the skill tag.
- Enabled confirmed Memory prefill for launch amounts: `handleMessage` injects
  `runtimeKnowledge.memories` as `context.memory_prefill`, `launch.meme` parses
  cooking/bundled amounts and default-chain preferences, and prefills
  `initial_buy`/`bundle_buy_total` only when the user did not provide them.
  `buildDraftMetadata` now preserves `bundle_buy_total`. Parser and handler
  tests prove prefill works and explicit input wins. API now 148/148; deployed
  to `narra-522l1f9qq-hek.vercel.app`.
- Extended Memory prefill to default wallet groups and slippage, added the
  Go Memory modal quick templates for launch defaults and Chinese replies, and
  verified proposal/review/confirm/forget UI/API paths. API tests 149/149;
  deployed frontend to `narra-5va0ofuus-hek.vercel.app`.
- Extended Memory prefill to default wallet groups and slippage: parses cooking/
  bundled wallet-group names and slippage percent from confirmed Memory, applies
  them as editable launch-draft prefill, exposes `slippage_bps` in
  `launch_parameters`, and adds a slippage input to the Go launch card.
  Explicit input still wins. API now 149/149; deployed to
  `narra-q1i2aenfn-hek.vercel.app`.
- Removed the frontend local natural-language reply shortcuts. Go natural
  language now always enters the Agent conversation/Model Gateway path instead
  of returning the same static response for questions such as "你能做什么" or
  "你家吗". Deployed to `narra-21oyh5602-hek.vercel.app`; API 149/149.
- OpenCode closed out the dirty tree: secret scan clean, 74 changes grouped
  into 5 scoped commits (Runtime v2 core, control plane, migrations 023-035,
  product-route wiring, docs) and pushed to `yuriswj12-bit/NarraOps` main.
  Working tree clean, typecheck green, no untracked leftovers.
- Added `docs/engineering/financial-gateway-rollout.md`: per-operation
  Shadow -> Canary -> Full -> Rollback rollout plan for
  `assets.transfer.broadcast`, `swap.solana.broadcast`,
  `launch.pump.broadcast` with independent flags, observation metrics,
  rollback triggers, and red lines. No production authority is switched.
- Pump broadcast wired through `launch.pump.broadcast@1.0.0` Tool gateway:
  `submitPumpBroadcastViaGateway` gated by
  `AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED` (default off) in
  `api/v1/agent/runtime.ts` and called from the Pump submit branch in
  `api/v1/[...path].ts`. Consumed-approval/exact-intent checks enforced by
  the Tool Registry; legacy response fields preserved. API/Runtime now
  134/134 with a dedicated gateway test.
- Deployed to production (`narra-4jse3cydv-hek.vercel.app`, aliased to
  `www.narraops.xyz`). Health and capabilities verified. Production env now
  has `AGENT_PUMP_GATEWAY_AUTHORITY_ENABLED=false`; enforcement stays off, so
  the direct path remains authority and the gateway branch is unreachable.
- Built the Swap Runtime execution chain mirroring Pump:
  `recordSolanaSwapSemanticShadow`, `prepareSolanaSwapRuntimeExecution`, and
  `submitSolanaSwapViaGateway` in `api/v1/agent/runtime.ts`, wired into
  `submitDirectSwap` behind `AGENT_SWAP_SEMANTIC_SHADOW_ENABLED`,
  `AGENT_SWAP_ENFORCEMENT_ENABLED`, and `AGENT_SWAP_GATEWAY_AUTHORITY_ENABLED`.
  Swap now records a real semantic shadow, envelope, approval dual-run,
  reserve, and `submission_pending` before the Tool gateway. API/Runtime now
  135/135. Deployed to `narra-7bxi9075b-hek.vercel.app`; production has
  `AGENT_SWAP_SEMANTIC_SHADOW_ENABLED=true` (shadow observing) and the
  enforcement/gateway flags off.
- Added live Solana transfer endpoints to the Vercel API:
  `POST /api/v1/transfers/preview` and `POST /api/v1/transfers`, with
  actor-owned wallet-group source, external/group destination, encrypted-vault
  Solana signing (`unsealAssetWalletSecret` + `broadcastSolanaTransfer`), and
  migration 045 (`asset_transfer_previews`/`asset_transfers`, service-role
  only). Migrations through `20260810075000` are applied remotely. API now
  136/136. Deployed to `narra-2jimje6hu-hek.vercel.app`; the   transfer endpoints
  return 401 when unauthenticated (previously 404).
- Added the Transfer Runtime execution chain mirroring Swap/Pump:
  `recordAssetTransferSemanticShadow`, `prepareAssetTransferRuntimeExecution`,
  and `submitAssetTransferViaGateway` in `api/v1/agent/runtime.ts`, wired into
  `transferCreate` behind `AGENT_TRANSFER_SEMANTIC_SHADOW_ENABLED`,
  `AGENT_TRANSFER_ENFORCEMENT_ENABLED`, and
  `AGENT_TRANSFER_GATEWAY_AUTHORITY_ENABLED`. Transfer now records a real
  semantic shadow, envelope, approval dual-run, reserve, and
  `submission_pending` before the Tool gateway (broadcast identity routed
  through the Tool after custody signing). API now 137/137. Deployed to
  `narra-51f3ejy6m-hek.vercel.app`; production has
  `AGENT_TRANSFER_SEMANTIC_SHADOW_ENABLED=true` (shadow observing) and the
  enforcement/gateway flags off.





- OpenCode verified the Codex Agent control-plane handoff against the dirty
  tree: catalog/memory contracts, services, migrations 035-044 and Supabase
  mirrors, Memory API routes, and bootstrap script all present. Independent
  verification: typecheck green, Runtime/API 133/133, execution 35/35, 28 Agent
  schemas parsed, Vercel build passes, `git diff --check` clean,
  `AGENT_PUMP_ENFORCEMENT_ENABLED` off locally (no `.env`).

- Fixed repository typecheck with zero behavior change: restored
  `// @ts-nocheck` to line 1 of `backend/api/src/app.ts` and narrowed the
  `PromiseSettledResult` access in `agent-runtime-v2.test.ts`.
- Added the injected/no-broadcast signed Pump harness as a new test in
  `backend/api/tests/agent-runtime-v2.test.ts`. It builds a real Pump
  transaction, walks signature validation -> wallet-signature approval
  consume/reservation -> semantic-envelope binding -> `submission_pending` ->
  counting fake observation provider (confirmed path and chain-timeout path),
  and asserts zero real RPC broadcasts. API/Runtime now 115/115.

- Added provider-neutral Runtime contracts for context, tools, model gateway,
  durable tasks/events, approvals, execution reservations, semantic envelopes,
  audit, Pump transaction inspection, wallet-signature evidence, and read-only
  reconciliation.
- Added database/Supabase migrations 023-034 and rollback/privilege canaries.
  Production Supabase has migrations through 034.
- Resolved the local duplicate migration number by moving the Assets encrypted
  vault migration from local 021 to local 035; its already-applied production
  migration timestamp remains unchanged.
- Added the Agent control plane: versioned Agent definitions, declarative Skill
  definitions/bindings, actor-bound durable Memory, provenance, optimistic
  lifecycle transitions, user confirmation, audit, service-role-only RPCs,
  Supabase repositories, and an optional Runtime knowledge resolver.
- Applied production Supabase migrations
  `20260810043000` through `20260810054500`. Self-cleaning canaries exercised
  Agent/Skill publish and manifest read, Memory propose/confirm/retrieve/forget,
  public-role privilege denial, exact Runtime Skill enums, and global actor
  memory retrieval.
- Published reviewed `narraops-agent@1` plus four read-only Skills
  (`pulse-research`, `assets-wallet-context`, `market-research`, and
  `public-link-research`) through migration 042 / `20260810060000`. No
  financial or execution Skill was published.
- Added feature-flagged authenticated Memory APIs for proposal, explicit
  confirm/reject, active-list, and forget. Mutations require trusted same-origin
  requests; only global user preferences/facts are accepted in this MVP.
- Production Pump semantic shadow and approval dual-run are enabled and
  observed. The latest unsigned canary returned `requires_user_signature`,
  recorded shadow + requested approval, signed nothing, broadcast nothing, and
  cleaned all temporary records.
- Added `submission_pending`: it claims one exact signed transaction before an
  external call. `submitted` is written only after provider acceptance.
- Added provider-neutral model policy routing for both conversational replies
  and structured narrative/meme/launch content. The Agent version policy, not
  Go or a provider adapter, selects the registered provider.
- Enabled authenticated Memory APIs and read-only Runtime knowledge in
  production. A self-cleaning production canary passed proposal, replay, actor
  isolation, confirmation, retrieval, origin, forget/redaction, and Runtime
  knowledge checks.
- Added Go Memory management for proposing user preferences/facts, reviewing
  pending proposals, explicit confirm/reject, listing active Memory, and
  forget/redaction. Migration 043 / `20260810061500` adds an actor-scoped,
  service-role-only review RPC.
- Browser QA found and fixed an older comment-boundary bug that had excluded
  the real Go conversation restore/submit helpers from the production bundle.
  Go now renders, the Memory button is visible, and unauthenticated access opens
  wallet login before any Memory read.
- Routed the first real business read through the fixed Tool Registry:
  `narrative.recommend` executes `pulse.narratives.list@1.0.0` with an
  actor-bound Runtime context and `pulse:read`; the model receives only the
  validated result.
- Added and ran a self-cleaning Supabase concurrency canary for wallet-signed
  execution reservation. Two independent clients produced one reservation,
  one idempotent replay, one approval audit, rejected evidence drift, performed
  zero broadcasts, and left no canary rows.
- Fixed the Pump response compatibility boundary. Runtime execution metadata is
  additive to the legacy `go.launch_execution.v1` response, and Go no longer
  reports `reconciliation_required` as a successful launch or encourages a
  duplicate submission.
- Published immutable `narraops-agent@2` and `market-research@2`, which bind
  filtered GMGN trending reads to `market.gmgn.trending@2.0.0`. Tool v1 remains
  registered and unchanged for replay/compatibility. Migration 044 /
  `20260810070000` is applied in production.
- Routed narrative scanning and launch-source retrieval through the already
  published `research.public_link.read@1.0.0` Tool. The SSRF-protected adapter
  remains the implementation, but actor, permission, trace, timeout, and input
  schema enforcement now belong to the Runtime.
- Routed actor-owned wallet-group selection for buy/sell planning through
  `assets.wallet_groups.list@1.0.0`. This remains read-only context: public
  addresses are resolved only after ownership, and signing/execution authority
  is unchanged. The work also fixed explicit `wallet group <name>` parsing
  taking precedence over a nearby currency symbol.
- Defined the first financial Tool boundary,
  `launch.pump.broadcast@1.0.0`, with shared input/output schemas. It accepts
  only server-side execution/reservation identity, envelope digest, state
  version, and tx hash; never private keys or signed bytes. It requires
  `launch:execute`, consumed approval, recent auth, and has retry policy
  `none`. The local signed no-broadcast harness now invokes it through an
  injected zero-network execution gateway and proves one exact call after
  `submission_pending`; it remains unregistered in the production Agent and
  outside production authority.
- Added public `GET /api/v1/agent/capabilities`, backed by the current immutable
  Supabase Agent manifest. Its fixed schema exposes only the published Agent,
  safe capability names, Model Provider names, Memory availability, and
  published Skill/Tool dependencies. It never exposes system instructions,
  checksums, database IDs, binding configuration, Memory content, or execution
  credentials. Production currently reports Agent v2, four read-only Skills,
  and zero published financial Tools.
- Hardened Tool schema validation for UUID/date-time/URI formats and fixed
  latest Tool selection to compare semantic versions numerically.
- Added local-only `swap.solana.broadcast@1.0.0` and
  `assets.transfer.broadcast@1.0.0` financial Tool contracts with fixed shared
  schemas. Like Pump, they accept only reserved execution/approval identity,
  state version, semantic-envelope digest, and immutable transaction hash.
  They require consumed recent-auth approval, preserve provider-acceptance
  semantics, have no automatic retry, and never carry private keys or signed
  transaction bytes. Injected zero-network tests prove their gateways are not
  reached before approval. Neither Tool is published or connected to
  production authority.
- Added visible Go Launch `bundle_buy_total` input. Pump now freezes a
  deterministic `TOTAL_RANDOM` allocation whose amounts sum exactly to the
  requested SOL total, binds that allocation into the approval intent, waits
  for the T1-T5 window after the Cooking launch, then signs/broadcasts each
  bundled-wallet buy through the encrypted vault with per-wallet results.
  Legacy launch responses remain unchanged when no bundled buy is requested.
- Latest production deployment is
  `https://narra-pgf1rgjz3-hek.vercel.app`, aliased to
  `https://www.narraops.xyz`.
- Latest verification: Runtime/API 138/138, execution 35/35, typecheck green,
  28 Agent schemas, Vercel build, Supabase migration parity through
  `20260810070000`, 13-check production capabilities/Memory/knowledge/Pulse/
  GMGN/Assets Tool canary, Supabase reservation concurrency canary, browser QA,
  and `git diff --check` pass.

## In progress

All current business changes are committed and pushed on `main`.
`AGENT_PUMP_SEMANTIC_SHADOW_ENABLED=true` and
`AGENT_PUMP_APPROVAL_DUAL_RUN_ENABLED=true` are in production.
`AGENT_PUMP_ENFORCEMENT_ENABLED` is absent/off, so the existing direct Pump
prepare/sign/submit path remains production authority.
`AGENT_KNOWLEDGE_ENABLED=true` and `AGENT_MEMORY_API_ENABLED=true`; the Runtime
resolves the immutable Agent version plus confirmed bounded Memory before model
selection. No database handle, signer, or execution authority reaches a model.

## Modified files

Use `git status --short` as the exact source. Main groups are
`api/v1/[...path].ts`, `api/v1/agent/runtime.ts`, `backend/agents/`,
`backend/agent-runtime/`, `backend/api/`, `shared/openapi.yaml`,
`shared/schemas/agent/`, migrations 023-044 and Supabase mirrors,
`scripts/canary/`, the Agent architecture audit, Go/Assets frontend files, and
the shared coordination/OpenCode command files. Preserve unrelated UI changes.

## Remaining

1. Done: consolidated production acceptance canary
   (`scripts/canary/production-agent-acceptance.mjs`) passes on narraops.xyz —
   /recent-summary, /my-launches, /my-projects, /my-pnl, /launch
   (launch_draft + meme-launch-plan), /analyze-meme, and durable event replay,
   all with a fresh random wallet and full cleanup. Browser-side acceptance
   steps remain in `docs/engineering/agent-main-chain-acceptance.md`.
2. REMINDER from user: run the remaining real-browser acceptance pass:
   authenticate in Go, propose/confirm a launch preference with the Memory
   quick template, verify it appears in production `agent_memory_items`, then
   run `/my-launches`, `/my-projects`, `/my-pnl`, and `/launch` to confirm the
   analytics cards and Memory-prefilled launch card render end-to-end.
3. Wallet/gateway authority rollout stays frozen until the Agent main chain is
   stable.
4. Do not expand live fund execution beyond the current direct path.

## Known blockers

Pump enforcement evidence gates pass without broadcasting. Production
enforcement stays off until the Agent main chain and acceptance coverage are
stable. Pulse coverage remains sampled/partial. Bootstrapping new Agent/Skill
versions to production requires the Supabase service-role key (provided by the
user).

## Do not break

Do not reset, clean, stash, or overwrite the dirty tree. Do not perform a
real-fund/token-launch test. Never blind-rebroadcast an unknown submission,
collapse `submitted` into `confirmed`, bypass explicit user signing, expose
wallet secrets, reintroduce HertzFlow runtime coupling, or split the Vercel
catch-all/generated bundles without full route parity.



<!-- ===== FILE: coordination/TASK_BOARD.md ===== -->

# Current task board

This board contains only work that is still useful after checking current code.
`coordination/CURRENT_TASK.md` is the source for the active local work.

| Area | Task | Status |
|---|---|---|
| Product | Keep first-level product surfaces to Go / Pulse / Assets | Done |
| Frontend | Consume relative `/api/v1` Go, Pulse, Assets, auth, launch, and Swap APIs | Done |
| Agent | Use live LLM/read providers and expose provider gaps instead of production mocks | Done |
| Agent | Persist actor-scoped tasks/events and support status polling, cancellation, replay, and recovery | Done |
| Auth/Assets | Web3 sessions, actor-owned wallet groups, encrypted provisioning/export, and transfer flows | Done |
| Launch | Direct Pump prepare, browser sign, validation, submit, confirmation, and reconciliation path | Done |
| Swap | Jupiter transaction preparation plus Assets wallet/browser signature and direct submission | Done |
| Deployment | Preserve Vercel `/api/v1/*` catch-all and generated Runtime/launch-planner bundles | Done |
| Agent v2 | Preserve and finish the uncommitted Runtime/contracts/migrations 023–043 integration | In progress |
| Agent v2 | Observe production Pump semantic shadow and approval dual-run with enforcement off | In progress |
| Frontend | Finish and verify current uncommitted Go/Assets reliability and simplified UI changes | In progress |
| Coordination | Keep OpenCode `/resume`, `/handoff`, and compact current-state documents accurate | Done |
| Agent v2 | Test signed Pump enforcement through an injected no-broadcast provider harness | Done |
| Agent control plane | Persist versioned Agent/Skill catalog and actor-bound Memory behind service-role-only RPCs | Done |
| Agent control plane | Deploy self-cleaning Supabase canaries for catalog, confirmation, forget, enum parity, and global memory | Done |
| Agent control plane | Publish reviewed `narraops-agent@1` catalog and canary-enable optional Runtime knowledge | Done |
| Agent control plane | Add feature-flagged authenticated Memory propose/confirm/list/forget APIs | Done |
| Agent control plane | Route conversation and structured launch content through Agent-version Model Policy | Done |
| Agent control plane | Route Pulse narrative reads through `pulse.narratives.list@1.0.0` Tool Registry contract | Done |
| Agent control plane | Publish Agent/market Skill v2 and route filtered GMGN reads through immutable Tool v2 | Done |
| Agent control plane | Route public narrative/launch-source reads through `research.public_link.read@1.0.0` | Done |
| Agent control plane | Route actor-owned trade-plan wallet selection through `assets.wallet_groups.list@1.0.0` | Done |
| Agent control plane | Add Go settings/UI for reviewing and deleting Memory | Done |
| Frontend | Restore real Go conversation helpers excluded by legacy fixture comment | Done |
| Agent v2 | Prove wallet-signed reservation concurrency/idempotency against Supabase with zero broadcasts | Done |
| Agent v2 | Preserve legacy Pump response fields and display unknown chain outcomes without false success | Done |
| Agent v2 | Define fixed-schema `launch.pump.broadcast@1.0.0` with consumed-approval/recent-auth gate and no signed bytes | Done (local/shadow only) |
| Agent v2 | Define fixed-schema `swap.solana.broadcast@1.0.0` with consumed-approval/recent-auth gate and no signed bytes | Done (local only, unpublished) |
| Agent v2 | Define fixed-schema `assets.transfer.broadcast@1.0.0` with consumed-approval/recent-auth gate and no signed bytes | Done (local only, unpublished) |
| Agent control plane | Expose safe public Agent/Skill capability discovery without instructions, internal IDs, Memory, or execution credentials | Done |
| Agent v2 | Enable Pump enforcement only after harness, canary, rollback, and parity gates pass | Blocked by explicit authorized rollout; enforcement remains off |
| Execution | Move launch/Swap/Transfer authority into the provider-neutral Tool/Execution Gateway | All three wired and deployed (flags off; shadow observing); rollout plan in `docs/engineering/financial-gateway-rollout.md` |
| Pulse | Improve real source coverage and history while preserving sampled/partial labels | Pending |
| QA | Full dirty-tree verification: API 133/133, execution 35/35, typecheck, 28 schemas, Vercel build, migration parity and 13-check production canary | Done |



<!-- ===== FILE: coordination/handoffs/grok-build.md ===== -->

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


<!-- ===== FILE: SECURITY.md ===== -->

# Security Policy

NarraOps is an early prototype. Treat every wallet, execution, authentication, and data-isolation feature as security-sensitive.

## Current security status

Real-fund execution is part of the live product when the production GMGN/signer providers are configured. The application must expose provider outages as unavailable/data-gap states, never as fabricated success or simulation. All irreversible launches and trades require authenticated actor scoping, durable idempotency, policy checks, explicit final confirmation, provider reconciliation, immutable audit, and operational monitoring.

## Supported security scope

Security reports are welcome for:

- secret exposure risks;
- private key, seed phrase, cookie, authorization header, or API key handling;
- authentication and account isolation flaws;
- Supabase RLS or user data isolation issues;
- SSRF, unsafe redirects, or unbounded external fetch behavior;
- execution-state confusion, especially `submitted` being treated as `confirmed`;
- idempotency, replay, or duplicate execution risks;
- unsafe wallet export, signing, or broadcast paths;
- dependency or supply-chain vulnerabilities;
- stored or reflected injection issues;
- unsafe logging of sensitive data.

## Out of scope

Do not perform:

- real-fund transactions as part of testing;
- phishing, social engineering, or credential collection;
- denial-of-service testing against hosted services;
- attacks against third-party APIs, launchpads, wallets, RPC providers, or social platforms;
- attempts to access data belonging to real users;
- public disclosure before a fix is available.

## Sensitive data rules

Never commit or log:

- private keys;
- seed phrases;
- wallet vault files;
- Supabase secret or service-role keys;
- API keys or bearer tokens;
- cookies;
- authorization headers;
- signing payload secrets;
- production database URLs;
- user phone numbers outside the intended authenticated data path.

Placeholder values are allowed when they are clearly non-secret, for example `REPLACE_IN_SECRET_MANAGER`.

## Agent and model boundary

The Agent may generate intent, plans, summaries, and reviewable cards.

The Agent must not:

- directly access private keys or seed phrases;
- directly sign transactions;
- bypass policy services;
- bypass user confirmation;
- treat a model response as an execution authorization;
- fabricate live data when an integration is disabled, unavailable, or unsupported;
- expose profitability scores or guaranteed-success claims.

## Execution boundary

Execution-related systems must preserve these distinctions:

- `planned` means an operation has been prepared.
- `signing` means signing is underway or requested.
- `submitted` means a transaction was sent to a network or provider.
- `confirmed` requires chain reconciliation and finality rules.

A submitted response is not a confirmed result.

## Reporting a vulnerability

Open a private communication channel with the maintainer before disclosing details publicly.

If GitHub private vulnerability reporting is enabled for this repository, use it. Otherwise, contact the repository owner directly and include:

- a short description of the issue;
- affected files, routes, or workflows;
- reproduction steps;
- expected impact;
- whether any secret or user data may be exposed;
- suggested fix, if known.

Do not include real private keys, seed phrases, production tokens, or user data in a report.

## Fix standard

A security fix should include, where applicable:

- regression tests;
- updated API/schema contracts;
- updated handoff documentation;
- explicit notes about remaining blockers;
- confirmation that real-fund execution remains disabled unless the change is specifically reviewed to enable it.



