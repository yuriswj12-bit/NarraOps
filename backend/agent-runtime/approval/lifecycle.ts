import { randomUUID } from "node:crypto";
import type {
  ApprovalRecord,
  ConsumedApproval,
  ExecutionIntent,
  JsonObject,
  ToolApprovalPolicy,
} from "../contracts/index.ts";
import {
  assertSafeApprovalParameters,
  executionIntentDigest,
} from "./shadow-recorder.ts";

const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 30 * 60_000;
const RECENT_AUTH_WINDOW_MS = 5 * 60_000;

export class ApprovalLifecycleError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApprovalLifecycleError";
  }
}

export interface ApprovalLifecycleRepository {
  create(record: ApprovalRecord): Promise<ApprovalRecord>;
  get(approvalId: string): Promise<ApprovalRecord | null>;
  decide(input: {
    approvalId: string;
    actorId: string;
    decision: "approved" | "rejected";
    decidedAt: string;
    recentAuthAt?: string;
    expectedStateVersion: number;
  }): Promise<ApprovalRecord | null>;
  consume(input: {
    approvalId: string;
    actorId: string;
    intentDigest: string;
    consumedAt: string;
    expectedStateVersion: number;
  }): Promise<ApprovalRecord | null>;
}

export class ApprovalLifecycle {
  constructor(
    private readonly repository: ApprovalLifecycleRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(approvalId: string, actorId: string): Promise<ApprovalRecord | null> {
    const record = await this.repository.get(approvalId);
    if (!record) return null;
    this.assertActor(record, actorId);
    return record;
  }

  async request(input: {
    actorId: string;
    taskId: string;
    toolCallId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    parameters: JsonObject;
    policy: Exclude<ToolApprovalPolicy, "none">;
    idempotencyKey: string;
    ttlMs?: number;
  }): Promise<ApprovalRecord> {
    if (
      !input.actorId
      || !input.taskId
      || !input.toolCallId
      || !input.action
      || !input.resourceType
      || !input.resourceId
    ) {
      throw new ApprovalLifecycleError(
        "APPROVAL_INTENT_INVALID",
        "Approval requests require actor, task, tool call, action, and resource identity",
      );
    }
    if (!/^[a-z][a-z0-9_.-]{2,100}$/.test(input.action)) {
      throw new ApprovalLifecycleError("APPROVAL_INTENT_INVALID", "Approval action is invalid");
    }
    if (!/^[A-Za-z0-9._:-]{8,255}$/.test(input.idempotencyKey)) {
      throw new ApprovalLifecycleError(
        "APPROVAL_IDEMPOTENCY_KEY_INVALID",
        "Approval idempotency key is invalid",
      );
    }
    assertSafeApprovalParameters(input.parameters);
    const encodedParameters = JSON.stringify(input.parameters);
    if (Buffer.byteLength(encodedParameters, "utf8") > 64 * 1024) {
      throw new ApprovalLifecycleError(
        "APPROVAL_INTENT_TOO_LARGE",
        "Approval parameters exceed the 64KB safety limit",
      );
    }

    const now = this.now();
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, input.ttlMs || 15 * 60_000));
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const intent: ExecutionIntent = {
      schemaVersion: "agent.execution_intent.v1",
      intentId: randomUUID(),
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      parameters: structuredClone(input.parameters),
      intentDigest: executionIntentDigest(input),
      risk: "financial_irreversible",
      status: "requested",
      createdAt: now.toISOString(),
      expiresAt,
    };
    return this.repository.create({
      schemaVersion: "agent.approval.v1",
      approvalId: randomUUID(),
      intent,
      actorId: input.actorId,
      taskId: input.taskId,
      toolCallId: input.toolCallId,
      status: "requested",
      policy: input.policy,
      idempotencyKey: input.idempotencyKey,
      stateVersion: 1,
      requestedAt: now.toISOString(),
      expiresAt,
    });
  }

  async decide(input: {
    approvalId: string;
    actorId: string;
    decision: "approved" | "rejected";
    expectedStateVersion: number;
    recentAuthAt?: string;
  }): Promise<ApprovalRecord> {
    const current = await this.required(input.approvalId);
    this.assertActor(current, input.actorId);
    this.assertUnexpired(current);
    if (current.status !== "requested") {
      throw new ApprovalLifecycleError(
        "APPROVAL_STATE_CONFLICT",
        `Approval cannot be decided from ${current.status}`,
      );
    }
    if (current.stateVersion !== input.expectedStateVersion) {
      throw new ApprovalLifecycleError("APPROVAL_VERSION_CONFLICT", "Approval state changed");
    }
    if (input.decision === "approved" && current.policy === "explicit_and_recent_auth") {
      this.assertRecentAuth(input.recentAuthAt);
    }
    const decided = await this.repository.decide({
      ...input,
      decidedAt: this.now().toISOString(),
    });
    if (!decided) {
      throw new ApprovalLifecycleError("APPROVAL_VERSION_CONFLICT", "Approval state changed");
    }
    if (decided.status === "expired") {
      throw new ApprovalLifecycleError("APPROVAL_EXPIRED", "Approval has expired");
    }
    if (decided.status !== input.decision) {
      throw new ApprovalLifecycleError("APPROVAL_STATE_CONFLICT", "Approval decision was not persisted");
    }
    return decided;
  }

  async consume(input: {
    approvalId: string;
    actorId: string;
    intentDigest: string;
    expectedStateVersion: number;
  }): Promise<ConsumedApproval> {
    const current = await this.required(input.approvalId);
    this.assertActor(current, input.actorId);
    this.assertUnexpired(current);
    if (current.status !== "approved") {
      throw new ApprovalLifecycleError(
        current.status === "consumed" ? "APPROVAL_ALREADY_CONSUMED" : "APPROVAL_NOT_APPROVED",
        `Approval cannot be consumed from ${current.status}`,
      );
    }
    if (current.intent.intentDigest !== input.intentDigest) {
      throw new ApprovalLifecycleError(
        "APPROVAL_INTENT_MISMATCH",
        "Approval does not match the exact execution intent",
      );
    }
    if (current.stateVersion !== input.expectedStateVersion) {
      throw new ApprovalLifecycleError("APPROVAL_VERSION_CONFLICT", "Approval state changed");
    }
    const consumed = await this.repository.consume({
      ...input,
      consumedAt: this.now().toISOString(),
    });
    if (!consumed) {
      throw new ApprovalLifecycleError("APPROVAL_VERSION_CONFLICT", "Approval state changed");
    }
    if (consumed.status === "expired") {
      throw new ApprovalLifecycleError("APPROVAL_EXPIRED", "Approval has expired");
    }
    if (consumed.status !== "consumed") {
      throw new ApprovalLifecycleError("APPROVAL_STATE_CONFLICT", "Approval was not consumed");
    }
    return {
      approvalId: consumed.approvalId,
      actorId: consumed.actorId,
      intentDigest: consumed.intent.intentDigest,
      status: "consumed",
      expiresAt: consumed.expiresAt,
      ...(consumed.recentAuthAt ? { recentAuthAt: consumed.recentAuthAt } : {}),
    };
  }

  private async required(approvalId: string): Promise<ApprovalRecord> {
    const record = await this.repository.get(approvalId);
    if (!record) {
      throw new ApprovalLifecycleError("APPROVAL_NOT_FOUND", "Approval was not found");
    }
    return record;
  }

  private assertActor(record: ApprovalRecord, actorId: string): void {
    if (record.actorId !== actorId || record.intent.actorId !== actorId) {
      throw new ApprovalLifecycleError(
        "APPROVAL_ACTOR_MISMATCH",
        "Approval actor does not match the authenticated actor",
      );
    }
  }

  private assertUnexpired(record: ApprovalRecord): void {
    if (Date.parse(record.expiresAt) <= this.now().getTime()) {
      throw new ApprovalLifecycleError("APPROVAL_EXPIRED", "Approval has expired");
    }
  }

  private assertRecentAuth(recentAuthAt?: string): void {
    const parsed = Date.parse(recentAuthAt || "");
    const age = this.now().getTime() - parsed;
    if (!Number.isFinite(parsed) || age < 0 || age > RECENT_AUTH_WINDOW_MS) {
      throw new ApprovalLifecycleError(
        "APPROVAL_RECENT_AUTH_REQUIRED",
        "Recent authentication is required",
      );
    }
  }
}

export class InMemoryApprovalLifecycleRepository implements ApprovalLifecycleRepository {
  readonly #records = new Map<string, ApprovalRecord>();
  readonly #idempotency = new Map<string, string>();

  async create(record: ApprovalRecord): Promise<ApprovalRecord> {
    const idempotencyScope = `${record.actorId}:${record.idempotencyKey}`;
    const existingId = this.#idempotency.get(idempotencyScope);
    if (existingId) {
      const existing = this.#records.get(existingId);
      if (existing?.intent.intentDigest !== record.intent.intentDigest) {
        throw new ApprovalLifecycleError(
          "APPROVAL_IDEMPOTENCY_CONFLICT",
          "Approval idempotency key was used with a different intent",
        );
      }
      if (existing) return structuredClone(existing);
    }
    if (this.#records.has(record.approvalId)) {
      throw new ApprovalLifecycleError("APPROVAL_ALREADY_EXISTS", "Approval already exists");
    }
    this.#records.set(record.approvalId, structuredClone(record));
    this.#idempotency.set(idempotencyScope, record.approvalId);
    return structuredClone(record);
  }

  async get(approvalId: string): Promise<ApprovalRecord | null> {
    const record = this.#records.get(approvalId);
    return record ? structuredClone(record) : null;
  }

  async decide(input: {
    approvalId: string;
    actorId: string;
    decision: "approved" | "rejected";
    decidedAt: string;
    recentAuthAt?: string;
    expectedStateVersion: number;
  }): Promise<ApprovalRecord | null> {
    const current = this.#records.get(input.approvalId);
    if (
      !current
      || current.actorId !== input.actorId
      || current.status !== "requested"
      || current.stateVersion !== input.expectedStateVersion
    ) return null;
    const next: ApprovalRecord = {
      ...current,
      status: input.decision,
      intent: { ...current.intent, status: input.decision },
      stateVersion: current.stateVersion + 1,
      decidedAt: input.decidedAt,
      ...(input.recentAuthAt ? { recentAuthAt: input.recentAuthAt } : {}),
    };
    this.#records.set(next.approvalId, structuredClone(next));
    return structuredClone(next);
  }

  async consume(input: {
    approvalId: string;
    actorId: string;
    intentDigest: string;
    consumedAt: string;
    expectedStateVersion: number;
  }): Promise<ApprovalRecord | null> {
    const current = this.#records.get(input.approvalId);
    if (
      !current
      || current.actorId !== input.actorId
      || current.status !== "approved"
      || current.intent.intentDigest !== input.intentDigest
      || current.stateVersion !== input.expectedStateVersion
    ) return null;
    const next: ApprovalRecord = {
      ...current,
      status: "consumed",
      intent: { ...current.intent, status: "consumed" },
      stateVersion: current.stateVersion + 1,
      consumedAt: input.consumedAt,
    };
    this.#records.set(next.approvalId, structuredClone(next));
    return structuredClone(next);
  }
}
