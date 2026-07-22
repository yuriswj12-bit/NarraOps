// @ts-nocheck
import { ApiError } from "../api/src/errors.ts";
import { commandForName, policyForType } from "./go-command-catalog.ts";

const NATURAL_RULES = [
  { pattern: /(链上行情|dev\s*market|developer\s*market|onchain\s*market)/i, type: "dev.market.scan" },
  { pattern: /(近期总结|recent\s*summary|account\s*summary)/i, type: "account.recent-summary" },
  { pattern: /(分析.*meme|meme.*分析|analy[sz]e\s*meme|合约.*分析)/i, type: "meme.analyze" },
  { pattern: /(叙事.*趋势|narrative\s*trend)/i, type: "narrative.trends" },
  { pattern: /(提取|提现|withdraw|extract)/i, type: "funds.withdraw" },
  { pattern: /(转账|转到|打款|transfer|send\s+.+\s+to)/i, type: "funds.transfer" },
  { pattern: /(批量卖|卖出|batch\s*sell|\bsell\b)/i, type: "trade.sell.batch" },
  { pattern: /(批量买|买入|batch\s*buy|\bbuy\b)/i, type: "trade.buy.batch" },
  { pattern: /(发射|发行|launch)/i, type: "launch.meme" },
  { pattern: /(钱包组|wallet\s*group)/i, type: "wallet.group.create" },
  { pattern: /(创建.*meme|生成.*meme|meme\s*(create|draft|idea)|做.*梗)/i, type: "meme.create" },
  { pattern: /(推特|twitter|\bx\b|tiktok|抖音|热点|叙事|趋势|pulse|narrative|trend)/i, type: "narrative.recommend" },
];

export function parseGoInput(text) {
  const normalized = String(text || "").trim();
  if (!normalized) throw new ApiError(400, "VALIDATION_ERROR", "input or command is required");

  if (normalized.startsWith("/")) {
    const [name, ...args] = normalized.split(/\s+/);
    const command = commandForName(name);
    if (!command) throw new ApiError(400, "UNKNOWN_AGENT_COMMAND", `Unknown slash command: ${name}`);
    return {
      type: command.type,
      category: command.category,
      command: command.command,
      raw_input: normalized,
      arguments: args.join(" "),
      parsed_by: "slash_command",
      requires_confirmation: command.requires_confirmation,
      execution_mode: command.execution_mode,
    };
  }

  const matched = NATURAL_RULES.find((rule) => rule.pattern.test(normalized));
  const type = matched?.type || "narrative.recommend";
  const policy = policyForType(type);
  return {
    type,
    category: policy.category,
    command: null,
    raw_input: normalized,
    arguments: normalized,
    parsed_by: "natural_language",
    requires_confirmation: policy.requires_confirmation,
    execution_mode: policy.execution_mode,
  };
}
