// @ts-nocheck
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import {
  assertTaskTransition,
  isTerminalTaskStatus,
} from "../agent-runtime/tasks/state-machine.ts";

const MAX_REPLAY_TASKS = 256;
const MAX_REPLAY_EVENTS_PER_TASK = 64;

export const AGENT_DOMAIN_EVENTS = Object.freeze([
  "agent_task_created",
  "command_parsed",
  "narrative_detected",
  "meme_draft_ready",
  "wallet_group_plan_ready",
  "wallet_group_created",
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
  #workerId;
  #leaseMs;

  constructor({
    repository,
    handlers,
    stepDelayMs = 80,
    workerId = randomUUID(),
    leaseMs = 60_000,
  }) {
    super();
    this.#repository = repository;
    this.#handlers = handlers;
    this.#stepDelayMs = stepDelayMs;
    this.#workerId = workerId;
    this.#leaseMs = Math.max(5_000, leaseMs);
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
      actorId: metadata.user_id || input?.context?.userId || input?.context?.user_id || null,
      client: metadata.channel || input?.context?.currentView || "api",
      capability: type,
      contextRefs: input?.context?.contextRefs || [],
      idempotencyKey: metadata.idempotency_key || null,
      attemptCount: 0,
      maxAttempts: metadata.max_attempts || 3,
    });
    await this.#recordTaskEvent("task.created", task);
    await this.#recordDomainEvent("agent_task_created", task, {
      parsed_by: metadata.parsed_by || "explicit_type",
    });
    const runPromise = this.#run(task.taskId);
    return { task: this.publicTask(task), done: runPromise };
  }

  async createAndWait(type, input, requestId, metadata = {}, timeoutMs = 8_000) {
    const created = await this.create(type, input, requestId, metadata);
    const taskId = created.task.taskId;
    const timedOut = new Promise((resolve) => {
      setTimeout(() => resolve(null), Math.max(250, timeoutMs));
    });
    await Promise.race([created.done.catch(() => null), timedOut]);
    const latest = await this.get(taskId);
    return latest || created.task;
  }

  async get(taskId) {
    const task = await this.#repository.get(taskId);
    return task ? this.publicTask(task, { includeResult: true }) : null;
  }

  async getForActor(taskId, actorId) {
    const task = await this.#repository.get(taskId);
    if (!task || !actorId || this.#actorId(task) !== actorId) return null;
    return this.publicTask(task, { includeResult: true });
  }

  async cancel(taskId, actorId, reason = "cancelled_by_user") {
    const current = await this.#repository.get(taskId);
    if (!current || this.#actorId(current) !== actorId) return null;
    if (isTerminalTaskStatus(current.status)) return this.publicTask(current, { includeResult: true });
    const transitioned = await this.#transition(
      current,
      [current.status],
      {
        status: "cancelled",
        progress: current.progress,
        failure: { code: "AGENT_TASK_CANCELLED", message: String(reason).slice(0, 500) },
        completedAt: new Date().toISOString(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
      "task.cancelled",
    );
    return transitioned ? this.publicTask(transitioned, { includeResult: true }) : null;
  }

  publishDomainEvent(type, payload = {}) {
    if (!AGENT_DOMAIN_EVENTS.includes(type)) throw new Error(`Unsupported Agent domain event: ${type}`);
    this.#publish({ eventId: randomUUID(), type, data: structuredClone(payload), createdAt: new Date().toISOString() });
  }

  eventsForTask(taskId) {
    if (!taskId) return [];
    return structuredClone(this.#eventHistory.get(taskId) || []);
  }

  async loadEventsForTask(taskId, { afterSequence = 0, limit = 200 } = {}) {
    if (!taskId) return [];
    const durable = this.#repository.listEvents
      ? await this.#repository.listEvents(taskId, { afterSequence, limit })
      : [];
    const memory = this.eventsForTask(taskId).filter(
      (event) => !event.sequence || event.sequence > afterSequence,
    );
    const byId = new Map();
    for (const event of [...durable, ...memory]) byId.set(event.eventId, event);
    return [...byId.values()]
      .sort((left, right) => {
        if (left.sequence && right.sequence) return left.sequence - right.sequence;
        return Date.parse(left.createdAt || 0) - Date.parse(right.createdAt || 0);
      })
      .slice(0, Math.min(Math.max(limit, 1), 500));
  }

  async eventsForActor(taskId, actorId, options = {}) {
    const task = await this.#repository.get(taskId);
    if (!task || !actorId || this.#actorId(task) !== actorId) return null;
    return this.loadEventsForTask(taskId, options);
  }

  async recover({ limit = 100 } = {}) {
    if (!this.#repository.listRecoverable) return { examined: 0, resumed: 0, reconciled: 0 };
    const candidates = await this.#repository.listRecoverable({ limit });
    let resumed = 0;
    let reconciled = 0;
    for (const task of candidates) {
      if ((task.attemptCount || 0) >= (task.maxAttempts || 3)) {
        await this.#transition(task, [task.status], {
          status: "failed",
          completedAt: new Date().toISOString(),
          leaseOwner: null,
          leaseExpiresAt: null,
          failure: {
            code: "AGENT_RECOVERY_ATTEMPTS_EXHAUSTED",
            message: "The task exhausted its bounded recovery attempts.",
            retryable: false,
          },
        }, "task.failed");
        continue;
      }
      if (task.expiresAt && Date.parse(task.expiresAt) <= Date.now()) {
        await this.#transition(task, [task.status], {
          status: "expired",
          completedAt: new Date().toISOString(),
          leaseOwner: null,
          leaseExpiresAt: null,
        }, "task.expired");
        continue;
      }
      if (task.status === "running") {
        if (task.requiresConfirmation || task.executionMode === "execution") {
          await this.#transition(task, ["running"], {
            status: "reconciliation_required",
            leaseOwner: null,
            leaseExpiresAt: null,
            failure: {
              code: "AGENT_RECOVERY_RECONCILIATION_REQUIRED",
              message: "The process stopped while a protected task was running; execution state must be reconciled before retry.",
            },
          }, "task.reconciliation_required");
          reconciled += 1;
          continue;
        }
        const reset = await this.#transition(task, ["running"], {
          status: "queued",
          leaseOwner: null,
          leaseExpiresAt: null,
        }, "task.recovered");
        if (!reset) continue;
        task.status = "queued";
        task.stateVersion = reset.stateVersion;
      }
      resumed += 1;
      void this.#run(task.taskId);
    }
    return { examined: candidates.length, resumed, reconciled };
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
    if (task.stateVersion != null) result.stateVersion = task.stateVersion;
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

  async #run(taskId) {
    let current = await this.#repository.get(taskId);
    if (!current || current.status !== "queued") return;
    const leaseExpiresAt = new Date(Date.now() + this.#leaseMs).toISOString();
    let task = await this.#transition(current, ["queued"], {
      status: "running",
      progress: 20,
      leaseOwner: this.#workerId,
      leaseExpiresAt,
      attemptCount: (current.attemptCount || 0) + 1,
    }, "task.progress");
    if (!task) return;
    await this.#recordDomainEvent("agent.started", task, { progress: task.progress });

    try {
      const handler = this.#handlers[task.type];
      if (!handler) throw new Error(`No handler registered for ${task.type}`);
      task = await this.#transition(task, ["running"], {
        progress: 65,
        leaseExpiresAt: new Date(Date.now() + this.#leaseMs).toISOString(),
      }, "task.progress");
      if (!task) return;
      if (task.parsedInput?.raw_input) {
        await this.#recordDomainEvent("command_parsed", task, {
          command: task.parsedInput.command,
          category: task.parsedInput.category,
          parsed_by: task.parsedInput.parsed_by,
        });
      }
      const pendingDomainEvents = [];
      const result = await handler(task.input, {
        taskId,
        requestId: task.requestId,
        executionMode: task.executionMode,
        conversationId: task.conversationId || task.parsedInput?.conversation_id || null,
        userId: this.#actorId(task),
        channel: task.channel || task.parsedInput?.channel || null,
        emitEvent: (type, payload = {}) => {
          const recorded = this.#recordDomainEvent(type, task, payload);
          pendingDomainEvents.push(recorded);
          return recorded;
        },
      });
      await Promise.all(pendingDomainEvents);
      if (result?.card) await this.#recordDomainEvent("agent.card", task, { card: result.card });
      const completedAt = new Date().toISOString();
      task = await this.#transition(task, ["running"], {
        status: "succeeded",
        progress: 100,
        result,
        updatedAt: completedAt,
        completedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
      }, "task.completed");
      if (!task) return;
      await this.#recordDomainEvent("agent.completed", task, { progress: 100, result });
    } catch (error) {
      const latest = await this.#repository.get(taskId);
      if (!latest || latest.status !== "running") return;
      const completedAt = new Date().toISOString();
      task = await this.#transition(latest, ["running"], {
        status: "failed",
        progress: 100,
        failure: {
          code: "AGENT_TASK_FAILED",
          message: error instanceof Error ? error.message : "The agent task failed",
        },
        updatedAt: completedAt,
        completedAt,
        leaseOwner: null,
        leaseExpiresAt: null,
      }, "task.failed");
      if (task) await this.#recordDomainEvent("agent.failed", task, { failure: task.failure });
    }
  }

  async #transition(current, expectedStatuses, patch, type) {
    if (patch.status && patch.status !== current.status) {
      assertTaskTransition(current.status, patch.status);
    }
    const preview = {
      ...current,
      ...structuredClone(patch),
      updatedAt: patch.updatedAt || new Date().toISOString(),
      stateVersion: (current.stateVersion || 1) + 1,
    };
    const event = this.#taskEvent(type, preview);
    if (this.#repository.transition) {
      const transitioned = await this.#repository.transition(current.taskId, {
        expectedStatuses,
        expectedVersion: current.stateVersion || 1,
        patch: { ...patch, updatedAt: preview.updatedAt },
        event,
      });
      if (!transitioned?.task) return null;
      const persistedEvent = transitioned.event
        ? { ...event, ...transitioned.event, task: this.publicTask(transitioned.task, { includeResult: type === "task.completed" }) }
        : event;
      this.#publish(persistedEvent);
      return transitioned.task;
    }
    const task = await this.#repository.update(current.taskId, patch);
    if (!task) return null;
    await this.#persistAndPublish({ ...event, task: this.publicTask(task, { includeResult: type === "task.completed" }) });
    return task;
  }

  async #recordTaskEvent(type, task) {
    return this.#persistAndPublish(this.#taskEvent(type, task));
  }

  #taskEvent(type, task) {
    return {
      eventId: randomUUID(),
      type,
      taskId: task.taskId,
      aggregateType: "task",
      aggregateId: task.taskId,
      traceId: task.requestId || task.taskId,
      task: this.publicTask(task, { includeResult: type === "task.completed" }),
      createdAt: new Date().toISOString(),
    };
  }

  async #recordDomainEvent(type, task, payload = {}) {
    if (!AGENT_DOMAIN_EVENTS.includes(type)) throw new Error(`Unsupported Agent domain event: ${type}`);
    return this.#persistAndPublish({
      eventId: randomUUID(),
      type,
      taskId: task.taskId,
      aggregateType: "task",
      aggregateId: task.taskId,
      traceId: task.requestId || task.taskId,
      data: {
        task_id: task.taskId,
        ...(task.parsedInput?.conversation_id ? { conversation_id: task.parsedInput.conversation_id } : {}),
        type: task.type,
        status: task.status,
        execution_mode: task.executionMode || "live",
        ...payload,
      },
      createdAt: new Date().toISOString(),
    });
  }

  async #persistAndPublish(event) {
    const persisted = this.#repository.appendEvent
      ? await this.#repository.appendEvent(event)
      : event;
    const normalized = { ...event, ...(persisted || {}) };
    this.#publish(normalized);
    return normalized;
  }

  #actorId(task) {
    return task.actorId
      || task.parsedInput?.user_id
      || task.input?.context?.userId
      || task.input?.context?.user_id
      || null;
  }

  #publish(event) {
    const taskId = event.taskId || event.data?.task_id || event.task?.taskId;
    if (taskId) {
      if (!this.#eventHistory.has(taskId) && this.#eventHistory.size >= MAX_REPLAY_TASKS) {
        this.#eventHistory.delete(this.#eventHistory.keys().next().value);
      }
      const history = this.#eventHistory.get(taskId) || [];
      if (!history.some((item) => item.eventId === event.eventId)) {
        history.push(structuredClone(event));
      }
      if (history.length > MAX_REPLAY_EVENTS_PER_TASK) {
        history.splice(0, history.length - MAX_REPLAY_EVENTS_PER_TASK);
      }
      this.#eventHistory.set(taskId, history);
    }
    this.emit("taskEvent", event);
  }
}
