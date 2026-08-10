export interface ExecutionChainReference {
  kind: "solana" | "evm";
  network: string;
  chainId?: number;
}

export interface ExecutionRecipient {
  address: string;
  assetId: string;
  amountAtomic: string;
}

export interface PumpLaunchOperationSemantics {
  kind: "pump.launch";
  mintAddress: string;
  name: string;
  symbol: string;
  metadataUri: string;
  creator: string;
  developerBuyLamports: string;
}

export interface ApprovedTransactionSemantics {
  transactionId: string;
  signer: string;
  messageHash: string;
  destination?: string;
  valueAtomic: string;
  dataHash?: string;
  nonce?: string;
  programIds: string[];
  recipients: ExecutionRecipient[];
  operation?: PumpLaunchOperationSemantics;
  maxSlippageBps: number;
  maxFeeAtomic: string;
  lastValidBlockHeight?: number;
  validUntil?: string;
}

export interface ApprovedExecutionEnvelope {
  schemaVersion: "agent.execution_envelope.v1";
  executionId: string;
  actorId: string;
  intentDigest: string;
  action: string;
  chain: ExecutionChainReference;
  transactions: ApprovedTransactionSemantics[];
  createdAt: string;
  expiresAt: string;
  envelopeDigest: string;
}

export interface TransactionInspection {
  schemaVersion: "agent.transaction_inspection.v1";
  executionId: string;
  transactionId: string;
  chain: ExecutionChainReference;
  signer: string;
  messageHash: string;
  destination?: string;
  valueAtomic: string;
  dataHash?: string;
  nonce?: string;
  programIds: string[];
  recipients: ExecutionRecipient[];
  operation?: PumpLaunchOperationSemantics;
  slippageBps: number;
  estimatedFeeAtomic: string;
  currentBlockHeight?: number;
  observedAt: string;
}

export interface ExecutionSemanticShadowRecord {
  schemaVersion: "agent.semantic_shadow.v1";
  shadowId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  envelope: ApprovedExecutionEnvelope;
  inspections: TransactionInspection[];
  shadowMode: true;
  recordedAt: string;
}
