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

export const GO_COMMANDS = Object.freeze([    {
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
    command: "/my-launches",
    aliases: ["/launch-history", "/my-history", "/发射记录"],
    category: "summary",
    type: "account.launches.summary",
    description: "Summarize the authenticated user's launch history.",
    usage: "/my-launches [7d|30d]",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/my-projects",
    aliases: ["/project-performance", "/我的项目"],
    category: "summary",
    type: "account.project.performance",
    description: "Report per-project launch performance for the authenticated user.",
    usage: "/my-projects",
    requires_confirmation: false,
    execution_mode: "live_read_only",
  },
  {
    command: "/my-pnl",
    aliases: ["/pnl", "/盈亏", "/收益"],
    category: "summary",
    type: "account.pnl.summary",
    description: "Report the authenticated user's launch execution history and PnL overview.",
    usage: "/my-pnl",
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
  if (type === "wallet.group.create") {
    return { type, category: "wallet", requires_confirmation: false, execution_mode: "live_internal_wallet" };
  }
  if (type === "funds.transfer" || type === "funds.withdraw") {
    return { type, category: "funds", requires_confirmation: true, execution_mode: "confirmation_required" };
  }
  if (type === "agent.chat") return AGENT_CHAT_POLICY;
  return null;
}
