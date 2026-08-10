import type { JsonObject, JsonSchema } from "./common.ts";

export interface ModelCapabilities {
  structuredOutput: boolean;
  toolCalling: boolean;
  streaming: boolean;
  vision: boolean;
  maxContextTokens?: number;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export interface ProposedToolCall {
  callId: string;
  name: string;
  input: JsonObject;
}

export interface ModelRequest {
  requestId: string;
  operation: string;
  model?: string;
  messages?: ModelMessage[];
  input?: JsonObject;
  responseSchema?: JsonSchema;
  availableTools?: ModelToolDescriptor[];
  temperature?: number;
  maxOutputTokens?: number;
  metadata: {
    taskId: string;
    locale: string;
    policyProfile: string;
  };
}

export interface ModelResponse {
  provider: string;
  model: string;
  content?: string;
  structuredOutput?: unknown;
  proposedToolCalls?: ProposedToolCall[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
  finishReason: string;
}

export interface ModelHealth {
  ok: boolean;
  configured: boolean;
  detail?: string;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  generate(request: ModelRequest, signal: AbortSignal): Promise<ModelResponse>;
  health(): Promise<ModelHealth>;
}
