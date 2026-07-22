// @ts-nocheck
import { randomUUID } from "node:crypto";
import { InMemoryAuditLog } from "./audit-log.ts";
import { ExecutionError } from "./errors.ts";
import { InMemoryIdempotencyStore, requestFingerprint } from "./idempotency-store.ts";
import { SIMULATION_TRANSITIONS } from "./simulation-constants.ts";
import { validateSimulationRequest } from "./simulation-validation.ts";

const DEFAULT_DISABLED_REASON = "Real signing and broadcasting are disabled. This result is simulation-only and cannot move funds.";
const COST_UNAVAILABLE = Object.freeze({ amount: "0", currency: "native", basis: "simulation_estimate_unavailable" });

function estimateCost(request) {
  const supplied = request.parameters?.estimated_cost;
  if (!supplied) return { ...COST_UNAVAILABLE };
  if (typeof supplied.amount !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(supplied.amount)) {
    throw new ExecutionError("INVALID_ESTIMATED_COST", "estimated_cost.amount must be a non-negative decimal string");
  }
  return {
    amount: supplied.amount,
    currency: String(supplied.currency || "native"),
    basis: "user_supplied_simulation_input",
  };
}

export class SimulationService {
  constructor({ idempotencyStore = new InMemoryIdempotencyStore(), auditLog = new InMemoryAuditLog() } = {}) {
    this.idempotencyStore = idempotencyStore;
    this.auditLog = auditLog;
    this.results = new Map();
  }

  #transition(result, nextStatus) {
    const allowed = SIMULATION_TRANSITIONS[result.status] || [];
    if (!allowed.includes(nextStatus)) {
      throw new ExecutionError("INVALID_SIMULATION_TRANSITION", `Cannot transition simulation from ${result.status} to ${nextStatus}`);
    }
    result.status = nextStatus;
    result.execution_mode = nextStatus.endsWith("_disabled") ? "disabled" : "simulation";
    this.auditLog.append({
      simulation_id: result.simulation_id,
      action_type: result.action_type,
      chain: result.chain,
      status: nextStatus,
      execution_mode: result.execution_mode,
    });
  }

  async simulate(request) {
    validateSimulationRequest(request);
    const fingerprint = requestFingerprint(request);
    const simulationId = randomUUID();
    const reservation = this.idempotencyStore.reserve(request.idempotency_key, fingerprint, simulationId);
    if (!reservation.created) {
      if (reservation.record.result) return { ...reservation.record.result, idempotent_replay: true };
      throw new ExecutionError("SIMULATION_IN_PROGRESS", "A simulation with this idempotency key is already in progress", { simulation_id: reservation.record.executionId });
    }

    const result = {
      simulation_id: simulationId,
      idempotency_key: request.idempotency_key,
      action_type: request.action_type,
      chain: request.chain,
      wallet_group_id: request.wallet_group_id ?? null,
      estimated_cost: COST_UNAVAILABLE,
      risk_notes: [
        "Simulation output is an estimate and may differ from chain conditions.",
        "No signature was produced and no transaction was broadcast.",
      ],
      disabled_reason: DEFAULT_DISABLED_REASON,
      created_at: new Date().toISOString(),
      status: "planned",
      execution_mode: "simulation",
    };
    this.results.set(simulationId, result);
    this.auditLog.append({ simulation_id: simulationId, action_type: result.action_type, chain: result.chain, status: "planned", execution_mode: "simulation" });

    try {
      this.#transition(result, "validating");
      result.estimated_cost = estimateCost(request);
      this.#transition(result, "simulated");
      this.#transition(result, "requires_user_confirmation");
    } catch (error) {
      if (SIMULATION_TRANSITIONS[result.status]?.includes("failed_simulation")) this.#transition(result, "failed_simulation");
      result.risk_notes.push(`Simulation failed: ${error.code || "SIMULATION_ERROR"}`);
      this.idempotencyStore.complete(request.idempotency_key, result);
      throw error;
    }

    this.idempotencyStore.complete(request.idempotency_key, result);
    return structuredClone(result);
  }

  confirm(simulationId) {
    const result = this.#get(simulationId);
    this.#transition(result, "signing_disabled");
    result.disabled_reason = DEFAULT_DISABLED_REASON;
    return structuredClone(result);
  }

  attemptBroadcast(simulationId) {
    const result = this.#get(simulationId);
    this.#transition(result, "broadcasting_disabled");
    result.disabled_reason = DEFAULT_DISABLED_REASON;
    return structuredClone(result);
  }

  cancel(simulationId) {
    const result = this.#get(simulationId);
    this.#transition(result, "cancelled");
    return structuredClone(result);
  }

  get(simulationId) {
    return structuredClone(this.#get(simulationId));
  }

  #get(simulationId) {
    const result = this.results.get(simulationId);
    if (!result) throw new ExecutionError("SIMULATION_NOT_FOUND", "Simulation was not found");
    return result;
  }
}

