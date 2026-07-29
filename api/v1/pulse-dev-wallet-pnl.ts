// @ts-nocheck

const TIMEFRAMES = Object.freeze(["24h", "7d", "30d"]);

function decimalOrNull(value) {
  return value == null ? null : String(value);
}

export function buildPulseDevWalletPnlResponse(rows = []) {
  const ranges = Object.fromEntries(
    TIMEFRAMES.map((timeframe) => {
      const ordered = rows
        .filter((row) => row?.timeframe === timeframe)
        .filter(
          (row) =>
            Number.isFinite(Date.parse(row.snapshot_at)) &&
            Number.isFinite(Number(row.total_realized_pnl_usd)),
        )
        .sort(
          (left, right) =>
            Date.parse(left.snapshot_at) - Date.parse(right.snapshot_at),
        );
      const current = ordered.at(-1) || null;
      return [
        timeframe,
        {
          timeframe,
          value: decimalOrNull(current?.total_realized_pnl_usd),
          snapshot_at: current?.snapshot_at || null,
          source_status: current?.source_status || "unavailable",
          history: ordered.map((row) => ({
            observed_at: row.snapshot_at,
            value: String(row.total_realized_pnl_usd),
          })),
        },
      ];
    }),
  );

  return {
    schema_version: "pulse.dev-wallet-pnl.v1",
    data_status: ranges["24h"].source_status,
    ranges,
    methodology:
      "Sum of realized USD PnL reported for tracked Dev wallets in each selected GMGN wallet-performance period. Missing wallets are omitted rather than estimated.",
  };
}

export async function loadPulseDevWalletPnlResponse(supabase) {
  if (!supabase) return buildPulseDevWalletPnlResponse([]);
  const { data, error } = await supabase
    .from("pulse_dev_wallet_pnl_snapshots")
    .select(
      "snapshot_at,timeframe,total_realized_pnl_usd,source_status",
    )
    .order("snapshot_at", { ascending: false })
    .limit(3000);
  if (error) {
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code)) {
      return {
        ...buildPulseDevWalletPnlResponse([]),
        data_status: "persistence_not_ready",
      };
    }
    throw Object.assign(new Error("Unable to read Dev wallet PnL snapshots"), {
      status: 503,
      code: "PULSE_DEV_WALLET_PNL_UNAVAILABLE",
    });
  }
  return buildPulseDevWalletPnlResponse(data || []);
}
