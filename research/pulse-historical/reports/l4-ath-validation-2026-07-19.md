# 原始 L4 ATH 数据验证

日期：2026-07-19
链：Solana
输入：GMGN `history_highest_market_cap` 原始 L4 样本 12 个

## 结果

| 验证后层级 | 数量 | 占比 |
|---|---:|---:|
| L4（超过 100M） | 5 | 41.7% |
| L3（10M–100M） | 4 | 33.3% |
| L2（1M–10M） | 3 | 25.0% |

原始 L4 样本中，7/12（58.3%）在连续 K 线验证后不再属于 L4。因此，Pulse 历史研究不能直接以瞬时 ATH 字段划分成功等级。

## 样本摘要

| Token | 原始 ATH | 验证峰值 | 验证层级 | 质量 |
|---|---:|---:|---|---|
| ZAUTH | 122,499,695,257,882 | 7,456,968 | L2 | invalid spike likely |
| Buttcoin | 37,917,666,750,050 | 44,509,408 | L3 | invalid spike likely |
| 67 | 32,018,633,739 | 38,179,909 | L3 | invalid spike likely |
| LOOK | 679,775,365 | 105,733,900 | L4 | suspicious |
| ANSEM | 449,261,068 | 423,089,157 | L4 | consistent |
| OPAL | 325,548,907 | 4,814,878 | L2 | invalid spike likely |
| MUSHU | 291,990,225 | 3,920,631 | L2 | invalid spike likely |
| TROLL | 286,480,309 | 245,033,894 | L4 | consistent; daily fallback |
| testicle | 255,438,919 | 20,815,672 | L3 | invalid spike likely |
| PENGUIN | 173,477,136 | 134,145,565 | L4 | consistent |
| CWU | 133,223,964 | 114,628,451 | L4 | consistent |
| House | 122,166,992 | 87,872,059 | L3 | consistent; daily fallback |

## 对 Pulse 的影响

1. 叙事规律报告必须按 `validated_peak_cohort` 分组。
2. 原始 ATH 只作为数据质量审计字段，不作为成功标签。
3. 对大额异常针需要保留原始 K 线证据，便于复算。
4. 评分模型只允许使用发射前可观察的叙事和传播特征；验证峰值仅作为事后结果标签。

机器可读结果见 `research/pulse-historical/validated-peaks-L4.csv`。
