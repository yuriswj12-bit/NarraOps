// @ts-nocheck
export class InMemoryDevWalletRepository {
  #wallets = new Map();
  #snapshots = new Map();

  registerFromTokens(tokens, observedAt = new Date().toISOString()) {
    let registered = 0;
    for (const token of tokens) {
      if (!token.creator_address) continue;
      const key = `${token.chain}:${token.creator_address}`;
      const current = this.#wallets.get(key) || {
        chain: token.chain,
        address: token.creator_address,
        labels: ["gmgn_creator", `${token.platform_id || "unknown"}_creator`],
        tokens: [],
        firstSeenAt: observedAt,
        realizedPnlUsd: null,
        unrealizedPnlUsd: null,
        pnlStatus: "enrichment_pending",
      };
      if (!current.tokens.some(({ token_address }) => token_address === token.token_address)) {
        current.tokens.push({
          token_address: token.token_address,
          symbol: token.symbol,
          name: token.name,
          launchpad_platform: token.launchpad_platform,
          created_at: token.created_at,
          market_cap_usd: token.market_cap_usd,
        });
      }
      current.lastSeenAt = observedAt;
      current.creatorHoldRate = token.creator_hold_rate;
      current.creatorTokenStatus = token.creator_token_status;
      current.source = "gmgn";
      this.#wallets.set(key, current);
      registered += 1;
    }
    return registered;
  }

  applyStats(stats, observedAt = new Date().toISOString()) {
    for (const item of stats || []) {
      const key = `${item.chain}:${item.address}`;
      const wallet = this.#wallets.get(key);
      if (!wallet) continue;
      const history = this.#snapshots.get(key) || [];
      const previous = [...history].reverse().find(({ period }) => period === item.period);
      const snapshot = {
        ...structuredClone(item),
        observed_at: observedAt,
        previous_observed_at: previous?.observed_at || null,
        previous_realized_profit_usd: previous?.realized_profit_usd || null,
        realized_profit_change_usd: decimalDifference(item.realized_profit_usd, previous?.realized_profit_usd),
      };
      history.push(snapshot);
      this.#snapshots.set(key, history.slice(-60));
      wallet.pnlStatus = "enriched";
      wallet.performance = wallet.performance || {};
      wallet.performance[item.period] = snapshot;
    }
  }

  list({ chain } = {}) {
    return [...this.#wallets.values()]
      .filter((wallet) => !chain || wallet.chain === chain)
      .map((wallet) => structuredClone(wallet));
  }
}

function decimalDifference(current, previous) {
  if (current == null || previous == null) return null;
  const left = parseDecimal(current);
  const right = parseDecimal(previous);
  if (!left || !right) return null;
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.value * (10n ** BigInt(scale - left.scale));
  const rightValue = right.value * (10n ** BigInt(scale - right.scale));
  return formatDecimal(leftValue - rightValue, scale);
}

function parseDecimal(value) {
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return null;
  const fraction = match[3] || "";
  const integer = BigInt(`${match[2]}${fraction}`) * (match[1] ? -1n : 1n);
  return { value: integer, scale: fraction.length };
}

function formatDecimal(value, scale) {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, "0");
  if (scale === 0) return `${sign}${digits}`;
  const result = `${sign}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return result.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
