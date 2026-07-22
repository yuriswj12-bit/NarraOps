# NarraOps Pulse 叙事分析模板 v2

> v1 已废弃。原因：只描述“这是什么梗”不足以判断一个尚未发币的内容是否值得关注；同时，使用发币后的 ATH 层级参与分析会造成结果泄漏。

## 适用范围

用于 Pulse 对“尚未发币的互联网内容”进行候选叙事分析，也用于从历史 Meme Token 中归纳叙事结构。历史研究允许使用当前可检索资料，但结论只能表示相关性和历史案例特征，不能声称还原了发射前现场。

模板必须分别回答：事实是什么、故事为什么成立、当时如何传播、是否已被代币化、谁能承接，以及有哪些反证。它不预测价格，也不把市值结果倒推成必然规律。

## 一、分析模式

```text
historical_pattern_research
使用“合约地址 + Token 名称”检索当前可见证据，归纳历史成功与失败样本的叙事特征。

live_discovery
使用内容 URL、名称、人物、短语、图片或视频发现尚未代币化的叙事。
```

历史研究保存：

```text
outcome_cohort: L0-L4
ath_market_cap
outcome_window
```

## 二、用户可见短版

### 1. 发生了什么

用 2–4 句话明确主体、事件、时间和来源。不得先写评价。

### 2. 一句话叙事

用 30–60 个中文字符讲清：

> `[谁/什么]` 因为 `[事件或反差]` 被传播，正在被用户解释为 `[共同情绪、身份或文化含义]`。

必须能被原始证据支持，不能由 Agent 自己编故事。

### 3. 为什么可能被 Meme 化

- **识别钩子：** 是否有一眼可认出的主体、画面、声音、名字或动作。
- **情绪钩子：** 用户为什么愿意转发：搞笑、荒诞、可爱、悲壮、讽刺、欲望、愤怒、怀旧或身份认同。
- **复述钩子：** 是否能在一句话内讲明，是否形成固定称呼、口号或模板。
- **二创空间：** 能否自然地产生图片、视频、改名、角色化或跨语种变体。
- **参与动作：** 普通用户除了观看，还能否模仿、站队、投稿或把它当身份符号。

### 4. 证据链

至少列出：

1. 最接近源头的内容、作者与发布时间。
2. 最早出现明显扩散的内容。
3. 至少一条与源头相互独立的传播证据。
4. 一条可能推翻当前解释的反证。

每条证据标记：`原始来源 / 二手报道 / 社区解释 / 交易推广`。交易推广不得作为叙事真实性证据。

### 5. 传播结构

- 首次发现时间与当前观察时长。
- 在已覆盖数据源内观察到的互动变化，不声称代表全网精确数量。
- 在可见样本中是否出现独立创作者，排除明显复制粘贴和同一群账号互刷。
- 当前覆盖的平台、语言和地区。
- 传播是由一个大号推动，还是多个小社区自然扩散。
- 原帖互动与“发币/合约地址推广”互动的比例。

发射前没有合约地址，因此不得以“合约地址相关帖子数”作为发现条件。传播强度使用区间而非伪精确计数：

```text
source_only       只看到原始内容
promotion_only    只看到发币或交易推广，未定位到原始内容
early_replication 出现少量独立转发或二创
multi_account     多个独立账号在讨论
cross_platform    至少两个平台出现独立传播
breakout          在当前数据覆盖范围内明显加速
unknown           数据不足，不能判断
```

同时必须展示 `coverage`：本次检查了哪些平台、时间范围以及是否使用官方 API。没有采集到数据不等于没有传播。

### 6. 真实性、认领与承接

分别判断，不得合并：

- **内容真实性：** 事件或主体是否真实存在。
- **来源真实性：** 链接是否确实来自原作者或可信来源。
- **当事人态度：** 未知、反对、未认领、疑似认领、明确认领。
- **IP 权利：** 未知、非官方、获得授权、官方持有。
- **承接能力：** 是否已有持续更新的账号、社区、创作者或产品团队。

### 7. 代币化竞争

- 使用“叙事指纹”查找可能的同类 Token，而不是要求得到全网精确数量。
- 指纹包括：主体名称、固定短语、关键人物、事件关键词、图片感知哈希、视频关键帧、官方账号和原始 URL。
- 在可用 Token 数据源中检查同名、同图、同人物、同事件和相近概念。
- 结果只能写成：`未观察到 / 发现疑似同类 / 发现明确同类 / 明显拥挤 / 数据不足`。
- 如果发现明确同类，列出可验证的合约地址；否则不得编造数量。
- 当前机会属于原创候选、早期变体、强差异化变体还是晚期复制。

“未观察到同类”不等于“全网不存在同类”，必须随结果展示查询范围。

### 8. 时效性与生命周期

- 触发事件是否有明确截止日期。
- 热度依赖单次新闻，还是属于长期文化符号。
- 未来 24 小时、7 天内是否还有可预见的传播节点。
- 当前处于：`出现 / 加速 / 跨圈 / 拥挤 / 见顶 / 衰退 / 复兴`。

### 9. 主要风险与反证

至少覆盖：来源错配、假项目、IP/肖像权、内容伤害、政治事件、重复发币、刷量、短期窗口、过度拥挤、当事人反对和纯交易喊单噪声。

### 10. Pulse 结论

结论分成两个互不替代的结果：

```text
叙事成立性：成立 / 部分成立 / 证据不足 / 不成立
机会状态：立即关注 / 持续观察 / 已被占用 / 已经过热 / 排除
```

最后用不超过四句话说明：故事、传播、竞争、最大风险。必须列出最关键的一条支持证据和一条反对证据。

## 三、内部结构化字段

```json
{
  "analysis_mode": "historical_pattern_research|live_discovery",
  "narrative_title": "",
  "narrative_summary": "",
  "narrative_archetype": [],
  "subject": "",
  "trigger_event": "",
  "cultural_meaning": "",
  "visual_hook": "",
  "emotional_hook": [],
  "repeatable_phrase_or_symbol": "",
  "origin": {
    "platform": "",
    "source_url": "",
    "published_at": "",
    "creator": "",
    "source_confidence": 0
  },
  "evidence": [
    {
      "url": "",
      "type": "primary|secondary|community|promotion|counterevidence",
      "published_at": "",
      "author": "",
      "claim_supported": "",
      "confidence": 0
    }
  ],
  "ownership": {
    "status": "unclaimed|suspected|creator_claimed|official_ip|operated_project",
    "evidence_url": "",
    "evidence_summary": ""
  },
  "distribution": {
    "stage": "emerging|accelerating|crossing_over|crowded|peaking|declining|revival",
    "platforms": [],
    "languages": [],
    "observed_independent_creators_lower_bound": null,
    "observed_growth_signal": "source_only|promotion_only|early_replication|multi_account|cross_platform|breakout|unknown",
    "organic_signal": "likely_organic|mixed|promotion_led|unknown",
    "coverage": {
      "platforms_checked": [],
      "window_start": "",
      "window_end": "",
      "collection_method": "official_api|public_search|manual|mixed",
      "limitations": []
    },
    "community_present": false,
    "derivative_content_present": false
  },
  "durability": {
    "timeless_culture": false,
    "event_deadline": "",
    "continued_operations": false,
    "product_or_utility": false
  },
  "duplication": {
    "status": "not_observed|suspected|confirmed|crowded|unknown",
    "confirmed_token_addresses": [],
    "narrative_fingerprint": {
      "entities": [],
      "phrases": [],
      "source_urls": [],
      "media_hashes": []
    },
    "coverage": {
      "token_sources_checked": [],
      "limitations": []
    }
  },
  "risks": [],
  "evidence_for": [],
  "evidence_against": [],
  "narrative_validity": "valid|partially_valid|insufficient_evidence|invalid",
  "opportunity_status": "watch_now|monitor|occupied|overheated|reject",
  "confidence": 0,
  "analysis_version": "pulse-narrative-v2"
}
```

## 四、固定叙事类型标签

允许多选，但最多选择三个主标签：

1. `animal`：真实或虚构动物。
2. `animal_plus`：动物与人物、食物、疾病、天气、职业或事件的组合。
3. `viral_content`：视频、图片、动作或声音自然走红。
4. `heroic_or_emotional`：勇敢、死亡、纪念、保护、救助或悲剧。
5. `absurd_or_crude`：身体、屎尿屁、谐音和冲击性低俗幽默。
6. `satire`：政治、金融、社会或公共事件讽刺。
7. `celebrity_or_kol`：名人、KOL 或创作者相关。
8. `sports_or_event`：比赛、世界杯、选举、电影发布等有时间窗口的事件。
9. `classic_internet_ip`：Wojak、Trollface 等长期互联网文化符号。
10. `generation_identity`：NEET、Manifesting 等代际身份和文化现象。
11. `crypto_native`：链、Launchpad、交易文化或币圈自嘲。
12. `attention_or_meta`：对注意力、FOMO、赌博或 Meme 本身的元叙事。
13. `project_with_meme_shell`：真实产品、团队、融资或机构项目披着 Meme 外壳。
14. `derivative_or_rub`：复刻成功叙事、蹭名人或硬贴流量。
15. `fake_project`：伪装成项目或冒用来源。

## 五、证据优先级

从高到低：

1. 原始创作者、当事人或 IP 所有者的账号与原帖。
2. 官方网站、账号 Bio、置顶帖、授权声明或持续运营记录。
3. 原始视频、新闻报道、公开比赛/事件资料。
4. 多个平台相互独立的自然传播证据。
5. 社区账号的解释。
6. 交易喊单、只贴合约地址、倍数预测和市值宣传。

第 6 类只能证明有人推广，不能证明叙事真实。

## 六、历史规律研究规则

短标签如“猫、项目型、声音梗、低质”只能作为检索标签，不能作为 Pulse 监督答案。

历史研究必须执行：

1. 使用合约地址和 Token 名称查找当前可见的叙事证据。
2. 先描述叙事事实、结构和证据，再对照 L0–L4 市值层级。
3. 比较哪些特征在各层级出现频率不同，并保留失败反例。
4. 明确区分“发射时已有的内容”和“发射后形成的认领、社区或运营”；无法区分时标记未知，但不阻断研究。
5. 把价格、流动性、发行平台和市场环境作为独立变量，避免把结果全部归因于叙事。
6. 这些结论用于生成 Pulse 假设，不直接等同于发射前预测能力。

## 七、判断原则

- 先讲事实，再解释文化含义，最后做判断。
- 不因为 Token 涨过就把薄弱叙事写成好叙事。
- “有趣”不等于“可持续”；必须分别判断内容钩子与运营承接。
- 名字、图片和故事必须能互相对应，否则标记为来源错配。
- 有当事人认领、IP 授权、社区接管或长期运营时单独突出。
- 不用一个总分掩盖事实；结论必须能回到来源证据。
- 发射前分析以内容 URL、主体、短语和媒体指纹为入口；合约地址只用于历史回测或发射后的持续监控。
- 所有传播和竞争结论都是“在当前覆盖范围内观察到的结果”，不得伪装成全网精确统计。
- 数据不足必须标记为 `unknown`，不能自动记为负分。

## 八、完成状态与质量门

分析必须先通过以下质量门，才能输出机会状态：

1. 历史样本使用 `historical_pattern_research`，检索入口为“合约地址 + Token 名称”；不强制要求 Token 创建时间或数据截止时间。
2. 每一个数量、认领、授权、持续运营和竞争结论都必须有逐条链接；账号主页不能代替具体帖子或声明。
3. 若只找到推广帖，传播等级使用 `promotion_only`，不能使用 `source_only`。
4. “没有持续运营主体”“没有未来节点”“不存在自然传播”都属于需要证据的结论；无法验证时写 `unknown`。
5. 样本的历史层级必须由原始数据按合约地址匹配，禁止人工改写或靠列表位置推断。
6. 关键已知事实与检索结论冲突时，进入 `needs_review`，不得批量继续。

```text
completion_status:
complete         通过全部质量门
incomplete       缺少来源或必要证据
needs_review     发现字段冲突或遗漏关键事实
```

当 `completion_status` 不是 `complete` 时：

- `opportunity_status` 必须为 `unknown`；
- 不输出排除、立即关注或持续观察；
- 置信度只评价当前叙事提取，不评价机会。
