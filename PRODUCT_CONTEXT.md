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
