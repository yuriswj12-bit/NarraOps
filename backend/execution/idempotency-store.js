import { createHash } from "node:crypto";
import { ExecutionError } from "./errors.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function requestFingerprint(request) {
  return createHash("sha256").update(JSON.stringify(stable(request))).digest("hex");
}

export class InMemoryIdempotencyStore {
  #records = new Map();

  reserve(key, fingerprint, executionId) {
    const current = this.#records.get(key);
    if (current) {
      if (current.fingerprint !== fingerprint) throw new ExecutionError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used with a different payload", { executionId: current.executionId });
      return { created: false, record: current };
    }
    const record = { key, fingerprint, executionId, state: "reserved", result: null, createdAt: new Date().toISOString() };
    this.#records.set(key, record);
    return { created: true, record };
  }

  complete(key, result) {
    const record = this.#records.get(key);
    if (!record) throw new ExecutionError("IDEMPOTENCY_NOT_RESERVED", "Idempotency key was not reserved");
    record.state = "completed";
    record.result = structuredClone(result);
    return record;
  }

  get(key) {
    const record = this.#records.get(key);
    return record ? structuredClone(record) : null;
  }
}

