// @ts-nocheck
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const MAX_REPLAY_TASKS = 256;
const MAX_REPLAY_EVENTS_PER_TASK = 64;

export const AGENT_DOMAIN_EVENTS = Object.freeze([
  "agent_task_created",
  "command_parsed",
  "narrative_detected",
  "meme_draft_ready",
  "wallet_group_plan_ready",
  "launch_plan_ready",
  "trade_confirmation_required",
  "trade_submitted",
  "execution_unavailable",
  "revenue_share_updated",
  "agent.started",
  "agent.delta",
  "agent.card",
  "agent.completed",
  "agent.failed",
]);

export class TaskManager extends EventEmitter {
  #repository;
  #handlers;
  #stepDelayMs;
  #timers = new Set();
  #eventHistory = new Map();

  constructor({ repository, handlers, stepDelayMs = 80 }) {
    super();
    this.#repository = repository;
    this.#handlers = handlers;
    this.#stepDelayMs = stepDelayMs;
  }

  async create(type, input, requestId, metadata = {}) {
    const now = new Date().toISOString();
    const task = await this.#repository.create({
      taskId: randomUUID(),
      type,
      status: "queued",
      progress: 0,
      createdAt: now,
      updatedAt: now,
      requestId,
      input,
      requiresConfirmation: Boolean(metadata.requires_confirmation),
      executionMode: metadata.execution_mode || "live",
      parsedInput: metadata,
      conversationId: metadata.conversation_id || null,
      channel: metadata.channel || null,
    });
    this.#emit("task.created", task);
    this.#emitDomain("agent_task_created", task, {
      parsed_by: metadata.parsed_by || "explicit_type",
    });
    this.#schedule(() => this.#run(task.taskId));
    return this.publicTask(task);
  }

  async get(taskId) {
    const task = await this.#repository.get(taskId);
    return task ? this.publicTask(task, { includeResult: true }) : null;
  }

  publishDomainEvent(type, payload = {}) {
    if (!AGENT_DOMAIN_EVENTS.includes(type)) throw new Error(`Unsupported Agent domain event: ${type}`);
    this.#publish({ eventId: randomUUID(), type, data: structuredClone(payload) });
  }

  eventsForTask(taskId) {
    if (!taskId) return [];
    return structuredClone(this.#eventHistory.get(taskId) || []);
  }

  publicTask(task, { includeResult = false } = {}) {
    const result = {
      taskId: task.taskId,
      type: task.type,
      status: task.status,
      progress: task.progress,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      requiresConfirmation: Boolean(task.requiresConfirmation),
      executionMode: task.executionMode || "live",
    };
    if (includeResult && task.result !== undefined) result.result = task.result;
    if (includeResult && task.failure) result.failure = task.failure;
    return result;
  }

  close() {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
    this.#eventHistory.clear();
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
    let task = await this.#repository.update(taskId, { status: "running", progress: 20, updatedAt: new Date().toISOString() });
    if (!task || TERMINAL.has(task.status)) return;
    this.#emit("task.progress", task);
    this.#emitDomain("agent.started", task, { progress: task.progress });

    try {
      const handler = this.#handlers[task.type];
      if (!handler) throw new Error(`No handler registered for ${task.type}`);
      task = await this.#repository.update(taskId, { progress: 65, updatedAt: new Date().toISOString() });
      this.#emit("task.progress", task);
      if (task.parsedInput?.raw_input) {
        this.#emitDomain("command_parsed", task, {
          command: task.parsedInput.command,
          category: task.parsedInput.category,
          parsed_by: task.parsedInput.parsed_by,
        });
      }
      const result = await handler(task.input, {
        taskId,
        requestId: task.requestId,
        executionMode: task.executionMode,
        conversationId: task.conversationId || task.parsedInput?.conversation_id || null,
        userId: task.input?.context?.userId || task.input?.context?.user_id || task.parsedInput?.user_id || null,
        channel: task.channel || task.parsedInput?.channel || null,
        emitEvent: (type, payload = {}) => this.#emitDomain(type, task, payload),
      });
      if (result?.card) {
        this.#emitDomain("agent.card", task, { card: result.card });
      }
      task = await this.#repository.update(taskId, {
        status: "succeeded",
        progress: 100,
        result,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.#emit("task.completed", task);
      this.#emitDomain("agent.completed", task, { progress: 100, result });
    } catch (error) {
      task = await this.#repository.update(taskId, {
        status: "failed",
        progress: 100,
        failure: {
          code: "AGENT_TASK_FAILED",
          message: error instanceof Error ? error.message : "The agent task failed",
        },
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      this.#emit("task.failed", task);
      this.#emitDomain("agent.failed", task, { failure: task.failure });
    }
  }

  #emit(type, task) {
    this.#publish({ eventId: randomUUID(), type, task: this.publicTask(task, { includeResult: type === "task.completed" }) });
  }

  #emitDomain(type, task, payload = {}) {
    if (!AGENT_DOMAIN_EVENTS.includes(type)) throw new Error(`Unsupported Agent domain event: ${type}`);
    this.#publish({
      eventId: randomUUID(),
      type,
      data: {
        task_id: task.taskId,
        ...(task.parsedInput?.conversation_id ? { conversation_id: task.parsedInput.conversation_id } : {}),
        type: task.type,
        status: task.status,
        execution_mode: task.executionMode || "live",
        ...payload,
      },
    });
  }

  #publish(event) {
    const taskId = event.data?.task_id || event.task?.taskId;
    if (taskId) {
      if (!this.#eventHistory.has(taskId) && this.#eventHistory.size >= MAX_REPLAY_TASKS) {
        this.#eventHistory.delete(this.#eventHistory.keys().next().value);
      }
      const history = this.#eventHistory.get(taskId) || [];
      history.push(structuredClone(event));
      if (history.length > MAX_REPLAY_EVENTS_PER_TASK) history.splice(0, history.length - MAX_REPLAY_EVENTS_PER_TASK);
      this.#eventHistory.set(taskId, history);
    }
    this.emit("taskEvent", event);
  }
}
