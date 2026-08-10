import type {
  AgentTool,
  ToolExecutionContext,
  ToolResult,
} from "../contracts/tool.ts";

export interface SolanaSwapBroadcastInput {
  executionId: string;
  approvalId: string;
  expectedStateVersion: number;
  envelopeDigest: string;
  txHash: string;
}

export interface SolanaSwapBroadcastOutput {
  executionId: string;
  status: "submitted" | "reconciliation_required" | "confirmed" | "failed";
  txHash: string;
  providerAccepted: boolean;
  observedAt: string;
}

export interface SolanaSwapExecutionGateway {
  submitReservedSwap(
    context: ToolExecutionContext,
    input: SolanaSwapBroadcastInput,
  ): Promise<SolanaSwapBroadcastOutput>;
}

export class SolanaSwapToolAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SolanaSwapToolAdapterError";
  }
}

export function createSolanaSwapBroadcastTool(
  gateway: SolanaSwapExecutionGateway,
): AgentTool<SolanaSwapBroadcastInput, SolanaSwapBroadcastOutput> {
  return {
    definition: {
      name: "swap.solana.broadcast",
      version: "1.0.0",
      description: "Submit one already-reserved, semantically verified Solana swap through the Runtime execution gateway.",
      inputSchema: {
        type: "object",
        required: [
          "executionId",
          "approvalId",
          "expectedStateVersion",
          "envelopeDigest",
          "txHash",
        ],
        additionalProperties: false,
        properties: {
          executionId: { type: "string", format: "uuid" },
          approvalId: { type: "string", format: "uuid" },
          expectedStateVersion: { type: "integer", minimum: 1 },
          envelopeDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
          txHash: {
            type: "string",
            pattern: "^[1-9A-HJ-NP-Za-km-z]{64,100}$",
          },
        },
      },
      outputSchema: {
        type: "object",
        required: [
          "executionId",
          "status",
          "txHash",
          "providerAccepted",
          "observedAt",
        ],
        additionalProperties: false,
        properties: {
          executionId: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: [
              "submitted",
              "reconciliation_required",
              "confirmed",
              "failed",
            ],
          },
          txHash: {
            type: "string",
            pattern: "^[1-9A-HJ-NP-Za-km-z]{64,100}$",
          },
          providerAccepted: { type: "boolean" },
          observedAt: { type: "string", format: "date-time" },
        },
      },
      risk: "financial_irreversible",
      sideEffect: "funds",
      requiredPermissions: ["swap:execute"],
      approvalPolicy: "explicit_and_recent_auth",
      timeoutMs: 30_000,
      // Unknown provider outcomes are observed by the immutable signature.
      // The Runtime must never auto-submit the swap a second time.
      retryPolicy: "none",
    },
    async execute(
      context,
      input,
    ): Promise<ToolResult<SolanaSwapBroadcastOutput>> {
      if (context.approval?.approvalId !== input.approvalId) {
        throw new SolanaSwapToolAdapterError(
          "FINANCIAL_APPROVAL_IDENTITY_MISMATCH",
          "Tool input does not match the atomically consumed approval",
        );
      }
      await context.emit({
        type: "execution_submission_requested",
        payload: {
          executionId: input.executionId,
          approvalId: input.approvalId,
          txHash: input.txHash,
        },
      });
      const output = await gateway.submitReservedSwap(context, input);
      if (
        output.executionId !== input.executionId
        || output.txHash !== input.txHash
      ) {
        throw new SolanaSwapToolAdapterError(
          "FINANCIAL_ADAPTER_IDENTITY_MISMATCH",
          "Execution gateway changed the reserved execution or transaction identity",
        );
      }
      const acceptedStatus = output.status === "submitted"
        || output.status === "confirmed";
      if (output.providerAccepted !== acceptedStatus) {
        throw new SolanaSwapToolAdapterError(
          "FINANCIAL_ADAPTER_ACCEPTANCE_MISMATCH",
          "Execution gateway provider-acceptance evidence contradicts its status",
        );
      }
      return { status: "succeeded", data: output };
    },
  };
}
