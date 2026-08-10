import type {
  ExecutionReservation,
} from "../contracts/index.ts";
import type {
  ExecutionReservationRepository,
} from "./reservation.ts";
import {
  ExecutionTransitionService,
  isTerminalExecutionStatus,
} from "./state-machine.ts";

export type ExecutionObservationStatus =
  | "not_found"
  | "pending"
  | "confirmed"
  | "failed"
  | "unknown";

export interface ExecutionObservation {
  txHash: string;
  status: ExecutionObservationStatus;
  observedAt: string;
  failure?: { code: string; message?: string };
}

export interface ExecutionObservationProvider {
  readonly name: string;
  observe(input: {
    execution: ExecutionReservation;
    signal?: AbortSignal;
  }): Promise<ExecutionObservation>;
}

export class ExecutionReconciliationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionReconciliationError";
  }
}

export class ExecutionReconciler {
  private readonly providers = new Map<string, ExecutionObservationProvider>();
  private readonly transitions: ExecutionTransitionService;

  constructor(
    private readonly repository: ExecutionReservationRepository,
    providers: readonly ExecutionObservationProvider[],
    now: () => Date = () => new Date(),
  ) {
    this.transitions = new ExecutionTransitionService(repository, now);
    for (const provider of providers) {
      if (!provider.name || this.providers.has(provider.name)) {
        throw new ExecutionReconciliationError(
          "EXECUTION_RECONCILER_PROVIDER_INVALID",
          `Execution observation provider is invalid or duplicated: ${provider.name || "<empty>"}`,
        );
      }
      this.providers.set(provider.name, provider);
    }
  }

  async reconcile(input: {
    executionId: string;
    actorId: string;
    signal?: AbortSignal;
  }): Promise<{
    execution: ExecutionReservation;
    observation: ExecutionObservation | null;
    changed: boolean;
  }> {
    let current = await this.repository.get(input.executionId);
    if (!current || current.actorId !== input.actorId) {
      throw new ExecutionReconciliationError(
        "EXECUTION_NOT_FOUND",
        "Execution was not found for this actor",
      );
    }
    if (isTerminalExecutionStatus(current.status)) {
      return { execution: current, observation: null, changed: false };
    }
    if (
      !["submission_pending", "submitted", "reconciliation_required"].includes(current.status)
      || !current.txHash
    ) {
      throw new ExecutionReconciliationError(
        "EXECUTION_NOT_RECONCILABLE",
        "Execution has no claimed transaction identity to reconcile",
      );
    }
    const provider = current.provider
      ? this.providers.get(current.provider)
      : undefined;
    if (!provider) {
      throw new ExecutionReconciliationError(
        "EXECUTION_RECONCILER_PROVIDER_UNAVAILABLE",
        `No observation provider is registered for ${current.provider || "<unbound>"}`,
      );
    }

    let observation: ExecutionObservation;
    try {
      observation = await provider.observe({
        execution: current,
        signal: input.signal,
      });
    } catch {
      observation = {
        txHash: current.txHash,
        status: "unknown",
        observedAt: new Date().toISOString(),
      };
    }
    if (observation.txHash !== current.txHash) {
      throw new ExecutionReconciliationError(
        "EXECUTION_OBSERVATION_IDENTITY_MISMATCH",
        "Observation provider returned a different transaction identity",
      );
    }

    let changed = false;
    const transition = async (
      status: "submitted" | "reconciliation_required" | "confirmed" | "failed",
      failure?: { code: string; message?: string },
    ) => {
      current = await this.transitions.transition({
        executionId: current.executionId,
        actorId: current.actorId,
        expectedStatus: current.status,
        expectedStateVersion: current.stateVersion,
        status,
        txHash: current.txHash,
        ...(failure ? { failure } : {}),
      });
      changed = true;
    };

    if (observation.status === "confirmed") {
      if (current.status === "submission_pending") await transition("submitted");
      if (current.status === "submitted" || current.status === "reconciliation_required") {
        await transition("confirmed");
      }
    } else if (observation.status === "failed") {
      await transition("failed", observation.failure || {
        code: "CHAIN_EXECUTION_FAILED",
      });
    } else if (observation.status === "pending") {
      if (current.status === "submission_pending") await transition("submitted");
    } else if (
      current.status === "submission_pending"
      || current.status === "submitted"
    ) {
      await transition("reconciliation_required");
    }

    return { execution: current, observation, changed };
  }
}
