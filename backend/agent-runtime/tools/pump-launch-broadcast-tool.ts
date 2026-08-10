import type {
  AgentTool,
  ToolExecutionContext,
  ToolResult,
} from "../contracts/tool.ts";

export interface PumpLaunchBroadcastInput {
  executionId: string;
  approvalId: string;
  expectedStateVersion: number;
  envelopeDigest: string;
  txHash: string;
}

export interface PumpLaunchBroadcastOutput {
  executionId: string;
  status: "submitted" | "reconciliation_required" | "confirmed" | "failed";
  txHash: string;
  providerAccepted: boolean;
  observedAt: string;
}

export interface PumpLaunchExecutionGateway {
  submitReservedLaunch(
    context: ToolExecutionContext,
    input: PumpLaunchBroadcastInput,
  ): Promise<PumpLaunchBroadcastOutput>;
}

export class FinancialToolAdapterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FinancialToolAdapterError";
  }
}

export function createPumpLaunchBroadcastTool(
  gateway: PumpLaunchExecutionGateway,
): AgentTool<PumpLaunchBroadcastInput, PumpLaunchBroadcastOutput> {
  return {
    definition: {
      name: "launch.pump.broadcast",
      version: "1.0.0",
      description: "Submit one already-reserved, semantically verified Pump launch through the Runtime execution gateway.",
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
      requiredPermissions: ["launch:execute"],
      approvalPolicy: "explicit_and_recent_auth",
      timeoutMs: 30_000,
      // A timeout is reconciled by txHash. The Tool Registry must never call
      // the broadcast adapter again as an automatic retry.
      retryPolicy: "none",
    },
    async execute(
      context,
      input,
    ): Promise<ToolResult<PumpLaunchBroadcastOutput>> {
      if (context.approval?.approvalId !== input.approvalId) {
        throw new FinancialToolAdapterError(
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
      const output = await gateway.submitReservedLaunch(context, input);
      if (
        output.executionId !== input.executionId
        || output.txHash !== input.txHash
      ) {
        throw new FinancialToolAdapterError(
          "FINANCIAL_ADAPTER_IDENTITY_MISMATCH",
          "Execution gateway changed the reserved execution or transaction identity",
        );
      }
      const acceptedStatus = output.status === "submitted"
        || output.status === "confirmed";
      if (output.providerAccepted !== acceptedStatus) {
        throw new FinancialToolAdapterError(
          "FINANCIAL_ADAPTER_ACCEPTANCE_MISMATCH",
          "Execution gateway provider-acceptance evidence contradicts its status",
        );
      }
      return { status: "succeeded", data: output };
    },
  };
}
