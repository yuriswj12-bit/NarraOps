// @ts-nocheck
export class InMemoryAuditLog {
  #events = [];

  append(event) {
    const safe = structuredClone(event);
    for (const field of ["privateKey", "secretKey", "mnemonic", "seed", "signature"]) delete safe[field];
    this.#events.push(Object.freeze({ ...safe, recordedAt: new Date().toISOString() }));
  }

  list(executionId) {
    return this.#events
      .filter((event) => !executionId || event.executionId === executionId)
      .map((event) => structuredClone(event));
  }
}

