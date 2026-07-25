# Pulse 历史 Meme 研究规格

## 研究目标

从历史 Meme Token 的链上结果反推发射前可观察的叙事特征，形成 Pulse 的发现、解释和历史匹配依据。

本研究不承诺收益，也不把相关性描述为因果关系。

## 首期范围

- 链：Solana。
- 主要数据：GMGN 历史最高市值、Token 创建时间、Launchpad、社交链接和链上指标。
- 叙事证据：Token 绑定的 X 原帖或账号，以及可确认的第三方原始来源。
- 研究单位：Token 样本 + 经人工验证的 Narrative Cluster。

## ATH 市值分层

| 层级 | 历史最高市值 |
|---|---:|
| L0 | `< $100K` |
| L1 | `$100K-$1M` |
| L2 | `$1M-$10M` |
| L3 | `$10M-$100M` |
| L4 | `> $100M` |

这里的分层不得直接使用行情接口返回的瞬时 `history_highest_market_cap`。研究数据必须同时保留原始 ATH 和经 K 线验证的峰值市值，最终分层以验证值为准。

### 峰值市值验证

- 使用代币流通量乘以 K 线收盘价计算市值。
- 默认使用连续三根 K 线收盘价的中位数，避免单根异常针。
- 三根 K 线的合计美元成交量至少为 10,000 美元。
- 原始 ATH 与验证峰值比值不超过 2 倍标记为 `consistent`。
- 2 至 10 倍标记为 `suspicious`。
- 超过 10 倍标记为 `invalid_spike_likely`。
- 首选 4 小时 K 线；网络或历史分页无法完成时允许使用日线降级，但必须保留 `resolution` 字段。
- 价格结果只能用于研究标签，不能作为发射前叙事特征输入，防止未来信息泄漏。

每层目标 100-300 个 Token。按创建月份和 Launchpad 匹配成功组与失败对照组，避免只研究幸存者。

## Token 样本字段

```text
chain
token_address
name
symbol
launchpad
created_at
ath_market_cap
time_to_100k
time_to_1m
time_to_10m
time_to_100m
twitter_url
third_party_url
social_link_type
cto_flag
holder_count
liquidity
volume
same_narrative_token_count
market_regime
```

`social_link_type` 至少区分：原始帖子、人物/事件账号、发币后项目账号、CTO 社交入口、无法确认。

## 叙事标注字段

```text
narrative_id
one_sentence_story
subject_type
origin_url
origin_creator
origin_published_at
source_confidence
visual_symbol_strength
one_sentence_clarity
emotion_type
remixability
cross_language_readability
pre_launch_velocity
relative_creator_baseline
share_like_ratio
comment_meme_creation
independent_remix_count
cross_platform_count
narrative_age_at_launch
competitor_count_at_launch
paid_promotion_evidence
risk_tags
uncertainties
```

## 防止未来数据泄漏

用于预测或比较的特征只能使用 Token 创建前能够观察到的数据。今天的点赞量、后续 CTO、后续 KOL 推广和链上市值结果不能反向混入发射前特征。

## 研究输出

1. L1、L2、L3、L4 相对上一层的分水岭。
2. 常见失败叙事模式。
3. 原帖到发币的时间窗口分布。
4. 同一叙事 Token 饱和度与结果关系。
5. 可提前观察的有效特征与不可用特征。
6. Pulse 历史相似样本说明，不输出确定性成功保证。

## 第一里程碑验收

- 至少 500 个链上 Token 样本。
- 至少 200 个经过人工验证的原始叙事。
- 所有市值层级都有样本和失败对照组。
- 每条研究结论可追溯到具体样本。
- 形成一份 `$1M / $10M / $100M` 叙事差异报告。
