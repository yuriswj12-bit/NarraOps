// @ts-nocheck
export function mockAccountPortfolio(period = "7d") {
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
