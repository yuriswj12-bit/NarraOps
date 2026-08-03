// @ts-nocheck
export class InMemoryTaskRepository {
  #tasks = new Map();

  async create(task) {
    this.#tasks.set(task.taskId, structuredClone(task));
    return this.get(task.taskId);
  }

  async update(taskId, patch) {
    const current = await this.get(taskId);
    if (!current) return null;
    const next = { ...current, ...structuredClone(patch) };
    this.#tasks.set(taskId, next);
    return structuredClone(next);
  }

  async get(taskId) {
    const task = this.#tasks.get(taskId);
    return task ? structuredClone(task) : null;
  }
}
