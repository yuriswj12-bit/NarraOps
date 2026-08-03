// @ts-nocheck
import { randomUUID } from "node:crypto";
import { InMemoryAuditLog } from "./audit-log.ts";
import { ExecutionError } from "./errors.ts";
import { InMemoryIdempotencyStore, requestFingerprint } from "./idempotency-store.ts";
import { validateExecutionRequest } from "./validation.ts";

const zeroTiming = () => ({ planningMs: 0, signingMs: 0, submissionMs: 0, confirmationMs: 0, totalMs: 0 });

export class ExecutionService {
  constructor({ adapters = new Map(), idempotencyStore = new InMemoryIdempotencyStore(), auditLog = new InMemoryAuditLog(), realExecutionEnabled = true } = {}) {
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

    if (!this.realExecutionEnabled) throw new ExecutionError("EXECUTION_PROVIDER_UNAVAILABLE", "Live execution provider is not configured");

    const adapter = this.adapters.get(request.chain);
    if (!adapter) throw new ExecutionError("ADAPTER_NOT_CONFIGURED", `No execution adapter configured for ${request.chain}`);
    if (typeof adapter.execute !== "function") throw new ExecutionError("EXECUTION_PROVIDER_UNAVAILABLE", `Execution adapter for ${request.chain} is not configured`);
    const executed = await adapter.execute(request);
    const completed = { ...result, ...executed, executionId };
    this.idempotencyStore.complete(request.idempotencyKey, completed);
    return completed;
  }
}

