// @ts-nocheck

const ADDRESS_KEYS = new Set([
  "address",
  "wallet_address",
  "wallet",
  "owner",
  "owner_address",
  "maker",
  "maker_address",
]);
const TAG_KEYS = new Set([
  "tags",
  "tag",
  "tag_name",
  "maker_token_tags",
  "wallet_tags",
  "wallet_tag_v2",
  "_query_tag",
]);
const RELATION_KEYS = Object.freeze({
  funding: new Set(["native_transfer", "native_funder", "funder", "funder_address", "funding_address", "funded_by", "sol_funder", "from_address"]),
  distribution: new Set(["token_transfer_in", "token_distributor", "distributor", "distribution_source", "source_address", "from_address"]),
  collection: new Set(["token_transfer_out", "collector", "collection_address", "to_address", "receiver_address", "recipient"]),
});

const METRIC_KEYS = new Set([
  "amount_percentage",
  "amount_percent",
  "hold_rate",
  "holding_percentage",
  "token_amount_percentage",
  "buy_volume",
  "buy_volume_cur",
  "buy_volume_usd",
  "buy_usd",
  "buy_value",
  "sell_volume",
  "sell_volume_cur",
  "sell_volume_usd",
  "sell_usd",
  "sell_value",
  "buy_tx_count",
  "buy_tx_count_cur",
  "sell_tx_count",
  "sell_tx_count_cur",
  "buy_transactions",
  "sell_transactions",
  "sold_percentage",
  "sell_percent",
  "sell_amount_percentage",
  "profit",
  "realized_profit",
  "realized_profit_usd",
  "unrealized_profit",
  "unrealized_profit_usd",
  "transfer_in",
  "transfer_out",
  "current_transfer_in_amount",
  "current_transfer_out_amount",
  "history_transfer_in_amount",
  "history_transfer_out_amount",
  "token_transfer_in",
  "token_transfer_out",
]);

export function buildSolanaMemeForensicReport({ address, research, generatedAt = new Date().toISOString() } = {}) {
  const data = research?.data || {};
  const componentStatuses = research?.component_statuses || {};
  const rowsBySource = {
    holders: collectWalletRows(data.holders),
    traders: collectWalletRows(data.traders),
    tagged: [],
  };
  for (const [key, payload] of Object.entries(data)) {
    if (key.startsWith("holders_")) rowsBySource.tagged.push(...collectWalletRows(payload));
  }

  const wallets = mergeWalletRows([
    ...rowsBySource.holders.map((row) => [row, "holders"]),
    ...rowsBySource.traders.map((row) => [row, "traders"]),
    ...rowsBySource.tagged.map((row) => [row, "tagged"]),
  ]);
  const holderWallets = mergeWalletRows(rowsBySource.holders.map((row) => [row, "holders"]));
  const topHolders = [...holderWallets].sort((a, b) => b.hold_rate - a.hold_rate).slice(0, 100);
  const tagCounts = countTags(wallets);
  const mmWallets = wallets.filter(isMarketMaker);
  const distributionWallets = wallets.filter(isDistributionWallet);
  const cashoutWallets = wallets.filter(isCashoutWallet);
  const clusters = buildRelationshipClusters(wallets);
  const metrics = buildMetrics({
    research,
    data,
    wallets,
    topHolders,
    mmWallets,
    distributionWallets,
    cashoutWallets,
    clusters,
    tagCounts,
  });
  const dataGaps = buildDataGaps(componentStatuses, data, wallets);
  const verdict = buildVerdict(metrics, dataGaps, { mmWallets, distributionWallets, cashoutWallets });
  const topClusters = {
    relationship: clusters.slice(0, 12).map(renderCluster),
    distribution: groupByRelation(wallets, "distribution").slice(0, 12),
    funding: groupByRelation(wallets, "funding").slice(0, 12),
    collection: groupByRelation(wallets, "collection").slice(0, 12),
  };
  const watchlist = buildWatchlist({ wallets, clusters, distributionWallets, cashoutWallets });
  const token = {
    chain: "solana",
    address: String(address || research?.address || ""),
    observed_at: research?.observed_at || generatedAt,
    data_source: "gmgn",
    sample_limit: research?.limit || 100,
  };
  const machineReport = {
    schema: "hertzflow_sol_meme_forensic_v1",
    generated_at: generatedAt,
    token,
    verdict,
    metrics,
    top_clusters: topClusters,
    watchlist,
    data_gaps: dataGaps,
    limitations: [
      "关系图基于 GMGN 返回样本中的可见 funder / distributor / collector 字段，不等同于完整 Solana transfer graph。",
      "套现额为当前样本可见的下限；没有 Helius、Shyft、Vybe 等 inner-instruction 补全时，不宣称完整历史。",
    ],
  };
  const report = renderShortReport({ token, metrics, verdict, dataGaps, watchlist, generatedAt });
  const forensicReport = renderForensicReport({ token, metrics, verdict, topClusters, watchlist, dataGaps, tagCounts, generatedAt });
  const monitoring = {
    schema: "hertzflow_sol_meme_monitoring_v1",
    generated_at: generatedAt,
    token,
    items: watchlist,
    refresh_policy: "每次分析重新拉取 GMGN；监控地址仅供后续人工复核，不执行交易。",
  };
  return {
    status: "completed",
    provider: "hertzflow",
    source: "hertzflow",
    chain: "solana",
    address: token.address,
    freshness: "live",
    report_language: "zh",
    report,
    forensic_report: forensicReport,
    monitoring,
    machine_report: machineReport,
    metrics,
    verdict,
    watchlist,
    data_gaps: dataGaps,
    component_statuses: componentStatuses,
    source_snapshot: {
      gmgn_status: research?.status || "unknown",
      observed_at: research?.observed_at || generatedAt,
      rows: {
        holders: rowsBySource.holders.length,
        traders: rowsBySource.traders.length,
        tagged: rowsBySource.tagged.length,
      },
    },
  };
}

function collectWalletRows(value, output = [], seen = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectWalletRows(item, output, seen);
    return output;
  }
  if (!value || typeof value !== "object") return output;
  const address = addressOf(value);
  const keys = Object.keys(value).map((key) => key.toLowerCase());
  const looksLikeWallet = address && (
    keys.some((key) => METRIC_KEYS.has(key)) ||
    keys.some((key) => TAG_KEYS.has(key)) ||
    keys.some((key) => key.includes("transfer"))
  );
  if (looksLikeWallet) {
    const fingerprint = `${address}:${JSON.stringify(value).slice(0, 500)}`;
    if (!seen.has(fingerprint)) {
      output.push(value);
      seen.add(fingerprint);
    }
    return output;
  }
  for (const child of Object.values(value)) collectWalletRows(child, output, seen);
  return output;
}

function mergeWalletRows(entries) {
  const byAddress = new Map();
  for (const [row, source] of entries) {
    const address = addressOf(row);
    if (!address) continue;
    const next = normalizeWallet(row, source);
    const existing = byAddress.get(address);
    if (!existing) {
      byAddress.set(address, next);
      continue;
    }
    existing.tags = [...new Set([...existing.tags, ...next.tags])];
    existing.sources = [...new Set([...existing.sources, ...next.sources])];
    for (const key of ["hold_rate", "buy_volume_usd", "sell_volume_usd", "buy_tx_count", "sell_tx_count", "sold_rate", "profit_usd"]) {
      existing[key] = Math.max(existing[key] || 0, next[key] || 0);
    }
    for (const relation of Object.keys(existing.relations)) {
      existing.relations[relation] = [...new Set([...existing.relations[relation], ...next.relations[relation]])];
    }
    existing.has_transfer_in ||= next.has_transfer_in;
    existing.has_transfer_out ||= next.has_transfer_out;
  }
  return [...byAddress.values()];
}

function normalizeWallet(row, source) {
  const buy = firstNumber(row, ["buy_volume_usd", "buy_volume_cur", "buy_usd", "buy_value", "buy_volume"]);
  const sell = firstNumber(row, ["sell_volume_usd", "sell_volume_cur", "sell_usd", "sell_value", "sell_volume"]);
  return {
    address: addressOf(row),
    tags: tagsOf(row),
    sources: [source],
    hold_rate: firstPercent(row, ["amount_percentage", "amount_percent", "hold_rate", "holding_percentage", "token_amount_percentage"]) || 0,
    buy_volume_usd: buy || 0,
    sell_volume_usd: sell || 0,
    buy_tx_count: firstNumber(row, ["buy_tx_count", "buy_tx_count_cur", "buy_transactions", "buy_count"]) || 0,
    sell_tx_count: firstNumber(row, ["sell_tx_count", "sell_tx_count_cur", "sell_transactions", "sell_count"]) || 0,
    sold_rate: firstPercent(row, ["sold_percentage", "sell_percent", "sell_amount_percentage", "sold_rate"]) || (sell ? Math.min(1, sell / Math.max(buy, sell, 1)) : 0),
    profit_usd: firstNumber(row, ["realized_profit_usd", "realized_profit", "unrealized_profit_usd", "unrealized_profit", "profit"]) || 0,
    has_transfer_in: transferPresent(row, "in"),
    has_transfer_out: transferPresent(row, "out"),
    relations: {
      funding: relationValues(row, RELATION_KEYS.funding),
      distribution: relationValues(row, RELATION_KEYS.distribution),
      collection: relationValues(row, RELATION_KEYS.collection),
    },
  };
}

function buildMetrics({ research, data, wallets, topHolders, mmWallets, distributionWallets, cashoutWallets, clusters, tagCounts }) {
  const info = data.info;
  const totalBuy = sum(wallets, "buy_volume_usd");
  const totalSell = sum(wallets, "sell_volume_usd");
  const top10 = sum(topHolders.slice(0, 10), "hold_rate");
  const top1 = topHolders[0]?.hold_rate || 0;
  return {
    price_usd: firstNumber(info, ["price", "price_usd", "usd_price"]),
    market_cap_usd: firstNumber(info, ["market_cap", "market_cap_usd", "usd_market_cap", "fdv"]),
    liquidity_usd: firstNumber(data.pool, ["liquidity", "liquidity_usd", "usd_liquidity"]),
    circulating_supply: firstNumber(info, ["circulating_supply", "supply"]),
    holder_count: firstNumber(info, ["holder_count", "holders", "holders_count"]) || topHolders.length || null,
    sampled_holder_count: topHolders.length,
    sampled_trader_count: wallets.filter((wallet) => wallet.sources.includes("traders")).length,
    top1_hold_rate: round(top1, 6),
    top10_hold_rate: round(top10, 6),
    total_buy_volume_usd: round(totalBuy, 2),
    total_sell_volume_usd: round(totalSell, 2),
    visible_sell_lower_bound_usd: round(totalSell, 2),
    mm_wallet_count: mmWallets.length,
    distribution_wallet_count: distributionWallets.length,
    cashout_wallet_count: cashoutWallets.length,
    relationship_cluster_count: clusters.length,
    main_cluster_wallet_count: clusters[0]?.wallets.length || 0,
    tag_counts: tagCounts,
    source_status: research?.status || "unknown",
  };
}

function buildDataGaps(statuses, data, wallets) {
  const gaps = Object.entries(statuses)
    .filter(([, status]) => status !== "live")
    .map(([key, status]) => `GMGN ${key} 状态为 ${status}，未纳入完整证据。`);
  if (!wallets.length) gaps.push("GMGN 未返回可用于地址级分析的 holder/trader 样本。");
  if (!data.info) gaps.push("缺少 token info，无法可靠展示价格、市值或持有人总数。");
  gaps.push("当前关系图是 GMGN 样本级下限，不是全量 transfer graph。");
  return [...new Set(gaps)].slice(0, 16);
}

function buildVerdict(metrics, dataGaps, { mmWallets, distributionWallets, cashoutWallets }) {
  if (!metrics.sampled_holder_count && !metrics.sampled_trader_count) {
    return {
      risk_score: null,
      risk_level: "data_gap",
      chain_state: "DATA_GAP",
      one_liner: "当前没有足够的 GMGN 地址样本，不能生成可靠的链上结论。",
      signals: [],
    };
  }
  let score = 0;
  const signals = [];
  if (metrics.top10_hold_rate > 0.5) { score += 3; signals.push("样本 Top10 持仓超过 50%，集中度高"); }
  else if (metrics.top10_hold_rate > 0.2) { score += 2; signals.push("样本 Top10 持仓超过 20%"); }
  if (metrics.top1_hold_rate > 0.2) { score += 2; signals.push("样本 Top1 持仓超过 20%"); }
  if (mmWallets.length) { score += 2; signals.push(`命中 ${mmWallets.length} 个 MM/机器人或高频地址样本`); }
  if (distributionWallets.length) { score += 2; signals.push(`命中 ${distributionWallets.length} 个分发关系样本`); }
  if (cashoutWallets.length && metrics.total_sell_volume_usd > Math.max(metrics.total_buy_volume_usd * 1.2, 50_000)) {
    score += 1;
    signals.push("可见套现下限高于样本买入量，需重点复核");
  }
  if (dataGaps.length > 2) signals.push("数据存在组件级缺口，结论按样本下限解释");
  score = Math.min(10, score);
  const chainState = distributionWallets.length && mmWallets.length
    ? "RECENT_DISTRIBUTION_MM_DOMINATED"
    : mmWallets.length
      ? "MM_DOMINATED"
      : metrics.top10_hold_rate > 0.5
        ? "CONCENTRATED"
        : "OBSERVE";
  const riskLevel = score >= 8 ? "high" : score >= 5 ? "elevated" : "watch";
  return {
    risk_score: score,
    risk_level: riskLevel,
    chain_state: chainState,
    one_liner: score >= 8
      ? "当前 GMGN 样本显示明显的集中、分发或 MM/机器人主导特征，应先复核关系集群和套现路径。"
      : score >= 5
        ? "当前样本存在需要人工复核的集中度或地址关系信号，不能仅凭价格判断。"
        : "当前样本暂未形成强风险结论，仍应持续观察持仓集中度和关系地址变化。",
    signals,
    disclaimer: "这是只读研究报告，不构成投资建议，也不执行签名、广播或资金操作。",
  };
}

function buildRelationshipClusters(wallets) {
  if (!wallets.length) return [];
  const parent = wallets.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  for (const relation of ["funding", "distribution", "collection"]) {
    const first = new Map();
    wallets.forEach((wallet, index) => {
      for (const key of wallet.relations[relation]) {
        if (first.has(key)) union(index, first.get(key));
        else first.set(key, index);
      }
    });
  }
  const groups = new Map();
  wallets.forEach((wallet, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(wallet);
  });
  return [...groups.values()]
    .map((group) => ({
      wallets: group,
      wallet_count: group.length,
      mm_hit_count: group.filter(isMarketMaker).length,
      distribution_hit_count: group.filter(isDistributionWallet).length,
      cashout_hit_count: group.filter(isCashoutWallet).length,
      hold_rate: round(sum(group, "hold_rate"), 6),
      buy_volume_usd: round(sum(group, "buy_volume_usd"), 2),
      sell_volume_usd: round(sum(group, "sell_volume_usd"), 2),
      relations: {
        funding: uniqueRelationKeys(group, "funding"),
        distribution: uniqueRelationKeys(group, "distribution"),
        collection: uniqueRelationKeys(group, "collection"),
      },
    }))
    .sort((a, b) => (b.wallet_count + b.mm_hit_count * 2 + b.cashout_hit_count) - (a.wallet_count + a.mm_hit_count * 2 + a.cashout_hit_count));
}

function renderCluster(cluster) {
  return {
    wallet_count: cluster.wallet_count,
    mm_hit_count: cluster.mm_hit_count,
    distribution_hit_count: cluster.distribution_hit_count,
    cashout_hit_count: cluster.cashout_hit_count,
    hold_rate: cluster.hold_rate,
    buy_volume_usd: cluster.buy_volume_usd,
    sell_volume_usd: cluster.sell_volume_usd,
    relations: cluster.relations,
    representatives: cluster.wallets.slice(0, 8).map((wallet) => wallet.address),
  };
}

function groupByRelation(wallets, relation) {
  const groups = new Map();
  for (const wallet of wallets) {
    for (const key of wallet.relations[relation]) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(wallet);
    }
  }
  return [...groups.entries()]
    .map(([relation_key, group]) => ({
      relation_key,
      wallet_count: group.length,
      mm_hit_count: group.filter(isMarketMaker).length,
      distribution_hit_count: group.filter(isDistributionWallet).length,
      cashout_hit_count: group.filter(isCashoutWallet).length,
      hold_rate: round(sum(group, "hold_rate"), 6),
      buy_volume_usd: round(sum(group, "buy_volume_usd"), 2),
      sell_volume_usd: round(sum(group, "sell_volume_usd"), 2),
      representatives: group.slice(0, 8).map((wallet) => wallet.address),
    }))
    .sort((a, b) => (b.wallet_count + b.sell_volume_usd / 100_000) - (a.wallet_count + a.sell_volume_usd / 100_000));
}

function buildWatchlist({ wallets, clusters, distributionWallets, cashoutWallets }) {
  const output = [];
  const add = (wallet, priority, reason) => {
    if (!wallet?.address || output.some((item) => item.address === wallet.address)) return;
    output.push({
      priority,
      address: wallet.address,
      reason,
      tags: wallet.tags,
      hold_rate: round(wallet.hold_rate, 6),
      sell_volume_usd: round(wallet.sell_volume_usd, 2),
      relation_count: Object.values(wallet.relations).reduce((total, values) => total + values.length, 0),
    });
  };
  for (const wallet of distributionWallets.slice(0, 8)) add(wallet, "P0", "样本命中分发/上游关系，优先复核");
  for (const cluster of clusters.slice(0, 3)) {
    for (const wallet of cluster.wallets.slice(0, 3)) add(wallet, "P0", "主关系集群代表地址");
  }
  for (const wallet of cashoutWallets.sort((a, b) => b.sell_volume_usd - a.sell_volume_usd).slice(0, 8)) {
    add(wallet, "P1", "样本命中可见套现或转出路径");
  }
  for (const wallet of [...wallets].sort((a, b) => b.hold_rate - a.hold_rate).slice(0, 4)) {
    add(wallet, "P1", "样本持仓集中度较高");
  }
  return output.slice(0, 20);
}

function renderShortReport({ token, metrics, verdict, dataGaps, watchlist, generatedAt }) {
  return [
    "# HertzFlow Solana Meme 链上决策简报",
    "",
    `- 合约：\`${token.address}\``,
    `- 观察时间：${generatedAt}`,
    `- 数据源：GMGN fresh sample + HertzFlow deterministic forensic pipeline`,
    `- 当前状态：${verdict.chain_state} / 风险分：${verdict.risk_score == null ? "数据不足" : `${verdict.risk_score}/10`}`,
    "",
    "## 一屏结论",
    verdict.one_liner,
    verdict.disclaimer || "这是只读研究报告，不构成投资建议。",
    "",
    "## 关键指标",
    `- 价格：${formatUsd(metrics.price_usd)}；市值：${formatUsd(metrics.market_cap_usd)}；流动性：${formatUsd(metrics.liquidity_usd)}`,
    `- 样本持有人：${metrics.sampled_holder_count}；Top1：${formatPct(metrics.top1_hold_rate)}；Top10：${formatPct(metrics.top10_hold_rate)}`,
    `- 可见买入样本：${formatUsd(metrics.total_buy_volume_usd)}；可见套现下限：${formatUsd(metrics.visible_sell_lower_bound_usd)}`,
    `- MM/机器人命中：${metrics.mm_wallet_count}；分发命中：${metrics.distribution_wallet_count}；套现命中：${metrics.cashout_wallet_count}`,
    "",
    "## 主要信号",
    ...(verdict.signals.length ? verdict.signals.map((signal) => `- ${signal}`) : ["- 暂无足够信号"]),
    "",
    "## 优先监控",
    ...(watchlist.length ? watchlist.slice(0, 8).map((item) => `- [${item.priority}] \`${item.address}\`：${item.reason}`) : ["- 当前没有可用监控地址"]),
    ...(dataGaps.length ? ["", "## 数据缺口", ...dataGaps.slice(0, 6).map((gap) => `- ${gap}`)] : []),
  ].join("\n");
}

function renderForensicReport({ token, metrics, verdict, topClusters, watchlist, dataGaps, tagCounts, generatedAt }) {
  return [
    "# HertzFlow Solana Meme Forensic Report",
    "",
    `schema: \`hertzflow_sol_meme_forensic_v1\``,
    `generated_at: ${generatedAt}`,
    `token: \`${token.address}\``,
    "",
    "## Decision summary",
    `- chain_state: ${verdict.chain_state}`,
    `- risk_score: ${verdict.risk_score == null ? "null" : verdict.risk_score}`,
    `- risk_level: ${verdict.risk_level}`,
    `- one_liner: ${verdict.one_liner}`,
    `- sampled_holder_count: ${metrics.sampled_holder_count}`,
    `- sampled_trader_count: ${metrics.sampled_trader_count}`,
    "",
    "## Live token market",
    `- price_usd: ${formatUsd(metrics.price_usd)}`,
    `- market_cap_usd: ${formatUsd(metrics.market_cap_usd)}`,
    `- liquidity_usd: ${formatUsd(metrics.liquidity_usd)}`,
    `- holder_count: ${metrics.holder_count ?? "unknown"}`,
    "",
    "## Chain state and risk signals",
    ...(verdict.signals.length ? verdict.signals.map((signal) => `- ${signal}`) : ["- no deterministic signal"]),
    "",
    "## Wallet tag evidence",
    ...Object.entries(tagCounts).map(([tag, count]) => `- ${tag}: ${count}`),
    "",
    "## Relationship graph conclusion",
    `- main cluster count: ${topClusters.relationship.length}`,
    ...(topClusters.relationship.slice(0, 5).map((cluster, index) => `- cluster_${index + 1}: ${cluster.wallet_count} wallets; MM ${cluster.mm_hit_count}; cashout ${cluster.cashout_hit_count}; hold ${formatPct(cluster.hold_rate)}`)),
    "",
    "## Distribution / funding / collection paths",
    `- distribution groups: ${topClusters.distribution.length}`,
    `- funding groups: ${topClusters.funding.length}`,
    `- collection groups: ${topClusters.collection.length}`,
    ...topClusters.distribution.slice(0, 5).map((group) => `- distribution ${group.relation_key}: ${group.wallet_count} wallets, sell ${formatUsd(group.sell_volume_usd)}`),
    ...topClusters.collection.slice(0, 5).map((group) => `- collector ${group.relation_key}: ${group.wallet_count} wallets, sell ${formatUsd(group.sell_volume_usd)}`),
    "",
    "## Monitoring targets",
    ...(watchlist.length ? watchlist.map((item) => `- ${item.priority} ${item.address} — ${item.reason}`) : ["- none"]),
    "",
    "## Limitations",
    "- GMGN holder/trader/tag endpoints are samples; this report does not claim full transfer history.",
    "- Visible sell lower bound is not a complete realized PnL or complete cash-out amount.",
    ...(dataGaps.length ? dataGaps.map((gap) => `- ${gap}`) : []),
  ].join("\n");
}

function addressOf(row) {
  if (!row || typeof row !== "object") return null;
  for (const key of ADDRESS_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function tagsOf(row) {
  const values = [];
  walkKeys(row, TAG_KEYS, (value) => {
    if (Array.isArray(value)) values.push(...value);
    else if (typeof value === "string") values.push(value);
  });
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].slice(0, 20);
}

function relationValues(row, keys) {
  const values = new Set();
  walkKeys(row, keys, (value) => {
    const add = (candidate) => {
      if (typeof candidate !== "string") return;
      const value = candidate.trim();
      if (value && value !== addressOf(row) && value.length >= 20) values.add(value);
    };
    if (Array.isArray(value)) value.forEach((item) => {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") Object.values(item).forEach(add);
    });
    else if (value && typeof value === "object") Object.values(value).forEach(add);
    else add(value);
  });
  return [...values].slice(0, 10);
}

function walkKeys(value, wanted, callback) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkKeys(item, wanted, callback));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (wanted.has(String(key).toLowerCase())) callback(child, key);
    if (child && typeof child === "object") walkKeys(child, wanted, callback);
  }
}

function findFirst(value, keys) {
  const wanted = new Set(keys.map((key) => String(key).toLowerCase()));
  let found;
  const visit = (node) => {
    if (found !== undefined || node == null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (wanted.has(String(key).toLowerCase())) {
        found = child;
        return;
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(value);
  return found;
}

function firstNumber(value, keys) {
  const result = parseNumber(findFirst(value, keys));
  return result == null ? null : result;
}

function firstPercent(value, keys) {
  const raw = findFirst(value, keys);
  const parsed = parseNumber(raw);
  if (parsed == null) return null;
  const text = String(raw ?? "");
  if (text.includes("%") || parsed > 1) return parsed / 100;
  return parsed;
}

function parseNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object") {
    for (const key of ["price", "value", "usd_value", "amount", "current", "total"]) {
      const nested = parseNumber(value[key]);
      if (nested != null) return nested;
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim().replace(/[$,]/g, "");
  if (!raw) return null;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let number = Number(match[0]);
  const suffix = raw.slice(match.index + match[0].length).trim().charAt(0).toLowerCase();
  if (suffix === "k") number *= 1_000;
  if (suffix === "m") number *= 1_000_000;
  if (suffix === "b") number *= 1_000_000_000;
  if (suffix === "t") number *= 1_000_000_000_000;
  return Number.isFinite(number) ? number : null;
}

function transferPresent(value, direction) {
  const bool = findFirst(value, [direction === "in" ? "transfer_in" : "transfer_out"]);
  if (typeof bool === "boolean") return bool;
  if (typeof bool === "number") return bool > 0;
  if (typeof bool === "string" && /^(true|yes|1)$/i.test(bool.trim())) return true;
  const amountKeys = direction === "in"
    ? ["current_transfer_in_amount", "history_transfer_in_amount", "token_transfer_in"]
    : ["current_transfer_out_amount", "history_transfer_out_amount", "token_transfer_out"];
  return amountKeys.some((key) => {
    const raw = findFirst(value, [key]);
    if (key.includes("token_transfer")) return Boolean(raw && typeof raw === "object");
    return (parseNumber(raw) || 0) > 0;
  });
}

function isMarketMaker(wallet) {
  const tags = wallet.tags.join(" ").toLowerCase();
  const explicit = /(dex[_ -]?bot|sniper|bundler|rat[_ -]?trader|bot|axiom|photon|trojan|bullx|maestro|padre)/.test(tags);
  const volume = wallet.buy_volume_usd + wallet.sell_volume_usd;
  const trades = wallet.buy_tx_count + wallet.sell_tx_count;
  return explicit || (trades >= 50 && volume >= 50_000 && wallet.hold_rate < 0.02) || (volume >= 250_000 && wallet.hold_rate < 0.05 && wallet.sell_volume_usd > 0);
}

function isDistributionWallet(wallet) {
  const tags = wallet.tags.join(" ").toLowerCase();
  return wallet.has_transfer_in && (wallet.hold_rate >= 0.005 || wallet.buy_volume_usd >= 10_000)
    || /(bundler|rat[_ -]?trader|sniper)/.test(tags) && wallet.hold_rate >= 0.005;
}

function isCashoutWallet(wallet) {
  return wallet.has_transfer_out || wallet.sell_volume_usd >= 10_000 || wallet.sold_rate >= 0.5;
}

function countTags(wallets) {
  const counts = {};
  for (const wallet of wallets) {
    for (const tag of wallet.tags) counts[tag] = (counts[tag] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 20));
}

function uniqueRelationKeys(wallets, relation) {
  return [...new Set(wallets.flatMap((wallet) => wallet.relations[relation]))].slice(0, 12);
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function formatUsd(value) {
  if (value == null || !Number.isFinite(Number(value))) return "unknown";
  const amount = Number(value);
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

function formatPct(value) {
  if (value == null || !Number.isFinite(Number(value))) return "unknown";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export default { buildSolanaMemeForensicReport };
