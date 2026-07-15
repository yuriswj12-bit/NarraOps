# NarraOps Product Context

更新时间：2026-07-15

## 如何使用这份文档

这是一份面向产品讨论、合作沟通和 AI 协作的统一上下文，不是上线公告。

与 GPT 或合作方讨论 NarraOps 时，应以本文描述的产品定位、V1 边界和安全约束为准。任何标记为 Mock、Simulation、Review-only、Disabled 或 Roadmap 的能力，都不得描述为已经可用于真实资金。

## 产品身份

- **Product / Agent Name:** NarraOps
- **Token Name:** NarraOps
- **Ticker:** `NARRA`
- **Category:** On-chain
- **Positioning:** Agentic Meme Launch and Operations OS
- **Current stage:** 本地产品原型，尚未正式上线

一句话介绍：

> NarraOps helps meme creators find the narrative, build the launch and operate the signal.

扩展介绍：

> NarraOps is an agentic meme launch and operations assistant that turns emerging social and on-chain narratives into reviewable opportunity briefs, meme launch assets, launch plans and post-launch operating signals.

## 愿景

NarraOps 的目标是降低成为 Meme Dev 和组织链上项目运营的门槛，让更多普通玩家能够提升自己的链上生态位。

产品希望把过去集中在少数专业团队手中的叙事发现、Meme 构建、发射准备、钱包协作和持续运营能力，转化为可理解、可审阅、可追踪的 Agent 工作流，并逐步向更广泛的创作者和社区开放。

核心使命：

1. 发现具有传播潜力的 Meme 叙事。
2. 将叙事转化为可审阅的定位、内容素材和发射方案。
3. 降低用户完成链上项目创建与运营的技术门槛。
4. 在发射后持续追踪传播信号、项目状态和运营任务。
5. 推动更开放、更丰富的 Meme 文化发展。

NarraOps 不以操纵市场、制造虚假交易或承诺收益为产品目标。所有资金相关能力必须具备明确授权、风险提示、审计记录和用户确认。

## 目标用户

- 想成为 Meme Dev，但缺少完整技术和运营团队的链上用户。
- 能发现叙事，但不熟悉发射材料、钱包协作和执行流程的创作者。
- 希望将社交信号、链上数据和发射操作放在同一工作流中的小型团队。
- 需要批量化、结构化管理 Meme 项目运营任务的专业用户。

## 核心产品循环

```text
发现叙事 -> 评估机会 -> 构建 Meme -> 审阅发射方案
-> 用户确认 -> 发射与资产协作 -> 传播追踪 -> 持续运营
```

Agent 负责理解意图、整理信息、生成方案和编排任务。涉及钱包、签名、转账、买卖和真实发射时，必须由确定性后端策略与隔离执行层处理，模型不得直接接触私钥或绕过用户确认。

## 产品导航与功能区

### Go

产品核心 Agent 入口。

用户可以输入自然语言或 `/` 命令，生成机会分析、叙事简报、Meme 方案、发射草案和结构化任务卡片。

计划覆盖的指令类型包括：

- Meme 创建与定位。
- X、TikTok、抖音等平台的 Meme 化叙事推荐。
- On-chain Market、Dev Wallet 和 Meme 项目分析。
- 钱包组创建、转账、资金提取计划。
- Meme 发射、批量买入和批量卖出计划。

当前状态：对话工作台和多类结构化结果卡片已完成原型；资金相关结果仅允许 Simulation/Disabled。

### Pulse

机会发现和信号终端。

展示由社交传播、叙事共振、链上环境和历史数据形成的机会简报，包括热度、来源、建议链和风险等级。

当前状态：页面与 Mock API 合同已具备；生产数据源、来源证明和稳定评分模型仍待接入。

### Launch

将叙事整理成可审阅的发射包。

发射包包含名称、Ticker、简介、图片、X、网站、目标链、钱包组和发射参数。当前规划的平台包括：

- Pump.fun / Solana
- Four.Meme / BSC
- Pons / Robinhood Chain

Pons 原型已包含浏览器钱包连接、网络切换、余额读取、Gas 估算、二次确认和工厂调用适配；正式启用仍依赖官方源码/ABI 校验、图片与 IPFS 服务、安全审计和生产 RPC。

当前状态：发射准备与部分链适配原型已存在，但产品整体不应被描述为已支持无人值守真实发射。

### Invite

管理邀请码、邀请记录、早期贡献记录和社区参与身份。

当前状态：Mock 数据和接口合同已具备；正式归因、反作弊与结算规则待定。

### Assets

资产与钱包协作工作区。

计划支持：

- 创建和管理钱包组。
- 创建和管理单钱包组。
- 查看钱包与资产概览。
- 生成组间转账、资金提取和批量操作计划。
- 管理钱包删除、导出和恢复流程。

当前状态：资产概览、钱包组、转账预览和安全门禁具有 Mock/API 原型。真实托管、私钥导出、签名和广播默认关闭。

## Agent 输出形式

Agent 不只返回聊天文本，还应返回可审阅的结构化结果：

- Opportunity Brief
- Narrative Snapshot
- Dev Market Report
- Meme Analysis
- Meme Package
- Launch Draft
- Execution Plan
- Community Plan
- Recent Summary
- Task Progress / Failure / Recovery Card

长任务通过 SSE 返回进度和结果事件。前端必须区分 `planned`、`signing`、`submitted`、`confirmed` 和失败状态；`submitted` 不等于成功。

## V1 上线边界

### V1 应该可用

- 使用 Go 生成机会分析、叙事简报、Meme 方案和发射草案。
- 使用 Pulse 查看带来源与风险说明的机会简报。
- 创建和审阅标准化发射包。
- 管理邀请与早期贡献记录。
- 创建和管理钱包组及资产视图。
- 查看 Agent 任务状态和结构化结果卡片。
- 对敏感操作生成明确标记的模拟计划。

### V1 不承诺

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
- Go、Pulse、Launch、Invite、Assets 页面原型。
- 中英文切换、响应式布局和结构化 Agent 卡片。
- `/api/v1` Agent、Pulse、Launch、Invite、Assets Mock API。
- Agent 会话、任务、SSE 事件与回放原型。
- 规划型执行状态机、幂等与敏感字段拒绝测试。
- GMGN、HertzFlow 和 Launch Platform 的适配层骨架。
- 钱包组、转账、发射草案和数据库迁移草案。
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

NarraOps 当前不计划采用传统 SaaS 订阅。

长期设想是：只有用户获得可归因的正向已实现净利润，平台才可能获得收入。用户可自主选择将正向净利润的 `1%-10%` 作为平台贡献比例；没有正向利润，则产品收入为零。

该模式不在 V1 收费。启用前必须完成归因范围、Gas/DEX/Launchpad 成本、外部转账、可复算账本、申诉机制和法律审查。

## Launch 计划

目标是在产品最终验收完成后的第二天，即 `T+1`，向合作方提交正式 launch。

准确日历日期尚未锁定。最终首发链与平台将结合 launch 前三日的资金热度、用户注意力、流动性条件和合作方要求决定，目前重点比较 Solana 与 Robinhood Chain 方向。

## 最适合外部传播的叙事

NarraOps 不是一个只负责生成 Meme 文案的聊天机器人，也不是承诺自动盈利的交易机器人。

它是连接以下环节的 Agentic Meme Launch and Operations OS：

```text
Narrative Discovery
-> Meme Construction
-> Launch Preparation
-> Wallet Coordination
-> Signal Tracking
-> Continuous Operations
```

## 后续需要讨论和决定的问题

与 GPT、产品顾问或合作方继续讨论时，优先回答：

1. V1 首发时，Go、Pulse、Launch、Assets 各自必须完成到什么深度？
2. 首发链应选择 Solana、Robinhood Chain，还是保留多链但只开放一条真实执行链？
3. 用户从发现叙事到完成发射，最短且安全的主路径是什么？
4. NarraOps 应优先服务个人 Dev、小型团队还是社区型项目？
5. 哪些 Agent 任务免费，哪些需要 Token 权限或贡献记录？
6. 正向净利润归因模型是否可验证、可申诉并符合法律要求？
7. 哪些能力必须由 NarraOps 自建，哪些应交给 Virtuals、钱包服务商或 Launchpad？
8. V1 如何证明产品价值，而不依赖真实自动交易或收益承诺？
9. 上线前必须关闭或隐藏哪些尚未达到生产安全要求的入口？
10. 首发传播应突出“降低 Dev 门槛”“叙事到发射”还是“持续运营 OS”？

