// @ts-nocheck
export class InMemoryTaskRepository {
  #tasks = new Map();

  create(task) {
    this.#tasks.set(task.taskId, structuredClone(task));
    return this.get(task.taskId);
  }

  update(taskId, patch) {
    const current = this.#tasks.get(taskId);
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch) };
    this.#tasks.set(taskId, next);
    return structuredClone(next);
  }

  get(taskId) {
    const task = this.#tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }
}
