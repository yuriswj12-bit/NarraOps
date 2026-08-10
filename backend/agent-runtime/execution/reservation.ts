import { createHash, randomUUID } from "node:crypto";
import type {
  ApprovalRecord,
  ApprovedExecutionEnvelope,
  ExecutionReservation,
  ExecutionTransition,
  WalletSignatureConfirmation,
} from "../contracts/index.ts";
import {
  assertExecutionTransition,
  ExecutionTransitionError,
} from "./state-machine.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

export function executionReservationFingerprint(input: {
  actorId: string;
  taskId: string;
  toolCallId: string;
  approvalId: string;
  intentId: string;
  intentDigest: string;
  action: string;
  resourceType: string;
  resourceId: string;
  provider?: string;
  chain?: string;
}): string {
  return createHash("sha256").update(canonical(input)).digest("hex");
}

export class ExecutionReservationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ExecutionReservationError";
  }
}

export interface ExecutionReservationRepository {
  consumeApprovalAndReserve(input: {
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    reservation: ExecutionReservation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean } | null>;
  consumeWalletSignatureAndReserve(input: {
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    confirmation: WalletSignatureConfirmation;
    reservation: ExecutionReservation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean } | null>;
  get(executionId: string): Promise<ExecutionReservation | null>;
  bindSemanticEnvelope(input: {
    executionId: string;
    actorId: string;
    expectedStateVersion: number;
    envelope: ApprovedExecutionEnvelope;
    verifiedAt: string;
  }): Promise<ExecutionReservation | null>;
  transition(input: ExecutionTransition & {
    transitionedAt: string;
  }): Promise<ExecutionReservation | null>;
}

export class ExecutionReservationService {
  constructor(
    private readonly repository: ExecutionReservationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(input: {
    executionId?: string;
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    idempotencyKey: string;
    provider?: string;
    chain?: string;
    walletSignatureConfirmation?: WalletSignatureConfirmation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean }> {
    if (
      !input.approvalId
      || !input.actorId
      || !input.intentId
      || !input.intentDigest
      || !input.taskId
      || !input.toolCallId
      || !input.action
      || !input.resourceType
      || !input.resourceId
    ) {
      throw new ExecutionReservationError(
        "EXECUTION_RESERVATION_INVALID",
        "Execution reservation identity is incomplete",
      );
    }
    if (!/^[a-f0-9]{64}$/.test(input.intentDigest)) {
      throw new ExecutionReservationError(
        "EXECUTION_INTENT_DIGEST_INVALID",
        "Execution intent digest is invalid",
      );
    }
    if (
      input.executionId
      && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(input.executionId)
    ) {
      throw new ExecutionReservationError(
        "EXECUTION_ID_INVALID",
        "Execution identity is invalid",
      );
    }
    if (!/^[A-Za-z0-9._:-]{8,255}$/.test(input.idempotencyKey)) {
      throw new ExecutionReservationError(
        "EXECUTION_IDEMPOTENCY_KEY_INVALID",
        "Execution idempotency key is invalid",
      );
    }
    if (!Number.isInteger(input.approvalExpectedStateVersion) || input.approvalExpectedStateVersion < 1) {
      throw new ExecutionReservationError(
        "EXECUTION_APPROVAL_VERSION_INVALID",
        "Approval state version is invalid",
      );
    }
    if (!Number.isInteger(input.taskExpectedStateVersion) || input.taskExpectedStateVersion < 1) {
      throw new ExecutionReservationError(
        "EXECUTION_TASK_VERSION_INVALID",
        "Task state version is invalid",
      );
    }
    if (
      input.walletSignatureConfirmation
      && (
        input.walletSignatureConfirmation.schemaVersion
          !== "agent.wallet_signature_confirmation.v1"
        || !/^[a-f0-9]{64}$/.test(input.walletSignatureConfirmation.messageHash)
        || !/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(
          input.walletSignatureConfirmation.txSignature,
        )
        || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(
          input.walletSignatureConfirmation.signer,
        )
        || !Number.isFinite(Date.parse(input.walletSignatureConfirmation.verifiedAt))
      )
    ) {
      throw new ExecutionReservationError(
        "EXECUTION_WALLET_CONFIRMATION_INVALID",
        "Wallet-signature confirmation evidence is invalid",
      );
    }

    const now = this.now().toISOString();
    const fingerprint = executionReservationFingerprint(input);
    const reservation: ExecutionReservation = {
      schemaVersion: "agent.execution.v1",
      executionId: input.executionId || randomUUID(),
      taskId: input.taskId,
      toolCallId: input.toolCallId,
      approvalId: input.approvalId,
      intentId: input.intentId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      intentDigest: input.intentDigest,
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: fingerprint,
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.chain ? { chain: input.chain } : {}),
      status: "reserved",
      stateVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const persistenceInput = {
      ...input,
      reservation,
    };
    const persisted = input.walletSignatureConfirmation
      ? await this.repository.consumeWalletSignatureAndReserve({
        ...persistenceInput,
        confirmation: input.walletSignatureConfirmation,
      })
      : await this.repository.consumeApprovalAndReserve(persistenceInput);
    if (!persisted) {
      throw new ExecutionReservationError(
        "EXECUTION_APPROVAL_CONSUME_CONFLICT",
        "Approval could not be atomically consumed for this execution",
      );
    }
    return persisted;
  }
}

export class InMemoryExecutionReservationRepository implements ExecutionReservationRepository {
  readonly #approvals = new Map<string, ApprovalRecord>();
  readonly #executions = new Map<string, ExecutionReservation>();
  readonly #idempotency = new Map<string, string>();

  seedApproval(record: ApprovalRecord): void {
    this.#approvals.set(record.approvalId, structuredClone(record));
  }

  approval(approvalId: string): ApprovalRecord | null {
    const record = this.#approvals.get(approvalId);
    return record ? structuredClone(record) : null;
  }

  async consumeApprovalAndReserve(input: {
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    reservation: ExecutionReservation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean } | null> {
    const scope = `${input.actorId}:${input.reservation.idempotencyKey}`;
    const existingId = this.#idempotency.get(scope);
    if (existingId) {
      const existing = this.#executions.get(existingId);
      if (
        !existing
        || existing.requestFingerprint !== input.reservation.requestFingerprint
        || existing.approvalId !== input.approvalId
      ) {
        throw new ExecutionReservationError(
          "EXECUTION_IDEMPOTENCY_CONFLICT",
          "Execution idempotency key was used with a different reservation",
        );
      }
      return { reservation: structuredClone(existing), idempotentReplay: true };
    }

    const approval = this.#approvals.get(input.approvalId);
    if (
      !approval
      || approval.status !== "approved"
      || approval.actorId !== input.actorId
      || approval.intent.actorId !== input.actorId
      || approval.intent.intentDigest !== input.intentDigest
      || approval.taskId !== input.taskId
      || approval.toolCallId !== input.toolCallId
      || approval.stateVersion !== input.approvalExpectedStateVersion
      || Date.parse(approval.expiresAt) <= Date.now()
    ) return null;

    this.#approvals.set(approval.approvalId, {
      ...approval,
      status: "consumed",
      intent: { ...approval.intent, status: "consumed" },
      stateVersion: approval.stateVersion + 1,
      consumedAt: input.reservation.createdAt,
    });
    this.#executions.set(input.reservation.executionId, structuredClone(input.reservation));
    this.#idempotency.set(scope, input.reservation.executionId);
    return { reservation: structuredClone(input.reservation), idempotentReplay: false };
  }

  async consumeWalletSignatureAndReserve(input: {
    approvalId: string;
    approvalExpectedStateVersion: number;
    taskExpectedStateVersion: number;
    actorId: string;
    intentDigest: string;
    taskId: string;
    toolCallId: string;
    confirmation: WalletSignatureConfirmation;
    reservation: ExecutionReservation;
  }): Promise<{ reservation: ExecutionReservation; idempotentReplay: boolean } | null> {
    const scope = `${input.actorId}:${input.reservation.idempotencyKey}`;
    if (this.#idempotency.has(scope)) {
      return this.consumeApprovalAndReserve(input);
    }
    const approval = this.#approvals.get(input.approvalId);
    if (
      !approval
      || approval.status !== "requested"
      || approval.stateVersion !== input.approvalExpectedStateVersion
      || approval.intent.parameters.message_hash !== input.confirmation.messageHash
      || approval.intent.parameters.fee_payer !== input.confirmation.signer
    ) return null;
    this.#approvals.set(approval.approvalId, {
      ...approval,
      status: "approved",
      intent: { ...approval.intent, status: "approved" },
      stateVersion: approval.stateVersion + 1,
      decidedAt: input.confirmation.verifiedAt,
    });
    return this.consumeApprovalAndReserve({
      ...input,
      approvalExpectedStateVersion: input.approvalExpectedStateVersion + 1,
    });
  }

  async get(executionId: string): Promise<ExecutionReservation | null> {
    const record = this.#executions.get(executionId);
    return record ? structuredClone(record) : null;
  }

  async bindSemanticEnvelope(input: {
    executionId: string;
    actorId: string;
    expectedStateVersion: number;
    envelope: ApprovedExecutionEnvelope;
    verifiedAt: string;
  }): Promise<ExecutionReservation | null> {
    const current = this.#executions.get(input.executionId);
    if (
      !current
      || current.actorId !== input.actorId
      || current.status !== "reserved"
      || current.stateVersion !== input.expectedStateVersion
      || current.semanticEnvelope
    ) return null;
    const next: ExecutionReservation = {
      ...current,
      semanticEnvelope: structuredClone(input.envelope),
      semanticsVerifiedAt: input.verifiedAt,
      stateVersion: current.stateVersion + 1,
      updatedAt: input.verifiedAt,
    };
    this.#executions.set(input.executionId, structuredClone(next));
    return structuredClone(next);
  }

  async transition(input: ExecutionTransition & {
    transitionedAt: string;
  }): Promise<ExecutionReservation | null> {
    const current = this.#executions.get(input.executionId);
    if (
      !current
      || current.actorId !== input.actorId
      || current.status !== input.expectedStatus
      || current.stateVersion !== input.expectedStateVersion
    ) return null;

    assertExecutionTransition(current.status, input.status);
    const txHash = input.txHash || current.txHash;
    if (
      (input.status === "submitted"
        || input.status === "reconciliation_required"
        || input.status === "confirmed")
      && !txHash
    ) {
      throw new ExecutionTransitionError(
        "EXECUTION_TX_HASH_REQUIRED",
        `${input.status} requires a persisted transaction hash or signature`,
      );
    }
    if (input.status === "submitted" && !current.semanticEnvelope) {
      throw new ExecutionTransitionError(
        "EXECUTION_SEMANTICS_REQUIRED",
        "Submitted execution requires a durably verified semantic envelope",
      );
    }
    if (current.txHash && input.txHash && current.txHash !== input.txHash) {
      throw new ExecutionTransitionError(
        "EXECUTION_TX_HASH_IMMUTABLE",
        "Execution transaction hash or signature cannot be replaced",
      );
    }
    if (input.status === "failed" && !input.failure?.code) {
      throw new ExecutionTransitionError(
        "EXECUTION_FAILURE_REQUIRED",
        "Failed execution requires a stable failure code",
      );
    }

    const terminal = input.status === "confirmed"
      || input.status === "failed"
      || input.status === "cancelled";
    const next: ExecutionReservation = {
      ...current,
      status: input.status,
      stateVersion: current.stateVersion + 1,
      ...(txHash ? { txHash } : {}),
      ...(input.failure ? { failure: structuredClone(input.failure) } : {}),
      updatedAt: input.transitionedAt,
      ...(input.status === "submitted" && !current.submittedAt
        ? { submittedAt: input.transitionedAt }
        : {}),
      ...(terminal ? { completedAt: input.transitionedAt } : {}),
    };
    this.#executions.set(input.executionId, structuredClone(next));
    return structuredClone(next);
  }
}
