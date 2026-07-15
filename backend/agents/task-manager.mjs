import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

export class TaskManager extends EventEmitter {
  #repository;
  #handlers;
  #stepDelayMs;
  #timers = new Set();

  constructor({ repository, handlers, stepDelayMs = 80 }) {
    super();
    this.#repository = repository;
    this.#handlers = handlers;
    this.#stepDelayMs = stepDelayMs;
  }

  create(type, input, requestId) {
    const now = new Date().toISOString();
    const task = this.#repository.create({
      taskId: randomUUID(),
      type,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      requestId,
      input,
    });
    this.#emit("task.created", task);
    this.#schedule(() => this.#run(task.taskId));
    return this.publicTask(task);
  }

  get(taskId) {
    const task = this.#repository.get(taskId);
    return task ? this.publicTask(task, { includeResult: true }) : null;
  }

  publicTask(task, { includeResult = false } = {}) {
    const result = {
      taskId: task.taskId,
      type: task.type,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    if (includeResult && task.result !== undefined) result.result = task.result;
    if (includeResult && task.failure) result.failure = task.failure;
    return result;
  }

  close() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.removeAllListeners();
  }

  #schedule(callback) {
    const timer = setTimeout(() => {
      this.#timers.delete(timer);
      callback();
    }, this.#stepDelayMs);
    this.#timers.add(timer);
  }

  async #run(taskId) {
    let task = this.#repository.update(taskId, { status: "running", progress: 20, updatedAt: new Date().toISOString() });
    if (!task || TERMINAL.has(task.status)) return;
    this.#emit("task.progress", task);

    try {
      const handler = this.#handlers[task.type];
      if (!handler) throw new Error(`No handler registered for ${task.type}`);
      task = this.#repository.update(taskId, { progress: 65, updatedAt: new Date().toISOString() });
      this.#emit("task.progress", task);
      const result = await handler(task.input, { taskId, requestId: task.requestId });
      task = this.#repository.update(taskId, {
        status: "succeeded",
        progress: 100,
        result,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.#emit("task.completed", task);
    } catch (error) {
      task = this.#repository.update(taskId, {
        status: "failed",
        progress: 100,
        failure: { code: "AGENT_TASK_FAILED", message: "The mock agent task failed" },
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.#emit("task.failed", task);
    }
  }

  #emit(type, task) {
    this.emit("taskEvent", { eventId: randomUUID(), type, task: this.publicTask(task, { includeResult: type === "task.completed" }) });
  }
}
