// @ts-nocheck
import { AMOUNT_MODES, EXECUTION_CHAINS, EXECUTION_OPERATIONS } from "../../shared/constants/execution.ts";
import { ExecutionError } from "./errors.ts";

const decimal = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function validateExecutionRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new ExecutionError("INVALID_REQUEST", "Execution request must be an object");
  const required = ["requestId", "operation", "chain", "walletGroupId", "amountMode", "amounts", "slippageBps", "priorityFee", "idempotencyKey"];
  for (const field of required) if (request[field] === undefined || request[field] === null || request[field] === "") throw new ExecutionError("MISSING_FIELD", `Missing required field: ${field}`, { field });
  if (!EXECUTION_OPERATIONS.includes(request.operation)) throw new ExecutionError("UNSUPPORTED_OPERATION", "Unsupported execution operation");
  if (!EXECUTION_CHAINS.includes(request.chain)) throw new ExecutionError("UNSUPPORTED_CHAIN", "Unsupported execution chain");
  if (!AMOUNT_MODES.includes(request.amountMode)) throw new ExecutionError("INVALID_AMOUNT_MODE", "Unsupported amount mode");
  if (!Array.isArray(request.amounts) || request.amounts.length === 0 || request.amounts.some((amount) => !decimal.test(String(amount)))) throw new ExecutionError("INVALID_AMOUNTS", "Amounts must be non-negative decimal strings");
  if (!Number.isInteger(request.slippageBps) || request.slippageBps < 0 || request.slippageBps > 10000) throw new ExecutionError("INVALID_SLIPPAGE", "slippageBps must be an integer from 0 to 10000");
  if (!decimal.test(String(request.priorityFee))) throw new ExecutionError("INVALID_PRIORITY_FEE", "priorityFee must be a non-negative decimal string");
  if (!/^[A-Za-z0-9._:-]{8,255}$/.test(request.idempotencyKey)) throw new ExecutionError("INVALID_IDEMPOTENCY_KEY", "Invalid idempotencyKey format");
  return request;
}

