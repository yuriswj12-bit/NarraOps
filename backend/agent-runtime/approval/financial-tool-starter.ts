import { randomUUID } from "node:crypto";
import type {
  AgentClient,
  ApprovalRecord,
  FinancialToolStartRecord,
  FinancialToolStartResult,
  JsonObject,
  ResourceVersionRef,
  ToolApprovalPolicy,
} from "../contracts/index.ts";
import {
  assertSafeApprovalParameters,
  executionIntentDigest,
} from "./shadow-recorder.ts";

const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 30 * 60_000;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;

export class FinancialToolStartError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "FinancialToolStartError";
  }
}

export interface FinancialToolStartRepository {
  begin(record: FinancialToolStartRecord): Promise<FinancialToolStartResult>;
}

export class FinancialToolStarter {
  constructor(
    private readonly repository: FinancialToolStartRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async begin(input: {
    actorId: string;
    client: AgentClient;
    capability: string;
    taskType: string;
    toolName: string;
    toolVersion: string;
    action: string;
    resourceType: string;
    resourceId: string;
    safeInput: JsonObject;
    approvalParameters: JsonObject;
    contextRefs?: ResourceVersionRef[];
    policy: Exclude<ToolApprovalPolicy, "none">;
    idempotencyKey: string;
    traceId: string;
    ttlMs?: number;
  }): Promise<FinancialToolStartResult> {
    for (const [field, value] of Object.entries({
      actorId: input.actorId,
      client: input.client,
      capability: input.capability,
      taskType: input.taskType,
      toolName: input.toolName,
      toolVersion: input.toolVersion,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      traceId: input.traceId,
    })) {
      if (!String(value || "").trim()) {
        throw new FinancialToolStartError(
          "FINANCIAL_TOOL_START_INVALID",
          `${field} is required`,
        );
      }
    }
    if (!/^[a-z][a-z0-9_.-]{2,100}$/.test(input.action)) {
      throw new FinancialToolStartError(
        "FINANCIAL_TOOL_ACTION_INVALID",
        "Financial tool action is invalid",
      );
    }
    if (!KEY_PATTERN.test(input.idempotencyKey)) {
      throw new FinancialToolStartError(
        "FINANCIAL_TOOL_IDEMPOTENCY_KEY_INVALID",
        "Financial tool idempotency key is invalid",
      );
    }
    assertSafeApprovalParameters(input.safeInput);
    assertSafeApprovalParameters(input.approvalParameters);
    if (
      Buffer.byteLength(JSON.stringify(input.safeInput), "utf8") > 64 * 1024
      || Buffer.byteLength(JSON.stringify(input.approvalParameters), "utf8") > 64 * 1024
    ) {
      throw new FinancialToolStartError(
        "FINANCIAL_TOOL_INPUT_TOO_LARGE",
        "Financial tool safe input exceeds the 64KB limit",
      );
    }

    const now = this.now();
    const createdAt = now.toISOString();
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, input.ttlMs || 10 * 60_000));
    const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    const taskId = randomUUID();
    const toolCallId = randomUUID();
    const intentDigest = executionIntentDigest({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      parameters: input.approvalParameters,
    });
    const approval: ApprovalRecord = {
      schemaVersion: "agent.approval.v1",
      approvalId: randomUUID(),
      intent: {
        schemaVersion: "agent.execution_intent.v1",
        intentId: randomUUID(),
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        parameters: structuredClone(input.approvalParameters),
        intentDigest,
        risk: "financial_irreversible",
        status: "requested",
        createdAt,
        expiresAt,
      },
      actorId: input.actorId,
      taskId,
      toolCallId,
      status: "requested",
      policy: input.policy,
      idempotencyKey: `${input.idempotencyKey}:approval`,
      stateVersion: 1,
      requestedAt: createdAt,
      expiresAt,
    };
    return this.repository.begin({
      schemaVersion: "agent.financial_tool_start.v1",
      taskId,
      toolCallId,
      eventId: randomUUID(),
      actorId: input.actorId,
      client: input.client,
      capability: input.capability,
      taskType: input.taskType,
      taskStatus: "waiting_approval",
      toolName: input.toolName,
      toolVersion: input.toolVersion,
      toolStatus: "waiting_approval",
      risk: "financial_irreversible",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      safeInput: structuredClone(input.safeInput),
      inputDigest: intentDigest,
      contextRefs: structuredClone(input.contextRefs || []),
      idempotencyKey: input.idempotencyKey,
      toolIdempotencyKey: `${input.idempotencyKey}:tool`,
      traceId: input.traceId,
      createdAt,
      approval,
    });
  }
}

export class InMemoryFinancialToolStartRepository
implements FinancialToolStartRepository {
  readonly records: FinancialToolStartRecord[] = [];
  readonly #keys = new Map<string, FinancialToolStartResult>();

  async begin(record: FinancialToolStartRecord): Promise<FinancialToolStartResult> {
    const scope = `${record.actorId}:${record.idempotencyKey}`;
    const existing = this.#keys.get(scope);
    if (existing) {
      if (existing.approval.intent.intentDigest !== record.approval.intent.intentDigest) {
        throw new FinancialToolStartError(
          "FINANCIAL_TOOL_IDEMPOTENCY_CONFLICT",
          "Financial tool key was reused with different parameters",
        );
      }
      return structuredClone({ ...existing, idempotentReplay: true });
    }
    const result: FinancialToolStartResult = {
      taskId: record.taskId,
      toolCallId: record.toolCallId,
      approval: structuredClone(record.approval),
      taskStateVersion: 1,
      idempotentReplay: false,
    };
    this.records.push(structuredClone(record));
    this.#keys.set(scope, structuredClone(result));
    return result;
  }
}
