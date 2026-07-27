// @ts-nocheck

const COMPONENTS = Object.freeze([
  ["daily_tokens_created", "0.15"],
  ["tokens_launched_24h", "0.20"],
  ["graduated_tokens_24h", "0.30"],
  ["daily_active_wallets", "0.20"],
  ["daily_revenue_usd", "0.15"],
]);

function decimalOrNull(value) {
  return value == null ? null : String(value);
}

function component(row, name, weight) {
  const score = decimalOrNull(row?.[`${name}_score`]);
  const rawValue = decimalOrNull(row?.[name]);
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
    schema_version: "pulse.market.v2",
    data_status: current?.calculation_status || "awaiting_market_observation",
    observed_at: current?.observed_at || null,
    index: {
      name: "Meme Market Activity Index",
      value,
      change_24h: change24h,
      unit: "points",
      methodology:
        "Pump.fun aggregates are percentile-normalized against up to 90 prior snapshots, then weighted. New components start at a neutral Beta score until a prior snapshot exists.",
      components: Object.fromEntries(
        COMPONENTS.map(([name, weight]) => [
          name,
          component(current, name, weight),
        ]),
      ),
    },
    sparkline: ordered
      .filter((row) => row.market_activity_index != null)
      .reverse()
      .map((row) => ({
        observed_at: row.observed_at,
        value: String(row.market_activity_index),
      })),
    explanation:
      "Measures Pump.fun Meme market creation, graduation, wallet participation, and revenue activity. It is not a price prediction or trading signal.",
  };
}

export async function loadPulseMarketResponse(supabase) {
  if (!supabase) return buildPulseMarketResponse([]);
  const { data, error } = await supabase
    .from("pulse_pumpfun_market_observations")
    .select(
      "observation_bucket,observed_at,daily_tokens_created,tokens_launched_24h,graduated_tokens_24h,daily_active_wallets,daily_revenue_usd,daily_tokens_created_score,tokens_launched_24h_score,graduated_tokens_24h_score,daily_active_wallets_score,daily_revenue_usd_score,market_activity_index,calculation_status,component_status,source_status",
    )
    .order("observed_at", { ascending: false })
    .limit(3000);
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
