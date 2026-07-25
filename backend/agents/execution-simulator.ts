// @ts-nocheck
import { randomUUID } from "node:crypto";

export const EXECUTION_SIMULATION_STATUSES = Object.freeze([
  "planned",
  "validating",
  "simulated",
  "requires_user_confirmation",
  "signing_disabled",
  "broadcasting_disabled",
  "failed_simulation",
  "cancelled",
]);

export const EXECUTION_SIMULATION_TYPES = Object.freeze([
  "wallet_group_create_simulation",
  "transfer_simulation",
  "withdraw_simulation",
  "launch_simulation",
  "batch_buy_simulation",
  "batch_sell_simulation",
]);

export function simulateExecution(simulationType, input = {}) {
  if (!EXECUTION_SIMULATION_TYPES.includes(simulationType)) {
    return {
      simulation_id: randomUUID(),
      simulation_type: simulationType,
      execution_mode: "disabled",
      execution_status: "failed_simulation",
      status_history: ["planned", "validating", "failed_simulation"],
      requires_user_confirmation: false,
      signing_status: "signing_disabled",
      broadcasting_status: "broadcasting_disabled",
      executable: false,
      submitted: false,
      failure: { code: "UNSUPPORTED_SIMULATION", message: "Unsupported execution simulation type" },
    };
  }

  const walletPlanning = simulationType === "wallet_group_create_simulation";
  const requiresConfirmation = !walletPlanning;
  const executionMode = walletPlanning ? "simulation" : "disabled";
  const finalStatus = requiresConfirmation ? "requires_user_confirmation" : "simulated";
  const statusHistory = ["planned", "validating", "simulated"];
  if (requiresConfirmation) statusHistory.push("requires_user_confirmation");

  return {
    simulation_id: randomUUID(),
    simulation_type: simulationType,
    execution_mode: executionMode,
    execution_status: finalStatus,
    status_history: statusHistory,
    requires_user_confirmation: requiresConfirmation,
    signing_status: "signing_disabled",
    broadcasting_status: "broadcasting_disabled",
    executable: false,
    submitted: false,
    tx_hash: null,
    reason: requiresConfirmation ? "real_execution_disabled" : "simulation_only",
    interpreted_input: typeof input.prompt === "string" ? input.prompt : null,
    safety: {
      private_keys_read: false,
      private_keys_generated: false,
      transaction_signed: false,
      transaction_broadcast: false,
    },
  };
}
