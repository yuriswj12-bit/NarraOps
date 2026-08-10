import { randomUUID } from "node:crypto";
import type {
  ApprovedExecutionEnvelope,
  ExecutionSemanticShadowRecord,
  TransactionInspection,
} from "../contracts/index.ts";
import { verifyExecutionSemantics } from "./semantic-verifier.ts";
import { SemanticVerificationError } from "./semantic-verifier.ts";

export interface SemanticShadowRepository {
  create(record: ExecutionSemanticShadowRecord): Promise<ExecutionSemanticShadowRecord>;
}

export class ExecutionSemanticShadowRecorder {
  constructor(
    private readonly repository: SemanticShadowRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    envelope: ApprovedExecutionEnvelope;
    inspections: TransactionInspection[];
  }): Promise<ExecutionSemanticShadowRecord> {
    if (
      !input.actorId
      || !input.action
      || !input.resourceType
      || !input.resourceId
      || input.envelope.actorId !== input.actorId
      || input.envelope.action !== input.action
    ) {
      throw new SemanticVerificationError(
        "SEMANTIC_SHADOW_IDENTITY_MISMATCH",
        "Semantic shadow identity is incomplete or inconsistent",
      );
    }
    verifyExecutionSemantics({
      envelope: input.envelope,
      inspections: input.inspections,
      binding: {
        executionId: input.envelope.executionId,
        actorId: input.actorId,
        intentDigest: input.envelope.intentDigest,
        action: input.action,
      },
      now: this.now(),
    });
    return this.repository.create({
      schemaVersion: "agent.semantic_shadow.v1",
      shadowId: randomUUID(),
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      envelope: structuredClone(input.envelope),
      inspections: structuredClone(input.inspections),
      shadowMode: true,
      recordedAt: this.now().toISOString(),
    });
  }
}

export class InMemorySemanticShadowRepository implements SemanticShadowRepository {
  readonly records: ExecutionSemanticShadowRecord[] = [];

  async create(
    record: ExecutionSemanticShadowRecord,
  ): Promise<ExecutionSemanticShadowRecord> {
    if (!record.shadowMode) throw new Error("Semantic shadow cannot authorize execution");
    const existing = this.records.find((candidate) =>
      candidate.actorId === record.actorId
      && candidate.action === record.action
      && candidate.resourceType === record.resourceType
      && candidate.resourceId === record.resourceId
      && candidate.envelope.envelopeDigest === record.envelope.envelopeDigest);
    if (existing) return structuredClone(existing);
    this.records.push(structuredClone(record));
    return structuredClone(record);
  }
}
