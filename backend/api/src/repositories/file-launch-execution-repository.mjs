import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ApiError } from "../errors.mjs";
import { randomUUID } from "node:crypto";

export class FileLaunchExecutionRepository {
  constructor({ filePath }) { this.filePath = filePath; this.store = this.#load(); }
  #load() {
    if (!existsSync(this.filePath)) return { format: "narraops-launch-executions-v1", executions: {}, audit: [] };
    try { const value = JSON.parse(readFileSync(this.filePath, "utf8")); if (value?.format !== "narraops-launch-executions-v1") throw new Error(); return value; }
    catch { throw new ApiError(500, "LAUNCH_STORE_CORRUPTED", "Launch execution store cannot be read safely"); }
  }
  #save() { mkdirSync(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.${process.pid}.tmp`; writeFileSync(temporary, `${JSON.stringify(this.store)}\n`, { encoding: "utf8", mode: 0o600 }); renameSync(temporary, this.filePath); }
  create(execution) { this.store.executions[execution.executionId] = structuredClone(execution); this.appendAudit(execution.executionId, "launch.prepared", { status: execution.status }); return this.get(execution.executionId); }
  get(id) { return this.store.executions[id] ? structuredClone(this.store.executions[id]) : null; }
  update(id, patch, eventType = "launch.state_changed") { const current = this.store.executions[id]; if (!current) throw new ApiError(404, "LAUNCH_EXECUTION_NOT_FOUND", "Launch execution was not found"); Object.assign(current, structuredClone(patch), { updatedAt: new Date().toISOString() }); this.appendAudit(id, eventType, { status: current.status, transactionHash: current.transactionHash }); return this.get(id); }
  appendAudit(executionId, type, data = {}) { this.store.audit.push({ auditId: randomUUID(), executionId, type, at: new Date().toISOString(), ...structuredClone(data) }); this.#save(); }
  recoverable() { return Object.values(this.store.executions).filter(({ status }) => ["submitted", "confirming_launch", "launch_confirmed", "follow_buy_signing", "follow_buys_submitted"].includes(status)).map((value) => structuredClone(value)); }
}
