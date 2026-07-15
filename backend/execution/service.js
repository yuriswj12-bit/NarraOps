import { randomUUID } from "node:crypto";
import { InMemoryAuditLog } from "./audit-log.js";
import { ExecutionError } from "./errors.js";
import { InMemoryIdempotencyStore, requestFingerprint } from "./idempotency-store.js";
import { validateExecutionRequest } from "./validation.js";

const zeroTiming = () => ({ planningMs: 0, signingMs: 0, submissionMs: 0, confirmationMs: 0, totalMs: 0 });

export class ExecutionService {
  constructor({ adapters = new Map(), idempotencyStore = new InMemoryIdempotencyStore(), auditLog = new InMemoryAuditLog(), realExecutionEnabled = false } = {}) {
    this.adapters = adapters;
    this.idempotencyStore = idempotencyStore;
    this.auditLog = auditLog;
    this.realExecutionEnabled = realExecutionEnabled;
  }

  async execute(request) {
    validateExecutionRequest(request);
    const fingerprint = requestFingerprint(request);
    const executionId = randomUUID();
    const reservation = this.idempotencyStore.reserve(request.idempotencyKey, fingerprint, executionId);
    if (!reservation.created) {
      if (reservation.record.result) return { ...reservation.record.result, idempotentReplay: true };
      throw new ExecutionError("EXECUTION_IN_PROGRESS", "An execution with this idempotency key is already in progress", { executionId: reservation.record.executionId });
    }

    const startedAt = new Date().toISOString();
    const result = {
      executionId,
      status: "planned",
      submittedCount: 0,
      confirmedCount: 0,
      failedCount: 0,
      transactions: [],
      startedAt,
      submittedAt: null,
      completedAt: null,
      timing: zeroTiming(),
    };
    this.auditLog.append({ executionId, requestId: request.requestId, operation: request.operation, chain: request.chain, status: "planned" });

    if (!this.realExecutionEnabled) {
      this.idempotencyStore.complete(request.idempotencyKey, result);
      return result;
    }

    const adapter = this.adapters.get(request.chain);
    if (!adapter) throw new ExecutionError("ADAPTER_NOT_CONFIGURED", `No execution adapter configured for ${request.chain}`);
    throw new ExecutionError("REAL_EXECUTION_NOT_IMPLEMENTED", "Real execution remains disabled until signer and policy services are integrated");
  }
}

