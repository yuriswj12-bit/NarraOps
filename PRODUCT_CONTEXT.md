# NarraOps Product Context

更新时间：2026-07-21

## 如何使用这份文档

这是一份面向产品讨论、合作沟通和 AI 协作的统一上下文，不是上线公告。

与 GPT、Codex 或合作方讨论 NarraOps 时，应以本文描述的产品定位、V1 边界和安全约束为准。任何标记为 Mock、Simulation、Review-only、Disabled 或 Roadmap 的能力，都不得描述为已经可用于真实资金。

## 产品身份

- **Product / Agent Name:** NarraOps
- **Token Name:** NarraOps
- **Ticker:** `NARRA`
- **Category:** On-chain / Meme intelligence / AI workspace
- **Current stage:** 本地产品原型，尚未正式上线
- **Current positioning:** AI-native Narrative Discovery and Meme Operations Workspace

一句话介绍：

> NarraOps 帮助 Meme Dev 更低成本地发现、筛选和判断可 Meme 化的互联网叙事，并把高潜力叙事转化为可执行的发射预案。

English:

> NarraOps helps Meme Devs discover, filter and evaluate internet narratives with lower cost, then turn selected stories into launch-ready plans.

## 产品重心调整

NarraOps 的产品重心从一级 Launch 发射台前端，调整为 Pulse 叙事发现和 Go Agent 工作台。

GMGN、Axiom、Bitget Wallet 等工具已经提供成熟的交易、K 线、Launch Terminal、狙击、捆绑和手动执行能力。NarraOps 继续正面堆手动发射表单会削弱差异化。当前更高价值的方向是帮助 Meme Dev 节省叙事发现、筛选、理解和判断成本。

Launch 能力继续保留为 Go 工作流和后端 Adapter 能力。前端一级导航不再突出 Launch 页面。

## 愿景

NarraOps 的目标是降低 Meme Dev 发现、筛选和判断互联网叙事的成本，让更多具备执行能力或内容资源的用户能更快识别可 Meme 化机会。

产品希望把过去依赖人工刷信息流、社群情报和个人经验的叙事发现流程，转化为可审阅、可追踪、可解释的 Agent 工作流，并逐步向更广泛的创作者、社区和专业 Dev 开放。

核心使命：

1. 发现具有传播潜力的互联网叙事。
2. 聚合公开证据、来源和传播路径。
3. 将叙事转化为可审阅的机会卡片。
4. 帮助用户筛选和判断哪些叙事值得进一步研究。
5. 在用户选择后生成结构化发射预案，并通过受控工具流转到执行层。

NarraOps 不以操纵市场、制造虚假交易或承诺收益为产品目标。所有资金相关能力必须具备明确授权、风险提示、审计记录和用户确认。

## 目标用户

### 主要用户：Meme Dev 和小型执行团队

这类用户具备一定链上能力，知道如何使用 GMGN、Axiom、Launchpad 或钱包工具。他们的主要痛点是没有足够时间和信息覆盖面持续寻找可 Meme 化叙事。

NarraOps 向他们提供：

- 叙事发现。
- 叙事筛选。
- 证据整理。
- 机会优先级。
- 发送到 Go 后的发射预案生成。

### 次要用户：非原生链上创作者

这类用户可能有内容、流量、社群或互联网文化嗅觉，但缺少 Meme 发射经验。NarraOps 可以帮助他们把链接、图片或文本转化为可审阅的发射预案。

### 暂不优先服务的用户

- 只需要 K 线、买卖、狙击或跟单的交易用户。
- 需要完整手动 Launch Terminal 的专业操盘团队。
- 期望产品承诺收益或自动盈利的用户。

## 核心产品循环

```text
发现叙事 -> 聚合证据 -> 筛选机会 -> Send to Go
-> 生成发射预案 -> 用户确认 -> 可选执行 -> 后续观察
```

Agent 负责理解意图、整理信息、生成方案和编排任务。涉及钱包、签名、转账、买卖和真实发射时，必须由确定性后端策略与隔离执行层处理，模型不得直接接触私钥或绕过用户确认。

## 产品导航与功能区

V1 推荐一级导航：

```text
Go / Pulse / Assets / Invite
```

Launch 不作为一级导航。Launch Draft、Launch Adapter 和执行合同继续作为 Go 工具能力、后端接口和 Roadmap 执行能力保留。

### Go

Go 是 Agent Command Center。

用户可以输入链接、文本、图片或 `/` 命令，生成结构化结果卡片。Go 负责把用户选中的叙事转化为发射预案，并在用户确认后调用后端工具。

Go 不承担主动互联网发现 feed。叙事发现由 Pulse 负责，Go 消费 Pulse 选中的叙事或用户主动输入的素材。

计划覆盖的指令类型包括：

- 根据链接、文本或图片生成发射预案。
- 根据 Pulse 机会卡片生成 Launch Plan。
- 分析已有 Meme Token 叙事。
- 生成 Meme Package。
- 读取用户预设钱包组并生成执行计划。
- 调用受控 Launch Adapter，前提是用户显式确认。

Go 发射预案字段应保持固定：

- Token Name
- Ticker / Symbol
- Twitter Link
- Third-party Link
- Logo Image
- Chain
- Launch Platform
- Cooking Wallet
- Bundle Wallets / T1-T5
- Risk Warnings
- Execution Status

当前状态：对话工作台和多类结构化结果卡片已完成原型；资金相关结果仅允许 Simulation/Disabled，真实执行默认关闭。

### Pulse

Pulse 是 Narrative Discovery Terminal，也是产品转向后的核心页面。

Pulse 负责从公开互联网和链上环境中发现可 Meme 化叙事，聚合证据，生成机会卡片，并允许用户将选中的叙事发送到 Go。

Pulse 前端建议分为两层：

1. **Market Activity Overview**
   - 不同链的活跃度。
   - 发射活动。
   - 叙事热区。
   - 来源健康度。
   - 活跃机会数量。

2. **Narrative Opportunity Cards**
   - 叙事标题。
   - 来源平台。
   - 原始链接。
   - 简短摘要。
   - 热度趋势。
   - 跨平台扩散。
   - 相关人物、事件或社区。
   - 是否已有同类 Token。
   - 风险和缺失证据。
   - 状态：`reject`、`watch`、`review`、`high_priority`。
   - 操作：`Send to Go`。

叙事详情页建议顺序：

```text
1. 这个叙事是什么
2. 为什么它可能 Meme 化
3. 原始证据
4. 传播路径
5. 已有同类 Token 检测
6. 风险和争议
7. Agent 判断依据
8. Send to Go
```

当前状态：Pulse 后端已有公开证据处理和 RSS/Atom discovery MVP；前端需要围绕市场活跃度、机会卡片、证据详情和 Send to Go 重构。X、Instagram、TikTok 等动态平台需要官方 API 或受控浏览器适配器，不得伪装成已稳定抓取。

### Assets

Assets 是资产与钱包协作支持区。

计划支持：

- 创建和管理钱包组。
- 查看钱包与资产概览。
- 预设 Cooking Wallet。
- 预设 Bundle Wallets / T1-T5。
- 生成组间转账、资金提取和批量操作计划。
- 管理钱包删除、导出和恢复流程。

当前状态：资产概览、钱包组、转账预览和安全门禁具有 Mock/API 原型。真实托管、私钥导出、签名和广播默认关闭。

### Invite

Invite 管理邀请码、邀请记录、早期贡献记录和社区参与身份。

当前状态：Mock 数据和接口合同已具备；正式归因、反作弊与结算规则待定。产品转向后，Invite 优先级低于 Pulse 和 Go。

### Launch 能力

Launch 不再作为一级前端入口。

仍需保留：

- Launch Draft 结构化结果。
- Pump.fun / Solana Adapter。
- Four.Meme / BSC Adapter。
- Pons / Robinhood Chain Adapter。
- 后续 GMGN / Axiom 等执行适配可能性。

Launch 能力应被 Go 调用。用户通过 Go 生成发射预案，确认后再进入受控执行流程。

## Agent 输出形式

Agent 不只返回聊天文本，还应返回可审阅的结构化结果：

- Opportunity Brief
- Narrative Snapshot
- Narrative Opportunity Card
- Narrative Detail
- Dev Market Report
- Meme Analysis
- Meme Package
- Launch Plan
- Launch Draft
- Execution Plan
- Recent Summary
- Task Progress / Failure / Recovery Card

长任务通过 SSE 返回进度和结果事件。前端必须区分 `planned`、`signing`、`submitted`、`confirmed` 和失败状态；`submitted` 不等于成功。

## V1 上线边界

### V1 应该可用

- 使用 Pulse 查看带来源与风险说明的叙事机会卡片。
- 使用 Pulse 查看市场活跃度和来源健康状态。
- 查看叙事详情、原始证据、传播路径和 Agent 判断依据。
- 将 Pulse 机会卡片 Send to Go。
- 使用 Go 生成 Meme 方案、发射预案和结构化任务卡片。
- 创建和管理钱包组及资产视图。
- 查看 Agent 任务状态和结构化结果卡片。
- 对敏感操作生成明确标记的模拟计划。
- 使用 Supabase MVP 账号基础记录用户、使用量和基础统计。

### V1 不承诺

- 不承诺收益、Token 价格或发射成功率。
- 不展示单一盈利概率。
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
8. Pulse 不得把状态、分组或分数包装成收益预测。
9. 社交平台数据必须标注来源状态；动态平台不可伪装成已成功抓取。

## 当前技术状态

已经具备：

- 顶部导航式深色产品工作台。
- Go、Pulse、Launch、Invite、Assets 页面原型。
- 中英文切换、响应式布局和结构化 Agent 卡片。
- `/api/v1` Agent、Pulse、Launch、Invite、Assets Mock API。
- Agent 会话、任务、SSE 事件与回放原型。
- 规划型执行状态机、幂等与敏感字段拒绝测试。
- GMGN、HertzFlow 和 Launch Platform 的适配层骨架。
- 钱包组、转账、发射草案和数据库迁移草案。
- Pons 发射与跟买编排原型。
- Pulse public-evidence processor。
- Pulse RSS/Atom discovery MVP。
- Supabase MVP auth / profiles / analytics migration draft。

需要按产品转向调整：

- 前端一级导航移除 Launch。
- Pulse 从 Mock 机会页升级为叙事发现终端。
- Go 从通用对话工作台升级为 Agent Command Center。
- Launch 页面逻辑折叠进 Go 工作流。
- 产品文案从发射台转向叙事发现和机会筛选。

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

V1 优先探索 SaaS 订阅。

用户付费购买持续的叙事发现、筛选、证据整理和机会判断能力。订阅可围绕以下能力分层：

- 每日可查看机会数量。
- 高优先级机会访问。
- 更高频 Pulse 更新。
- 更深度叙事详情。
- Send to Go 次数。
- 团队协作与历史记录。

发射分成和正向净利润贡献不作为 V1 主商业模式。未来若重新评估绩效型收费，必须完成归因范围、Gas/DEX/Launchpad 成本、外部转账、可复算账本、申诉机制和法律审查。

## Launch 计划

正式 launch 日期尚未锁定。当前更高优先级是完成产品转向后的 Pulse / Go V1 验收。

首发链和发射适配器继续作为 Go 可调用能力处理，公开产品传播不应把 NarraOps 描述成另一个 Launch Terminal。

## 最适合外部传播的叙事

NarraOps 连接以下环节：

```text
Narrative Discovery
-> Evidence Review
-> Opportunity Filtering
-> Go Agent Planning
-> Optional Launch Execution
-> Signal Tracking
```

外部传播重点：

- 降低 Meme Dev 发现叙事的成本。
- 更快筛选互联网叙事。
- 用公开证据解释机会来源。
- 把高潜力叙事转成可执行发射预案。

## 后续需要讨论和决定的问题

与 GPT、产品顾问或合作方继续讨论时，优先回答：

1. Pulse V1 应接哪些公开来源，如何处理 X、TikTok、Instagram 等动态平台？
2. Pulse 市场活跃度概览的核心指标是什么？
3. 叙事机会卡片的最小可用字段是什么？
4. `reject`、`watch`、`review`、`high_priority` 的规则如何解释给用户？
5. Go 的 Launch Plan 固定字段是否满足 Solana 首发链要求？
6. Launch Adapter 如何保留在 Go 工作流内，同时不作为一级页面暴露？
7. V1 SaaS 订阅如何分层，免费额度如何设定？
8. Bitget Wallet 式代币叙事解释如何扩展为 NarraOps 的早期叙事发现？
9. 上线前必须关闭或隐藏哪些尚未达到生产安全要求的入口？
10. 首发传播应突出“降低 Dev 叙事发现成本”“Pulse 叙事雷达”还是“Go Agent 发射预案”？
