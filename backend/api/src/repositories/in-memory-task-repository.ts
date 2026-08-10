// @ts-nocheck
import { assertTaskTransition } from "../../../agent-runtime/tasks/state-machine.ts";

export class InMemoryTaskRepository {
  #tasks = new Map();
  #events = new Map();

  async create(task) {
    this.#tasks.set(task.taskId, structuredClone({
      stateVersion: 1,
      attemptCount: 0,
      ...task,
    }));
    return this.get(task.taskId);
  }

  async update(taskId, patch) {
    const current = await this.get(taskId);
    if (!current) return null;
    if (patch.status && patch.status !== current.status) {
      assertTaskTransition(current.status, patch.status);
    }
    const next = {
      ...current,
      ...structuredClone(patch),
      stateVersion: current.stateVersion + 1,
    };
    this.#tasks.set(taskId, next);
    return structuredClone(next);
  }

  async transition(taskId, { expectedStatuses, expectedVersion, patch, event }) {
    const current = await this.get(taskId);
    if (!current) return null;
    if (expectedStatuses?.length && !expectedStatuses.includes(current.status)) return null;
    if (expectedVersion != null && current.stateVersion !== expectedVersion) return null;
    const task = await this.update(taskId, patch);
    const persistedEvent = event ? await this.appendEvent({ ...event, taskId }) : null;
    return { task, event: persistedEvent };
  }

  async appendEvent(event) {
    const taskId = event.taskId || event.data?.task_id || event.task?.taskId;
    if (!taskId) throw new Error("Durable Agent events require a taskId");
    const history = this.#events.get(taskId) || [];
    const existing = history.find((item) => item.eventId === event.eventId);
    if (existing) return structuredClone(existing);
    const persisted = {
      ...structuredClone(event),
      taskId,
      sequence: history.length + 1,
      createdAt: event.createdAt || new Date().toISOString(),
    };
    history.push(persisted);
    this.#events.set(taskId, history);
    return structuredClone(persisted);
  }

  async listEvents(taskId, { afterSequence = 0, limit = 200 } = {}) {
    return structuredClone(
      (this.#events.get(taskId) || [])
        .filter((event) => event.sequence > afterSequence)
        .slice(0, Math.min(Math.max(limit, 1), 500)),
    );
  }

  async listRecoverable({ now = new Date().toISOString(), limit = 100 } = {}) {
    const at = Date.parse(now);
    return [...this.#tasks.values()]
      .filter((task) => {
        if (task.status === "queued") return true;
        if (task.status !== "running") return false;
        return !task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= at;
      })
      .slice(0, limit)
      .map((task) => structuredClone(task));
  }

  async get(taskId) {
    const task = this.#tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }
}
