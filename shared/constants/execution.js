export const EXECUTION_OPERATIONS = Object.freeze([
  "token.launch",
  "transfer.distribute",
  "transfer.multi",
  "trade.batchBuy",
  "trade.batchSell",
  "token.collect",
  "token.burn",
  "liquidity.lock",
]);

export const EXECUTION_STATUSES = Object.freeze([
  "planned",
  "signing",
  "submitted",
  "confirmed",
  "partially_failed",
  "failed",
  "timed_out",
]);

export const EXECUTION_CHAINS = Object.freeze(["solana", "bsc", "base"]);
export const AMOUNT_MODES = Object.freeze(["fixed", "random", "percentage", "per_wallet"]);

