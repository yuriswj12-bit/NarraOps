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
    execution_mode: "mock",
  },
  {
    command: "/pulse",
    aliases: ["/narrative", "/trend"],
    category: "narrative",
    type: "narrative.recommend",
    description: "Discover meme-ready narratives from social and market signals.",
    usage: "/pulse [topic or source]",
    requires_confirmation: false,
    execution_mode: "mock",
  },
  {
    command: "/meme",
    aliases: ["/create-meme"],
    category: "meme",
    type: "meme.create",
    description: "Create a meme identity, ticker, story, and social draft.",
    usage: "/meme <idea or narrative>",
    requires_confirmation: false,
    execution_mode: "mock",
  },
  {
    command: "/narrative-trends",
    aliases: ["/trends"],
    category: "analysis",
    type: "narrative.trends",
    description: "Score narratives used by recently launched memes across chains.",
    usage: "/narrative-trends [time range]",
    requires_confirmation: false,
    execution_mode: "mock",
  },
  {
    command: "/analyze-meme",
    aliases: ["/analyze"],
    category: "analysis",
    type: "meme.analyze",
    description: "Create a read-only meme forensic report from a contract address.",
    usage: "/analyze-meme <contract address>",
    requires_confirmation: false,
    execution_mode: "mock",
  },
  {
    command: "/recent-summary",
    aliases: ["/summary"],
    category: "summary",
    type: "account.recent-summary",
    description: "Summarize recent launches, PnL, dev wallets, and wallet-group activity.",
    usage: "/recent-summary [7d|30d]",
    requires_confirmation: false,
    execution_mode: "mock",
  },
  {
    command: "/wallet-group",
    aliases: ["/wallet", "/create-wallet-group"],
    category: "wallet",
    type: "wallet.group.create",
    description: "Create a simulated wallet-group plan without generating or storing keys.",
    usage: "/wallet-group <name> [count]",
    requires_confirmation: false,
    execution_mode: "simulation",
  },
  {
    command: "/launch",
    aliases: ["/launch-meme"],
    category: "launch",
    type: "launch.meme",
    description: "Build a launch plan. Submission remains disabled.",
    usage: "/launch <meme or narrative id>",
    requires_confirmation: true,
    execution_mode: "disabled",
  },
  {
    command: "/buy",
    aliases: ["/batch-buy"],
    category: "trade",
    type: "trade.buy.batch",
    description: "Simulate a batch buy plan. Trading remains disabled.",
    usage: "/buy <token> <amount> [wallet group]",
    requires_confirmation: true,
    execution_mode: "disabled",
  },
  {
    command: "/sell",
    aliases: ["/batch-sell"],
    category: "trade",
    type: "trade.sell.batch",
    description: "Simulate a batch sell plan. Trading remains disabled.",
    usage: "/sell <token> <amount or percent> [wallet group]",
    requires_confirmation: true,
    execution_mode: "disabled",
  },
  {
    command: "/transfer",
    aliases: ["/send"],
    category: "funds",
    type: "funds.transfer",
    description: "Simulate a transfer intent. Fund movement remains disabled.",
    usage: "/transfer <amount> <asset> <destination>",
    requires_confirmation: true,
    execution_mode: "disabled",
  },
  {
    command: "/withdraw",
    aliases: ["/extract"],
    category: "funds",
    type: "funds.withdraw",
    description: "Simulate a withdrawal intent. Fund movement remains disabled.",
    usage: "/withdraw <amount> <asset> <destination>",
    requires_confirmation: true,
    execution_mode: "disabled",
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
    return { type, category: "narrative", requires_confirmation: false, execution_mode: "mock" };
  }
  if (type === "launch.package") {
    return { type, category: "launch", requires_confirmation: true, execution_mode: "disabled" };
  }
  if (type === "agent.chat") return AGENT_CHAT_POLICY;
  return null;
}
