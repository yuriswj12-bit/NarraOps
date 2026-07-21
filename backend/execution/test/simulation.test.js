import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionError, SIMULATION_ACTION_TYPES, SimulationService } from "../index.js";

function request(action_type, overrides = {}) {
  return {
    action_type,
    chain: "solana",
    wallet_group_id: action_type === "wallet_group_create_simulation" ? null : "group-alpha",
    idempotency_key: `simulation:${action_type}`,
    parameters: { estimated_cost: { amount: "0.01", currency: "SOL" } },
    ...overrides,
  };
}

test("all supported Go action types produce simulation-only results", async () => {
  for (const actionType of SIMULATION_ACTION_TYPES) {
    const service = new SimulationService();
    const result = await service.simulate(request(actionType));
    assert.equal(result.action_type, actionType);
    assert.equal(result.status, "requires_user_confirmation");
    assert.equal(result.execution_mode, "simulation");
    assert.equal(result.estimated_cost.amount, "0.01");
    assert.match(result.disabled_reason, /disabled/i);
    assert.equal("txHash" in result, false);
  }
});

test("confirmation stops at signing_disabled", async () => {
  const service = new SimulationService();
  const simulated = await service.simulate(request("transfer_simulation"));
  const confirmed = service.confirm(simulated.simulation_id);
  assert.equal(confirmed.status, "signing_disabled");
  assert.equal(confirmed.execution_mode, "disabled");
});

test("broadcast attempt remains disabled and produces no transaction", async () => {
  const service = new SimulationService();
  const simulated = await service.simulate(request("batch_buy_simulation"));
  service.confirm(simulated.simulation_id);
  const result = service.attemptBroadcast(simulated.simulation_id);
  assert.equal(result.status, "broadcasting_disabled");
  assert.equal(result.execution_mode, "disabled");
  assert.equal("transactions" in result, false);
});

test("idempotent replay returns the same simulation", async () => {
  const service = new SimulationService();
  const first = await service.simulate(request("launch_simulation"));
  const replay = await service.simulate(request("launch_simulation"));
  assert.equal(replay.simulation_id, first.simulation_id);
  assert.equal(replay.idempotent_replay, true);
});

test("idempotency key cannot be reused with changed parameters", async () => {
  const service = new SimulationService();
  await service.simulate(request("withdraw_simulation"));
  await assert.rejects(
    () => service.simulate(request("withdraw_simulation", { parameters: { estimated_cost: { amount: "0.02", currency: "SOL" } } })),
    (error) => error instanceof ExecutionError && error.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("secret-bearing fields are rejected recursively", async () => {
  const service = new SimulationService();
  await assert.rejects(
    () => service.simulate(request("batch_sell_simulation", { parameters: { signer: { private_key: "forbidden" } } })),
    (error) => error instanceof ExecutionError && error.code === "SECRET_FIELD_REJECTED",
  );
});

test("simulation can be cancelled before confirmation", async () => {
  const service = new SimulationService();
  const simulated = await service.simulate(request("transfer_simulation"));
  const cancelled = service.cancel(simulated.simulation_id);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.execution_mode, "simulation");
});

test("invalid state transitions are rejected", async () => {
  const service = new SimulationService();
  const simulated = await service.simulate(request("transfer_simulation"));
  service.cancel(simulated.simulation_id);
  assert.throws(
    () => service.confirm(simulated.simulation_id),
    (error) => error instanceof ExecutionError && error.code === "INVALID_SIMULATION_TRANSITION",
  );
});

