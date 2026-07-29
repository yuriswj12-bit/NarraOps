// @ts-nocheck

const COMPONENTS = Object.freeze([
  ["launched_tokens_24h", "launch_score", "0.15"],
  ["graduated_tokens_24h", "graduation_score", "0.55"],
  ["active_wallets_24h", "active_wallet_score", "0.30"],
]);

function decimalOrNull(value) {
  return value == null ? null : String(value);
}

function component(row, name, scoreField, weight) {
  const score = decimalOrNull(row?.[scoreField]);
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
  const displayRow =
    ordered.find(
      (row) =>
        row.market_activity_index_display != null ||
        row.market_activity_index != null,
    ) || null;
  const previous = ordered.find(
    (row) =>
      displayRow &&
      (row.market_activity_index_display != null ||
        row.market_activity_index != null) &&
      Date.parse(row.observed_at) <=
        Date.parse(displayRow.observed_at) - 24 * 60 * 60 * 1000,
  );
  const value = decimalOrNull(
    displayRow?.market_activity_index_display ??
      displayRow?.market_activity_index,
  );
  const previousValue = decimalOrNull(
    previous?.market_activity_index_display ?? previous?.market_activity_index,
  );
  const change24h =
    value != null && previousValue != null
      ? (Number(value) - Number(previousValue)).toFixed(2)
      : null;

  return {
    schema_version: "pulse.market.v3",
    data_status:
      current?.history_status ||
      current?.calculation_status ||
      "awaiting_market_observation",
    observed_at: current?.observed_at || null,
    displayed_observed_at: displayRow?.observed_at || null,
    index: {
      name: "Meme Market Activity Index",
      value,
      change_24h: change24h,
      unit: "points",
      methodology:
        "Bounded samples of real Pump.fun transactions estimate 24-hour launch and graduation rates; a rotating wallet panel measures participation. Each metric is ranked against earlier real hourly snapshots using duplicate-aware mid-rank percentiles. No neutral default or synthetic history is used.",
      value_source:
        displayRow === current ? "current_chain_observation" : "legacy_fallback",
      raw_value: decimalOrNull(displayRow?.market_activity_index_raw),
      baseline_sample_count: displayRow?.baseline_sample_count ?? 0,
      history_coverage: decimalOrNull(displayRow?.history_coverage),
      components: Object.fromEntries(
        COMPONENTS.map(([name, scoreField, weight]) => [
          name,
          component(displayRow, name, scoreField, weight),
        ]),
      ),
    },
    current_observation: {
      observed_at: current?.observed_at || null,
      history_status:
        current?.history_status ||
        current?.calculation_status ||
        "awaiting_market_observation",
      raw_value: decimalOrNull(current?.market_activity_index_raw),
      display_value: decimalOrNull(current?.market_activity_index_display),
      baseline_sample_count: current?.baseline_sample_count ?? 0,
      history_coverage: decimalOrNull(current?.history_coverage),
      components: Object.fromEntries(
        COMPONENTS.map(([name, scoreField, weight]) => [
          name,
          component(current, name, scoreField, weight),
        ]),
      ),
    },
    sparkline: ordered
      .filter(
        (row) =>
          row.market_activity_index_display != null ||
          row.market_activity_index != null,
      )
      .reverse()
      .map((row) => ({
        observed_at: row.observed_at,
        value: String(
          row.market_activity_index_display ?? row.market_activity_index,
        ),
      })),
    explanation:
      "Measures Pump.fun Meme market creation, graduation, and wallet participation from bounded on-chain samples. It is not a full transaction census, price prediction, or trading signal.",
  };
}

export async function loadPulseMarketResponse(supabase) {
  if (!supabase) return buildPulseMarketResponse([]);
  const { data, error } = await supabase
    .from("pulse_pumpfun_market_observations")
    .select(
      "observation_bucket,observed_at,launched_tokens_24h,graduated_tokens_24h,active_wallets_24h,launch_score,graduation_score,active_wallet_score,market_activity_index_raw,market_activity_index_display,baseline_sample_count,history_coverage,history_status,sampling_audit,index_method_version,market_activity_index,calculation_status,component_status,source_status",
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
