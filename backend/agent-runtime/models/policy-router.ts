import type {
  AgentDefinitionVersion,
  ModelRequest,
  ModelResponse,
} from "../contracts/index.ts";
import {
  ModelGateway,
  ModelGatewayError,
} from "./gateway.ts";

export class ModelPolicyRouter {
  constructor(private readonly gateway: ModelGateway) {}

  select(
    policy: AgentDefinitionVersion["modelPolicy"],
    requestedProvider?: string,
  ): string {
    const registered = new Set(this.gateway.list().map((provider) => provider.id));
    const allowed = policy.allowedProviders.filter((provider) => registered.has(provider));
    if (requestedProvider) {
      if (!policy.allowedProviders.includes(requestedProvider)) {
        throw new ModelGatewayError(
          "MODEL_PROVIDER_NOT_ALLOWED",
          `Model provider ${requestedProvider} is not allowed by the Agent version`,
        );
      }
      if (!registered.has(requestedProvider)) {
        throw new ModelGatewayError(
          "MODEL_PROVIDER_NOT_REGISTERED",
          `Allowed model provider ${requestedProvider} is not registered`,
        );
      }
      return requestedProvider;
    }
    if (
      policy.defaultProvider
      && policy.allowedProviders.includes(policy.defaultProvider)
      && registered.has(policy.defaultProvider)
    ) {
      return policy.defaultProvider;
    }
    if (allowed[0]) return allowed[0];
    throw new ModelGatewayError(
      "MODEL_PROVIDER_UNAVAILABLE",
      "No registered Model Provider satisfies the Agent version policy",
    );
  }

  generate(
    policy: AgentDefinitionVersion["modelPolicy"],
    request: ModelRequest,
    options: {
      requestedProvider?: string;
      signal?: AbortSignal;
      timeoutMs?: number;
    } = {},
  ): Promise<ModelResponse> {
    const providerId = this.select(policy, options.requestedProvider);
    return this.gateway.generate(providerId, request, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }
}
