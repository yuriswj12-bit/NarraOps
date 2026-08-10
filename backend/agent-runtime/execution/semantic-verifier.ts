import { createHash, timingSafeEqual } from "node:crypto";
import type {
  ApprovedExecutionEnvelope,
  ApprovedTransactionSemantics,
  ExecutionChainReference,
  ExecutionRecipient,
  TransactionInspection,
} from "../contracts/index.ts";
import type { ExecutionReservationRepository } from "./reservation.ts";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function safeDigestEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function normalizeAddress(value: string, chain: ExecutionChainReference): string {
  return chain.kind === "evm" ? value.toLowerCase() : value;
}

function assertAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      `${field} must be a canonical non-negative atomic amount`,
    );
  }
  return BigInt(value);
}

function assertHash(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      `${field} must be a lowercase SHA-256 digest`,
    );
  }
}

function assertTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      `${field} must be an ISO date-time`,
    );
  }
  return timestamp;
}

function assertChain(chain: ExecutionChainReference): void {
  if (!chain.network || !["solana", "evm"].includes(chain.kind)) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "Execution chain reference is invalid",
    );
  }
  if (
    (chain.kind === "evm"
      && (!Number.isSafeInteger(chain.chainId) || Number(chain.chainId) <= 0))
    || (chain.kind === "solana" && chain.chainId !== undefined)
  ) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "EVM requires a positive chainId and Solana must not define one",
    );
  }
}

function assertUnique(values: string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      `${field} contains duplicates`,
    );
  }
}

function recipientKey(
  recipient: ExecutionRecipient,
  chain: ExecutionChainReference,
): string {
  return `${normalizeAddress(recipient.address, chain)}:${recipient.assetId}`;
}

function assertRecipients(
  recipients: ExecutionRecipient[],
  chain: ExecutionChainReference,
  field: string,
): void {
  const keys = recipients.map((recipient) => {
    if (!recipient.address || !recipient.assetId) {
      throw new SemanticVerificationError(
        "EXECUTION_SEMANTICS_INVALID",
        `${field} contains an incomplete recipient`,
      );
    }
    assertAtomic(recipient.amountAtomic, `${field}.amountAtomic`);
    return recipientKey(recipient, chain);
  });
  assertUnique(keys, field);
}

function assertTransactionShape(
  transaction: ApprovedTransactionSemantics | TransactionInspection,
  chain: ExecutionChainReference,
): void {
  if (!transaction.transactionId || !transaction.signer) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "Transaction semantic identity is incomplete",
    );
  }
  assertHash(transaction.messageHash, "messageHash");
  assertAtomic(transaction.valueAtomic, "valueAtomic");
  assertUnique(transaction.programIds, "programIds");
  assertRecipients(transaction.recipients, chain, "recipients");
  if (transaction.operation) {
    if (
      transaction.operation.kind !== "pump.launch"
      || chain.kind !== "solana"
      || !transaction.operation.mintAddress
      || !transaction.operation.name
      || !transaction.operation.symbol
      || !transaction.operation.metadataUri
      || !transaction.operation.creator
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_SEMANTICS_INVALID",
        "Pump launch operation semantics are incomplete or on the wrong chain",
      );
    }
    assertAtomic(
      transaction.operation.developerBuyLamports,
      "operation.developerBuyLamports",
    );
  }
  if (
    !Number.isInteger(
      "maxSlippageBps" in transaction
        ? transaction.maxSlippageBps
        : transaction.slippageBps,
    )
  ) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "Slippage must be an integer",
    );
  }
  const slippage = "maxSlippageBps" in transaction
    ? transaction.maxSlippageBps
    : transaction.slippageBps;
  if (slippage < 0 || slippage > 10_000) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "Slippage must be between 0 and 10000 bps",
    );
  }

  if (chain.kind === "evm") {
    if (!transaction.destination || !transaction.dataHash || transaction.programIds.length) {
      throw new SemanticVerificationError(
        "EXECUTION_SEMANTICS_INVALID",
        "EVM semantics require destination/dataHash and no Solana program IDs",
      );
    }
    assertHash(transaction.dataHash, "dataHash");
  } else if (!transaction.programIds.length || transaction.destination || transaction.dataHash) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "Solana semantics require program IDs and no EVM destination/dataHash",
    );
  }
}

export class SemanticVerificationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SemanticVerificationError";
  }
}

export function executionEnvelopeDigest(
  envelope: Omit<ApprovedExecutionEnvelope, "envelopeDigest">,
): string {
  return digest(envelope);
}

export function verifyExecutionSemantics(input: {
  envelope: ApprovedExecutionEnvelope;
  inspections: TransactionInspection[];
  binding: {
    executionId: string;
    actorId: string;
    intentDigest: string;
    action: string;
  };
  now?: Date;
}): void {
  const { envelope, inspections, binding } = input;
  const now = input.now || new Date();
  assertChain(envelope.chain);
  assertHash(envelope.intentDigest, "intentDigest");
  assertHash(envelope.envelopeDigest, "envelopeDigest");
  const digestInput = { ...envelope } as ApprovedExecutionEnvelope;
  delete (digestInput as Partial<ApprovedExecutionEnvelope>).envelopeDigest;
  const calculated = executionEnvelopeDigest(
    digestInput as Omit<ApprovedExecutionEnvelope, "envelopeDigest">,
  );
  if (!safeDigestEqual(envelope.envelopeDigest, calculated)) {
    throw new SemanticVerificationError(
      "EXECUTION_ENVELOPE_DIGEST_MISMATCH",
      "Approved execution envelope digest does not match its contents",
    );
  }
  if (
    envelope.executionId !== binding.executionId
    || envelope.actorId !== binding.actorId
    || envelope.intentDigest !== binding.intentDigest
    || envelope.action !== binding.action
  ) {
    throw new SemanticVerificationError(
      "EXECUTION_ENVELOPE_BINDING_MISMATCH",
      "Approved execution envelope is not bound to this execution and intent",
    );
  }
  const createdAt = assertTimestamp(envelope.createdAt, "createdAt");
  const expiresAt = assertTimestamp(envelope.expiresAt, "expiresAt");
  if (createdAt > expiresAt || now.getTime() >= expiresAt) {
    throw new SemanticVerificationError(
      "EXECUTION_ENVELOPE_EXPIRED",
      "Approved execution envelope has expired",
    );
  }
  if (!envelope.transactions.length || envelope.transactions.length > 100) {
    throw new SemanticVerificationError(
      "EXECUTION_SEMANTICS_INVALID",
      "Execution envelope must contain 1 to 100 transactions",
    );
  }
  assertUnique(
    envelope.transactions.map(({ transactionId }) => transactionId),
    "transactions",
  );
  for (const transaction of envelope.transactions) {
    assertTransactionShape(transaction, envelope.chain);
    assertAtomic(transaction.maxFeeAtomic, "maxFeeAtomic");
    if (
      transaction.lastValidBlockHeight !== undefined
      && (!Number.isSafeInteger(transaction.lastValidBlockHeight)
        || transaction.lastValidBlockHeight < 0)
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_SEMANTICS_INVALID",
        "lastValidBlockHeight is invalid",
      );
    }
    if (transaction.validUntil) assertTimestamp(transaction.validUntil, "validUntil");
  }

  assertUnique(inspections.map(({ transactionId }) => transactionId), "inspections");
  if (
    inspections.length !== envelope.transactions.length
    || inspections.some(({ transactionId }) =>
      !envelope.transactions.some((approved) => approved.transactionId === transactionId))
  ) {
    throw new SemanticVerificationError(
      "EXECUTION_TRANSACTION_SET_MISMATCH",
      "Inspected transaction set differs from the approved envelope",
    );
  }

  for (const approved of envelope.transactions) {
    const actual = inspections.find(
      ({ transactionId }) => transactionId === approved.transactionId,
    )!;
    assertChain(actual.chain);
    assertTransactionShape(actual, actual.chain);
    if (actual.executionId !== envelope.executionId) {
      throw new SemanticVerificationError(
        "EXECUTION_ENVELOPE_BINDING_MISMATCH",
        "Transaction inspection is bound to a different execution",
      );
    }
    if (
      actual.chain.kind !== envelope.chain.kind
      || actual.chain.network !== envelope.chain.network
      || actual.chain.chainId !== envelope.chain.chainId
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_CHAIN_MISMATCH",
        "Inspected transaction chain differs from approval",
      );
    }
    if (
      normalizeAddress(actual.signer, envelope.chain)
      !== normalizeAddress(approved.signer, envelope.chain)
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_SIGNER_MISMATCH",
        "Inspected transaction signer differs from approval",
      );
    }
    if (!safeDigestEqual(actual.messageHash, approved.messageHash)) {
      throw new SemanticVerificationError(
        "EXECUTION_MESSAGE_MISMATCH",
        "Inspected transaction message differs from approval",
      );
    }
    if (
      normalizeAddress(actual.destination || "", envelope.chain)
        !== normalizeAddress(approved.destination || "", envelope.chain)
      || (actual.dataHash || "") !== (approved.dataHash || "")
      || (actual.nonce || "") !== (approved.nonce || "")
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_CALL_MISMATCH",
        "Inspected transaction destination, calldata, or nonce differs from approval",
      );
    }
    if (actual.valueAtomic !== approved.valueAtomic) {
      throw new SemanticVerificationError(
        "EXECUTION_AMOUNT_MISMATCH",
        "Inspected transaction native value differs from approval",
      );
    }
    const approvedPrograms = approved.programIds
      .map((value) => normalizeAddress(value, envelope.chain))
      .sort();
    const actualPrograms = actual.programIds
      .map((value) => normalizeAddress(value, envelope.chain))
      .sort();
    if (canonical(actualPrograms) !== canonical(approvedPrograms)) {
      throw new SemanticVerificationError(
        "EXECUTION_PROGRAM_MISMATCH",
        "Inspected program or contract set differs from approval",
      );
    }
    const approvedRecipients = approved.recipients
      .map((recipient) => ({
        ...recipient,
        address: normalizeAddress(recipient.address, envelope.chain),
      }))
      .sort((left, right) =>
        recipientKey(left, envelope.chain).localeCompare(recipientKey(right, envelope.chain)));
    const actualRecipients = actual.recipients
      .map((recipient) => ({
        ...recipient,
        address: normalizeAddress(recipient.address, envelope.chain),
      }))
      .sort((left, right) =>
        recipientKey(left, envelope.chain).localeCompare(recipientKey(right, envelope.chain)));
    if (canonical(actualRecipients) !== canonical(approvedRecipients)) {
      throw new SemanticVerificationError(
        "EXECUTION_RECIPIENT_MISMATCH",
        "Inspected recipient, asset, or amount differs from approval",
      );
    }
    if (canonical(actual.operation || null) !== canonical(approved.operation || null)) {
      throw new SemanticVerificationError(
        "EXECUTION_OPERATION_MISMATCH",
        "Inspected platform operation differs from approval",
      );
    }
    if (actual.slippageBps > approved.maxSlippageBps) {
      throw new SemanticVerificationError(
        "EXECUTION_SLIPPAGE_EXCEEDED",
        "Inspected transaction exceeds approved slippage",
      );
    }
    if (
      assertAtomic(actual.estimatedFeeAtomic, "estimatedFeeAtomic")
      > assertAtomic(approved.maxFeeAtomic, "maxFeeAtomic")
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_FEE_EXCEEDED",
        "Inspected transaction exceeds approved network fee",
      );
    }
    if (
      approved.lastValidBlockHeight !== undefined
      && (actual.currentBlockHeight === undefined
        || actual.currentBlockHeight > approved.lastValidBlockHeight)
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_TRANSACTION_EXPIRED",
        "Inspected transaction is outside its approved block lifetime",
      );
    }
    if (
      approved.validUntil
      && Date.parse(actual.observedAt) >= Date.parse(approved.validUntil)
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_TRANSACTION_EXPIRED",
        "Inspected transaction is outside its approved time lifetime",
      );
    }
    assertTimestamp(actual.observedAt, "observedAt");
  }
}

export class ExecutionSemanticEnvelopeService {
  constructor(
    private readonly repository: ExecutionReservationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async verifyAndBind(input: {
    envelope: ApprovedExecutionEnvelope;
    inspections: TransactionInspection[];
    expectedStateVersion: number;
  }) {
    const current = await this.repository.get(input.envelope.executionId);
    if (
      !current
      || current.status !== "reserved"
      || current.stateVersion !== input.expectedStateVersion
      || current.semanticEnvelope
    ) {
      throw new SemanticVerificationError(
        "EXECUTION_SEMANTICS_STATE_CONFLICT",
        "Execution is not available for semantic-envelope binding",
      );
    }
    verifyExecutionSemantics({
      envelope: input.envelope,
      inspections: input.inspections,
      binding: {
        executionId: current.executionId,
        actorId: current.actorId,
        intentDigest: current.intentDigest,
        action: current.action,
      },
      now: this.now(),
    });
    const persisted = await this.repository.bindSemanticEnvelope({
      executionId: current.executionId,
      actorId: current.actorId,
      expectedStateVersion: input.expectedStateVersion,
      envelope: input.envelope,
      verifiedAt: this.now().toISOString(),
    });
    if (!persisted) {
      throw new SemanticVerificationError(
        "EXECUTION_SEMANTICS_STATE_CONFLICT",
        "Execution changed before semantic-envelope binding",
      );
    }
    return persisted;
  }
}
