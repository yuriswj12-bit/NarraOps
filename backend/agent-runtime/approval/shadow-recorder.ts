import { createHash, randomUUID } from "node:crypto";
import type {
  ApprovalShadowRecord,
  ApprovalShadowStatus,
  ExecutionIntent,
  JsonObject,
} from "../contracts/index.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

const SECRET_KEY = /^(authorization|cookie|api[_-]?key|private[_-]?key|secret|mnemonic|seed(?:[_-]?phrase)?|access[_-]?token|refresh[_-]?token|signed[_-]?transaction(?:base64)?)$/i;

export function assertSafeApprovalParameters(value: unknown, path = "parameters"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeApprovalParameters(item, `${path}[${index}]`));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      throw new Error(`Approval parameters cannot contain secret-shaped field ${path}.${key}`);
    }
    assertSafeApprovalParameters(item, `${path}.${key}`);
  }
}

export function executionIntentDigest(input: {
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  parameters: JsonObject;
}): string {
  return createHash("sha256").update(canonical({
    schemaVersion: "agent.execution_intent.v1",
    actorId: input.actorId,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    parameters: input.parameters,
  })).digest("hex");
}

export interface ApprovalShadowRepository {
  create(record: ApprovalShadowRecord): Promise<ApprovalShadowRecord>;
}

export class ApprovalShadowRecorder {
  constructor(private readonly repository: ApprovalShadowRepository) {}

  async record(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    parameters: JsonObject;
    status?: ApprovalShadowStatus;
    legacyConfirmationKind: string;
    legacyRequestId?: string;
    ttlMs?: number;
  }): Promise<ApprovalShadowRecord> {
    if (!input.actorId || !input.action || !input.resourceType || !input.resourceId) {
      throw new Error("Approval shadow records require actor, action, and resource identity");
    }
    assertSafeApprovalParameters(input.parameters);
    if (Buffer.byteLength(canonical(input.parameters), "utf8") > 64 * 1024) {
      throw new Error("Approval shadow parameters exceed the 64KB safety limit");
    }
    const now = new Date();
    const status = input.status || "approved";
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
      status,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + Math.max(60_000, input.ttlMs || 15 * 60_000)).toISOString(),
    };
    return this.repository.create({
      schemaVersion: "agent.approval_shadow.v1",
      approvalId: randomUUID(),
      intent,
      actorId: input.actorId,
      status,
      legacyConfirmationKind: input.legacyConfirmationKind,
      legacyRequestId: input.legacyRequestId,
      recordedAt: now.toISOString(),
    });
  }
}

export class InMemoryApprovalShadowRepository implements ApprovalShadowRepository {
  readonly records: ApprovalShadowRecord[] = [];

  async create(record: ApprovalShadowRecord): Promise<ApprovalShadowRecord> {
    const existing = this.records.find((item) =>
      item.actorId === record.actorId
      && item.intent.intentDigest === record.intent.intentDigest
      && item.status === record.status);
    if (existing) return structuredClone(existing);
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }
}
