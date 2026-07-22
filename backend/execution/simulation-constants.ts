// @ts-nocheck
export const SIMULATION_ACTION_TYPES = Object.freeze([
  "wallet_group_create_simulation",
  "transfer_simulation",
  "withdraw_simulation",
  "launch_simulation",
  "batch_buy_simulation",
  "batch_sell_simulation",
]);

export const SIMULATION_STATUSES = Object.freeze([
  "planned",
  "validating",
  "simulated",
  "requires_user_confirmation",
  "signing_disabled",
  "broadcasting_disabled",
  "failed_simulation",
  "cancelled",
]);

export const SIMULATION_EXECUTION_MODES = Object.freeze(["simulation", "disabled"]);

export const SIMULATION_TRANSITIONS = Object.freeze({
  planned: Object.freeze(["validating", "cancelled"]),
  validating: Object.freeze(["simulated", "failed_simulation", "cancelled"]),
  simulated: Object.freeze(["requires_user_confirmation", "cancelled"]),
  requires_user_confirmation: Object.freeze(["signing_disabled", "cancelled"]),
  signing_disabled: Object.freeze(["broadcasting_disabled", "cancelled"]),
  broadcasting_disabled: Object.freeze([]),
  failed_simulation: Object.freeze([]),
  cancelled: Object.freeze([]),
});

