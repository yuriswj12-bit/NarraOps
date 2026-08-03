// @ts-nocheck

// A provider gap is explicit and contains no fabricated balances or PnL.
export function unavailablePortfolio(period = "7d") {
  return {
    mode: "unavailable",
    period,
    currency: "USD",
    totalBalance: null,
    turnover: null,
    realizedPnl: null,
    unrealizedPnl: null,
    pnlPercent: null,
    history: [],
    dataStatus: "unavailable",
    updatedAt: new Date().toISOString(),
  };
}
