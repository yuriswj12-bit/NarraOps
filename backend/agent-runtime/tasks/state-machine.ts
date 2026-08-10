import type { AgentTaskStatus } from "../contracts/task.ts";

const TRANSITIONS: Readonly<Record<AgentTaskStatus, ReadonlySet<AgentTaskStatus>>> = {
  queued: new Set(["running", "failed", "cancelled", "expired"]),
  running: new Set([
    "waiting_input",
    "waiting_approval",
    "executing",
    "reconciliation_required",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
  ]),
  waiting_input: new Set(["queued", "cancelled", "expired"]),
  waiting_approval: new Set(["queued", "executing", "cancelled", "expired"]),
  executing: new Set(["reconciliation_required", "succeeded", "failed", "expired"]),
  reconciliation_required: new Set(["succeeded", "failed", "expired"]),
  succeeded: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  expired: new Set(),
};

export const TERMINAL_TASK_STATUSES: ReadonlySet<AgentTaskStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
]);

export class InvalidTaskTransitionError extends Error {
  readonly code = "INVALID_TASK_TRANSITION";

  constructor(from: string, to: string) {
    super(`Agent task cannot transition from ${from} to ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}

export function canTransitionTask(from: AgentTaskStatus, to: AgentTaskStatus): boolean {
  return from === to || Boolean(TRANSITIONS[from]?.has(to));
}

export function assertTaskTransition(from: AgentTaskStatus, to: AgentTaskStatus): void {
  if (!canTransitionTask(from, to)) throw new InvalidTaskTransitionError(from, to);
}

export function isTerminalTaskStatus(status: string): boolean {
  return TERMINAL_TASK_STATUSES.has(status as AgentTaskStatus);
}
