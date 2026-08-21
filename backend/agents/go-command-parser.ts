// @ts-nocheck
import { ApiError } from "../api/src/errors.ts";
import { commandForName, policyForType } from "./go-command-catalog.ts";

const NATURAL_RULES = [
  { pattern: /(分析.*(?:meme|代币|合约|token)|(?:meme|token|contract).*(?:分析|analysis|research|due diligence))/i, type: "meme.analyze" },
  { pattern: /(你可以做什么|你能做什么|能做什么|有什么功能|介绍.*功能|介绍.*能力|介绍自己|自我介绍|你是谁|help|what can you do|who are you|capabilities?)/i, type: "agent.chat" },
  { pattern: /(近期总结|最近总结|recent\s*summary|account\s*summary)/i, type: "account.recent-summary" },
  { pattern: /(我(?:的|发射了|发射过).*(?:发射|meme|代币)|发射.*(?:多少|几个|记录|历史)|launch\s*(?:history|record|count)|my\s*launches)/i, type: "account.launches.summary" },
  { pattern: /(我的项目|项目表现|project\s*performance|my\s*projects)/i, type: "account.project.performance" },
  { pattern: /(盈亏|收益|赚了多少|盈利|pnl|profit|earnings|my\s*pnl)/i, type: "account.pnl.summary" },
  { pattern: /(分析.*meme|meme.*分析|analy[sz]e\s*meme|合约.*分析)/i, type: "meme.analyze" },
  { pattern: /(提取|提现|withdraw|extract)/i, type: "funds.withdraw" },
  { pattern: /(转账|转到|打款|transfer|send\s+.+\s+to)/i, type: "funds.transfer" },
  { pattern: /(^|\s)(确认|确认买入|确认卖出|confirm(?:\s+(?:buy|sell|trade))?|execute)(\s|$)/i, type: "trade.confirm" },
  { pattern: /(批量卖|卖出|batch\s*sell|\bsell\b)/i, type: "trade.sell.batch" },
  { pattern: /(批量买|买入|batch\s*buy|\bbuy\b)/i, type: "trade.buy.batch" },
  { pattern: /(发射|发行\s*(?:代币|一个币|币)|发币|发个币|上币|创建代币|建个币|launch|deploy)/i, type: "launch.meme" },
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

  // A bare public link is a Go launch input.
  if (/^https?:\/\/\S+$/i.test(normalized)) {
    const policy = policyForType("launch.meme");
    return {
      type: "launch.meme",
      category: policy.category,
      command: "/launch",
      raw_input: normalized,
      arguments: normalized,
      parsed_by: "public_link",
      requires_confirmation: policy.requires_confirmation,
      execution_mode: policy.execution_mode,
    };
  }

  const matched = NATURAL_RULES.find((rule) => rule.pattern.test(normalized));
  const type = matched?.type || "agent.chat";
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
