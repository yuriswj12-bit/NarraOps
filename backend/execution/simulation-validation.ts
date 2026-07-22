// @ts-nocheck
import { ExecutionError } from "./errors.ts";
import { SIMULATION_ACTION_TYPES } from "./simulation-constants.ts";

const CHAINS = new Set(["solana", "bsc", "base"]);
const forbiddenKey = /(^|_)(private|secret|seed|mnemonic|signature|raw_transaction|signed_transaction|authorization|cookie)(_|$)/i;

function assertNoSecrets(value, path = "request") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      throw new ExecutionError("SECRET_FIELD_REJECTED", `Secret-bearing field is forbidden: ${path}.${key}`, { field: `${path}.${key}` });
    }
    assertNoSecrets(child, `${path}.${key}`);
  }
}

export function validateSimulationRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new ExecutionError("INVALID_SIMULATION_REQUEST", "Simulation request must be an object");
  }
  assertNoSecrets(request);
  if (!SIMULATION_ACTION_TYPES.includes(request.action_type)) {
    throw new ExecutionError("UNSUPPORTED_SIMULATION_ACTION", "Unsupported simulation action type");
  }
  if (!CHAINS.has(request.chain)) throw new ExecutionError("UNSUPPORTED_CHAIN", "Unsupported simulation chain");
  if (!/^[A-Za-z0-9._:-]{8,255}$/.test(request.idempotency_key || "")) {
    throw new ExecutionError("INVALID_IDEMPOTENCY_KEY", "Invalid simulation idempotency key");
  }
  if (request.wallet_group_id !== null && request.wallet_group_id !== undefined && typeof request.wallet_group_id !== "string") {
    throw new ExecutionError("INVALID_WALLET_GROUP", "wallet_group_id must be a string or null");
  }
  if (request.action_type !== "wallet_group_create_simulation" && !request.wallet_group_id) {
    throw new ExecutionError("MISSING_WALLET_GROUP", "wallet_group_id is required for this action");
  }
  if (request.parameters !== undefined && (!request.parameters || typeof request.parameters !== "object" || Array.isArray(request.parameters))) {
    throw new ExecutionError("INVALID_PARAMETERS", "parameters must be an object");
  }
  return request;
}

