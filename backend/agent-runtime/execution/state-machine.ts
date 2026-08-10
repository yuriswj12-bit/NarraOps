import type {
  ExecutionReservation,
  ExecutionStatus,
  ExecutionTransition,
} from "../contracts/index.ts";
import type { ExecutionReservationRepository } from "./reservation.ts";

const ALLOWED_EXECUTION_TRANSITIONS: Readonly<
  Record<ExecutionStatus, ReadonlySet<ExecutionStatus>>
> = {
  reserved: new Set(["submission_pending", "failed", "cancelled"]),
  submission_pending: new Set(["submitted", "reconciliation_required", "failed", "cancelled"]),
  submitted: new Set(["reconciliation_required", "confirmed", "failed"]),
  reconciliation_required: new Set(["confirmed", "failed"]),
  confirmed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export const TERMINAL_EXECUTION_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  "confirmed",
  "failed",
  "cancelled",
]);

export function isTerminalExecutionStatus(status: ExecutionStatus): boolean {
  return TERMINAL_EXECUTION_STATUSES.has(status);
}

export function canTransitionExecution(
  from: ExecutionStatus,
  to: ExecutionStatus,
): boolean {
  return ALLOWED_EXECUTION_TRANSITIONS[from].has(to);
}

export class ExecutionTransitionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionTransitionError";
  }
}

export function assertExecutionTransition(
  from: ExecutionStatus,
  to: ExecutionStatus,
): void {
  if (!canTransitionExecution(from, to)) {
    throw new ExecutionTransitionError(
      isTerminalExecutionStatus(from)
        ? "EXECUTION_TERMINAL_STATE"
        : "EXECUTION_TRANSITION_INVALID",
      `Invalid execution transition from ${from} to ${to}`,
    );
  }
}

export class ExecutionTransitionService {
  constructor(
    private readonly repository: ExecutionReservationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async transition(input: ExecutionTransition): Promise<ExecutionReservation> {
    if (!input.executionId || !input.actorId) {
      throw new ExecutionTransitionError(
        "EXECUTION_TRANSITION_IDENTITY_INVALID",
        "Execution transition identity is incomplete",
      );
    }
    if (!Number.isInteger(input.expectedStateVersion) || input.expectedStateVersion < 1) {
      throw new ExecutionTransitionError(
        "EXECUTION_TRANSITION_VERSION_INVALID",
        "Execution state version is invalid",
      );
    }
    assertExecutionTransition(input.expectedStatus, input.status);
    if (input.status === "failed" && !input.failure?.code) {
      throw new ExecutionTransitionError(
        "EXECUTION_FAILURE_REQUIRED",
        "Failed execution requires a stable failure code",
      );
    }
    if (input.status !== "failed" && input.failure) {
      throw new ExecutionTransitionError(
        "EXECUTION_FAILURE_INVALID",
        "Failure details are only valid for a failed execution",
      );
    }

    const current = await this.repository.get(input.executionId);
    if (!current || current.actorId !== input.actorId) {
      throw new ExecutionTransitionError(
        "EXECUTION_NOT_FOUND",
        "Execution was not found for this actor",
      );
    }
    if (
      current.status !== input.expectedStatus
      || current.stateVersion !== input.expectedStateVersion
    ) {
      throw new ExecutionTransitionError(
        "EXECUTION_STATE_CONFLICT",
        "Execution state changed before this transition",
      );
    }

    const txHash = input.txHash || current.txHash;
    if (
      (input.status === "submission_pending"
        || input.status === "submitted"
        || input.status === "reconciliation_required"
        || input.status === "confirmed")
      && !txHash
    ) {
      throw new ExecutionTransitionError(
        "EXECUTION_TX_HASH_REQUIRED",
        `${input.status} requires a persisted transaction hash or signature`,
      );
    }
    if (
      (input.status === "submission_pending" || input.status === "submitted")
      && !current.semanticEnvelope
    ) {
      throw new ExecutionTransitionError(
        "EXECUTION_SEMANTICS_REQUIRED",
        `${input.status} execution requires a durably verified semantic envelope`,
      );
    }
    if (current.txHash && input.txHash && current.txHash !== input.txHash) {
      throw new ExecutionTransitionError(
        "EXECUTION_TX_HASH_IMMUTABLE",
        "Execution transaction hash or signature cannot be replaced",
      );
    }
    const persisted = await this.repository.transition({
      ...input,
      ...(txHash ? { txHash } : {}),
      transitionedAt: this.now().toISOString(),
    });
    if (!persisted) {
      throw new ExecutionTransitionError(
        "EXECUTION_STATE_CONFLICT",
        "Execution state changed before this transition",
      );
    }
    return persisted;
  }
}
