import { createHash } from "node:crypto";
import {
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  PUMP_PROGRAM_ID,
  PUMP_SDK,
} from "@pump-fun/pump-sdk";
import nacl from "tweetnacl";
import type {
  ApprovedExecutionEnvelope,
  ApprovedTransactionSemantics,
  PumpLaunchOperationSemantics,
  TransactionInspection,
} from "../contracts/index.ts";
import { executionEnvelopeDigest } from "./semantic-verifier.ts";

const ASSOCIATED_TOKEN_PROGRAM_ID =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const PUMP_PROGRAM = PUMP_PROGRAM_ID.toBase58();
// The SDK keeps its offline Anchor decoder private in the TypeScript surface,
// although it is the public runtime decoder backed by the shipped official IDL.
const OFFLINE_PUMP_PROGRAM = (
  PUMP_SDK as unknown as { offlinePumpProgram: any }
).offlinePumpProgram;

function canonicalAtomic(value: string, field: string): string {
  const normalized = String(value || "");
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) {
    throw new PumpLaunchInspectionError(
      "PUMP_SEMANTICS_INVALID",
      `${field} must be a canonical non-negative atomic amount`,
    );
  }
  return normalized;
}

function equalAddress(left: unknown, right: unknown): boolean {
  return String(left || "") === String(right || "");
}

function instructionAccounts(
  instruction: TransactionInstruction,
  instructionName: string,
  expectedRemainingAccounts = 0,
): Record<string, PublicKey> {
  const definition = OFFLINE_PUMP_PROGRAM.idl.instructions.find(
    ({ name }: { name: string }) => name === instructionName,
  );
  if (
    !definition
    || definition.accounts.length + expectedRemainingAccounts !== instruction.keys.length
  ) {
    throw new PumpLaunchInspectionError(
      "PUMP_INSTRUCTION_LAYOUT_MISMATCH",
      `Pump ${instructionName} account layout does not match the trusted IDL`,
    );
  }
  return Object.fromEntries(
    definition.accounts.map(
      ({ name }: { name: string }, index: number) => [name, instruction.keys[index].pubkey],
    ),
  );
}

function decodePumpInstruction(instruction: TransactionInstruction) {
  if (instruction.programId.toBase58() !== PUMP_PROGRAM) return null;
  const decoded = OFFLINE_PUMP_PROGRAM.coder.instruction.decode(
    instruction.data,
  );
  if (!decoded) {
    throw new PumpLaunchInspectionError(
      "PUMP_INSTRUCTION_UNKNOWN",
      "Pump transaction contains an instruction not recognized by the trusted IDL",
    );
  }
  return decoded as { name: string; data: Record<string, any> };
}

function maxDeveloperBuyLamports(developerBuyLamports: string): string {
  const amount = BigInt(developerBuyLamports);
  return (amount + (amount * 10n) / 1000n).toString();
}

export class PumpLaunchInspectionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PumpLaunchInspectionError";
  }
}

export function inspectPreparedPumpLaunch(input: {
  executionId: string;
  transactionId: string;
  transactionBase64: string;
  network?: string;
  feePayer: string;
  mintAddress: string;
  name: string;
  symbol: string;
  metadataUri: string;
  creator: string;
  developerBuyLamports: string;
  estimatedFeeAtomic: string;
  currentBlockHeight: number;
  observedAt: string;
}): TransactionInspection {
  const developerBuyLamports = canonicalAtomic(
    input.developerBuyLamports,
    "developerBuyLamports",
  );
  const estimatedFeeAtomic = canonicalAtomic(
    input.estimatedFeeAtomic,
    "estimatedFeeAtomic",
  );
  let transaction: Transaction;
  try {
    transaction = Transaction.from(Buffer.from(input.transactionBase64, "base64"));
  } catch {
    throw new PumpLaunchInspectionError(
      "PUMP_TRANSACTION_INVALID",
      "Prepared Pump transaction could not be decoded",
    );
  }
  if (!transaction.feePayer || !equalAddress(transaction.feePayer, input.feePayer)) {
    throw new PumpLaunchInspectionError(
      "PUMP_FEE_PAYER_MISMATCH",
      "Prepared Pump transaction fee payer differs from the selected wallet",
    );
  }
  const payerSignature = transaction.signatures.find(
    ({ publicKey }) => publicKey.toBase58() === input.feePayer,
  );
  if (payerSignature?.signature) {
    throw new PumpLaunchInspectionError(
      "PUMP_PREPARED_TRANSACTION_ALREADY_SIGNED",
      "Prepared Pump transaction must not already contain the wallet signature",
    );
  }
  const mintSignature = transaction.signatures.find(
    ({ publicKey }) => publicKey.toBase58() === input.mintAddress,
  );
  const serializedMessage = transaction.serializeMessage();
  if (
    !mintSignature?.signature
    || !nacl.sign.detached.verify(
      serializedMessage,
      mintSignature.signature,
      mintSignature.publicKey.toBytes(),
    )
  ) {
    throw new PumpLaunchInspectionError(
      "PUMP_MINT_SIGNATURE_INVALID",
      "Prepared Pump transaction is missing its valid mint signature",
    );
  }

  const expectedInstructionCount = developerBuyLamports === "0" ? 1 : 3;
  if (transaction.instructions.length !== expectedInstructionCount) {
    throw new PumpLaunchInspectionError(
      "PUMP_INSTRUCTION_SET_MISMATCH",
      "Prepared Pump transaction contains an unexpected instruction count",
    );
  }
  const decoded = transaction.instructions.map(decodePumpInstruction);
  if (decoded[0]?.name !== "createV2") {
    throw new PumpLaunchInspectionError(
      "PUMP_CREATE_INSTRUCTION_REQUIRED",
      "Prepared Pump launch must begin with exactly one createV2 instruction",
    );
  }
  const createInstruction = transaction.instructions[0];
  const createAccounts = instructionAccounts(createInstruction, "createV2");
  const create = decoded[0]!.data;
  if (
    !equalAddress(createAccounts.mint, input.mintAddress)
    || !equalAddress(createAccounts.user, input.feePayer)
    || !equalAddress(create.creator, input.creator)
    || create.name !== input.name
    || create.symbol !== input.symbol
    || create.uri !== input.metadataUri
    || create.isMayhemMode !== false
    || create.isCashbackEnabled?.[0] !== false
  ) {
    throw new PumpLaunchInspectionError(
      "PUMP_CREATE_SEMANTICS_MISMATCH",
      "Prepared Pump createV2 semantics differ from the launch plan",
    );
  }

  let maxSolCost = "0";
  if (developerBuyLamports !== "0") {
    if (
      transaction.instructions[1].programId.toBase58() !== ASSOCIATED_TOKEN_PROGRAM_ID
      || decoded[1] !== null
      || decoded[2]?.name !== "buy"
    ) {
      throw new PumpLaunchInspectionError(
        "PUMP_BUY_INSTRUCTION_SET_MISMATCH",
        "Prepared Pump developer buy contains an unexpected instruction",
      );
    }
    const associated = transaction.instructions[1];
    if (
      !equalAddress(associated.keys[0]?.pubkey, input.feePayer)
      || !equalAddress(associated.keys[2]?.pubkey, input.feePayer)
      || !equalAddress(associated.keys[3]?.pubkey, input.mintAddress)
    ) {
      throw new PumpLaunchInspectionError(
        "PUMP_ASSOCIATED_ACCOUNT_MISMATCH",
        "Prepared Pump associated token account instruction differs from approval",
      );
    }
    const buyInstruction = transaction.instructions[2];
    const buyAccounts = instructionAccounts(buyInstruction, "buy", 2);
    const remainingBuyAccounts = buyInstruction.keys.slice(-2);
    if (
      remainingBuyAccounts.some(({ isSigner }) => isSigner)
      || remainingBuyAccounts[0]?.isWritable !== false
      || remainingBuyAccounts[1]?.isWritable !== true
    ) {
      throw new PumpLaunchInspectionError(
        "PUMP_BUY_REMAINING_ACCOUNTS_MISMATCH",
        "Prepared Pump buy contains unsafe remaining accounts",
      );
    }
    const buy = decoded[2]!.data;
    maxSolCost = String(buy.maxSolCost);
    if (
      !equalAddress(buyAccounts.mint, input.mintAddress)
      || !equalAddress(buyAccounts.user, input.feePayer)
      || maxSolCost !== maxDeveloperBuyLamports(developerBuyLamports)
      || BigInt(String(buy.amount)) <= 0n
    ) {
      throw new PumpLaunchInspectionError(
        "PUMP_BUY_SEMANTICS_MISMATCH",
        "Prepared Pump developer buy differs from the approved amount or wallet",
      );
    }
  }

  const operation: PumpLaunchOperationSemantics = {
    kind: "pump.launch",
    mintAddress: input.mintAddress,
    name: input.name,
    symbol: input.symbol,
    metadataUri: input.metadataUri,
    creator: input.creator,
    developerBuyLamports,
  };
  return {
    schemaVersion: "agent.transaction_inspection.v1",
    executionId: input.executionId,
    transactionId: input.transactionId,
    chain: { kind: "solana", network: input.network || "mainnet-beta" },
    signer: input.feePayer,
    messageHash: createHash("sha256").update(serializedMessage).digest("hex"),
    valueAtomic: maxSolCost,
    programIds: [...new Set(
      transaction.instructions.map(({ programId }) => programId.toBase58()),
    )],
    recipients: [],
    operation,
    slippageBps: developerBuyLamports === "0" ? 0 : 100,
    estimatedFeeAtomic,
    currentBlockHeight: input.currentBlockHeight,
    observedAt: input.observedAt,
  };
}

export function buildApprovedPumpLaunchEnvelope(input: {
  inspection: TransactionInspection;
  actorId: string;
  intentDigest: string;
  action?: string;
  maxFeeAtomic: string;
  lastValidBlockHeight: number;
  createdAt: string;
  expiresAt: string;
}): ApprovedExecutionEnvelope {
  if (input.inspection.operation?.kind !== "pump.launch") {
    throw new PumpLaunchInspectionError(
      "PUMP_OPERATION_REQUIRED",
      "Pump launch envelope requires a trusted Pump inspection",
    );
  }
  const transaction: ApprovedTransactionSemantics = {
    transactionId: input.inspection.transactionId,
    signer: input.inspection.signer,
    messageHash: input.inspection.messageHash,
    valueAtomic: input.inspection.valueAtomic,
    programIds: [...input.inspection.programIds],
    recipients: structuredClone(input.inspection.recipients),
    operation: structuredClone(input.inspection.operation),
    maxSlippageBps: input.inspection.slippageBps,
    maxFeeAtomic: canonicalAtomic(input.maxFeeAtomic, "maxFeeAtomic"),
    lastValidBlockHeight: input.lastValidBlockHeight,
  };
  const unsigned: Omit<ApprovedExecutionEnvelope, "envelopeDigest"> = {
    schemaVersion: "agent.execution_envelope.v1",
    executionId: input.inspection.executionId,
    actorId: input.actorId,
    intentDigest: input.intentDigest,
    action: input.action || "launch.broadcast",
    chain: structuredClone(input.inspection.chain),
    transactions: [transaction],
    createdAt: input.createdAt,
    expiresAt: input.expiresAt,
  };
  return {
    ...unsigned,
    envelopeDigest: executionEnvelopeDigest(unsigned),
  };
}
