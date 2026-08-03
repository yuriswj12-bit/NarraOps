// @ts-nocheck
export const GO_CATEGORIES = Object.freeze([
  "narrative",
  "meme",
  "wallet",
  "launch",
  "trade",
  "funds",
  "market",
  "analysis",
  "summary",
]);

export const AGENT_CHAT_POLICY = Object.freeze({
  type: "agent.chat",
  category: "assistant",
  requires_confirmation: false,
  execution_mode: "assistant",
});

export const GO_COMMANDS = Object.freeze([
  {
    command: "/dev-market",
    aliases: ["/market", "/onchain-market"],
    category: "market",
    type: "dev.market.scan",
    description: "Scan meme markets and summarize registered developer-wallet performance.",
    usage: "/dev-market [solana|bsc|robinhood]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/market-trending",
    aliases: ["/trending", "/hot-tokens", "/hot"],
    category: "market",
    type: "market.trending",
    description: "Read the GMGN trending-token ranking for a supported chain.",
    usage: "/market-trending [solana|bsc|base|eth]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/trenches",
    aliases: ["/new-tokens", "/new-launches"],
    category: "market",
    type: "market.trenches",
    description: "Read newly created, near-completion, and completed launchpad tokens from GMGN.",
    usage: "/trenches [solana|bsc|base|eth]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/kline",
    aliases: ["/chart", "/price-chart"],
    category: "market",
    type: "market.kline",
    description: "Read GMGN OHLCV candlestick data for a public token address.",
    usage: "/kline <contract address> [solana|bsc|base|eth]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/signals",
    aliases: ["/signal", "/smart-money-signals"],
    category: "market",
    type: "market.signal",
    description: "Read GMGN token signal groups such as smart-money buys and price spikes.",
    usage: "/signals [solana|bsc]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/pulse",
    aliases: ["/narrative", "/trend"],
    category: "narrative",
    type: "narrative.recommend",
    description: "Discover meme-ready narratives from social and market signals.",
    usage: "/pulse [topic or source]",
    requires_confirmation: false,
    execution_mode: "live_llm",
  },
  {
    command: "/meme",
    aliases: ["/create-meme"],
    category: "meme",
    type: "meme.create",
    description: "Create a meme identity, ticker, story, and social draft.",
    usage: "/meme <idea or narrative>",
    requires_confirmation: false,
    execution_mode: "live_llm",
  },
  {
    command: "/narrative-trends",
    aliases: ["/trends"],
    category: "analysis",
    type: "narrative.trends",
    description: "Score narratives used by recently launched memes across chains.",
    usage: "/narrative-trends [time range]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/analyze-meme",
    aliases: ["/analyze"],
    category: "analysis",
    type: "meme.analyze",
    description: "Create a read-only meme forensic report from a contract address.",
    usage: "/analyze-meme <contract address>",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/recent-summary",
    aliases: ["/summary"],
    category: "summary",
    type: "account.recent-summary",
    description: "Summarize recent launches, PnL, dev wallets, and wallet-group activity.",
    usage: "/recent-summary [7d|30d]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/launch",
    aliases: ["/launch-meme"],
    category: "launch",
    type: "launch.meme",
    description: "Build a live launch draft from a narrative or public link and wait for explicit confirmation.",
    usage: "/launch <meme or narrative id>",
    requires_confirmation: true,
    execution_mode: "live_confirmation_required",
  },
  {
    command: "/confirm-trade",
    aliases: ["/confirm-buy", "/confirm-sell", "/confirm"],
    category: "trade",
    type: "trade.confirm",
    description: "Explicitly confirm the latest reviewed buy or sell plan.",
    usage: "/confirm-trade",
    requires_confirmation: true,
    execution_mode: "confirmation_required",
  },
  {
    command: "/buy",
    aliases: ["/batch-buy"],
    category: "trade",
    type: "trade.buy.batch",
    description: "Create a batch buy plan and require explicit confirmation before trading.",
    usage: "/buy <token> <amount> [wallet group]",
    requires_confirmation: true,
    execution_mode: "confirmation_required",
  },
  {
    command: "/sell",
    aliases: ["/batch-sell"],
    category: "trade",
    type: "trade.sell.batch",
    description: "Create a batch sell plan and require explicit confirmation before trading.",
    usage: "/sell <token> <amount or percent> [wallet group]",
    requires_confirmation: true,
    execution_mode: "confirmation_required",
  },
]);

const POLICY_BY_TYPE = new Map(GO_COMMANDS.map((entry) => [entry.type, entry]));
const COMMAND_LOOKUP = new Map(
  GO_COMMANDS.flatMap((entry) => [entry.command, ...entry.aliases].map((name) => [name, entry])),
);

export function commandForName(name) {
  return COMMAND_LOOKUP.get(String(name || "").toLowerCase());
}

export function policyForType(type) {
  const policy = POLICY_BY_TYPE.get(type);
  if (policy) return policy;
  if (type === "narrative.scan" || type === "narrative.generate") {
    return { type, category: "narrative", requires_confirmation: false, execution_mode: type === "narrative.generate" ? "live_llm" : "live_read_only" };
  }
  if (type === "launch.package") {
    return { type, category: "launch", requires_confirmation: true, execution_mode: "live_confirmation_required" };
  }
  if (type === "agent.chat") return AGENT_CHAT_POLICY;
  return null;
}
