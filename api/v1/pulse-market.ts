// @ts-nocheck

const COMPONENTS = Object.freeze([
  ["long_term_dev", "0.25"],
  ["recent_dev", "0.20"],
  ["daily_launch", "0.10"],
  ["graduated", "0.30"],
  ["dex_volume", "0.15"],
]);

function decimalOrNull(value) {
  return value == null ? null : String(value);
}

function component(row, name, weight) {
  const score = decimalOrNull(row?.[`${name}_score`]);
  const rawField = name === "dex_volume" ? "dex_volume_usd" : `${name}_count`;
  const rawValue = decimalOrNull(row?.[rawField]);
  return {
    raw_value: rawValue,
    score,
    weight,
    status: rawValue == null
      ? "missing"
      : score == null
        ? "insufficient_history"
        : "ready",
  };
}

export function buildPulseMarketResponse(rows = []) {
  const ordered = [...rows].sort(
    (left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at),
  );
  const current = ordered[0] || null;
  const previous = ordered.find(
    (row) =>
      current &&
      Date.parse(row.observed_at) <=
        Date.parse(current.observed_at) - 24 * 60 * 60 * 1000,
  );
  const value = decimalOrNull(current?.market_activity_index);
  const previousValue = decimalOrNull(previous?.market_activity_index);
  const change24h =
    value != null && previousValue != null
      ? (Number(value) - Number(previousValue)).toFixed(2)
      : null;

  return {
    schema_version: "pulse.market.v1",
    data_status: current?.calculation_status || "awaiting_market_observation",
    observed_at: current?.observed_at || null,
    index: {
      name: "Meme Market Activity Index",
      value,
      change_24h: change24h,
      unit: "points",
      methodology:
        "Percentile-normalized against 30-90 daily observations, then weighted.",
      components: Object.fromEntries(
        COMPONENTS.map(([name, weight]) => [
          name,
          component(current, name, weight),
        ]),
      ),
    },
    sparkline: ordered
      .filter((row) => row.market_activity_index != null)
      .slice(0, 30)
      .reverse()
      .map((row) => ({
        observed_at: row.observed_at,
        value: String(row.market_activity_index),
      })),
    explanation:
      "Measures Solana Meme market production activity and capital participation. It is not a price prediction or trading signal.",
  };
}

export async function loadPulseMarketResponse(supabase) {
  if (!supabase) return buildPulseMarketResponse([]);
  const { data, error } = await supabase
    .from("pulse_market_observations")
    .select(
      "observed_on,observed_at,long_term_dev_count,recent_dev_count,daily_launch_count,graduated_count,dex_volume_usd,long_term_dev_score,recent_dev_score,daily_launch_score,graduated_score,dex_volume_score,market_activity_index,calculation_status,component_status,source_status",
    )
    .order("observed_at", { ascending: false })
    .limit(91);
  if (error) {
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code)) {
      return {
        ...buildPulseMarketResponse([]),
        data_status: "persistence_not_ready",
      };
    }
    throw Object.assign(new Error("Unable to read Pulse market observations"), {
      status: 503,
      code: "PULSE_MARKET_UNAVAILABLE",
    });
  }
  return buildPulseMarketResponse(data || []);
}
