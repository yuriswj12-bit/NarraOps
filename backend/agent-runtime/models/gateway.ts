import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../contracts/model.ts";
import { SchemaValidationError, validateJsonSchema } from "../tools/schema-validator.ts";

export class ModelGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}

export class ModelGateway {
  readonly #providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): this {
    if (!provider.id || this.#providers.has(provider.id)) {
      throw new ModelGatewayError(
        this.#providers.has(provider.id) ? "MODEL_PROVIDER_ALREADY_REGISTERED" : "INVALID_MODEL_PROVIDER",
        `Model provider ${provider.id || "<empty>"} cannot be registered`,
      );
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  list(): ModelProvider[] {
    return [...this.#providers.values()];
  }

  async generate(
    providerId: string,
    request: ModelRequest,
    { signal = new AbortController().signal, timeoutMs = 8_000 } = {},
  ): Promise<ModelResponse> {
    const provider = this.#providers.get(providerId);
    if (!provider) throw new ModelGatewayError("MODEL_PROVIDER_NOT_FOUND", `Unknown model provider: ${providerId}`);

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abortFromParent, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new ModelGatewayError("MODEL_TIMEOUT", `${providerId} timed out after ${timeoutMs}ms`);
          controller.abort(error);
          reject(error);
        }, timeoutMs);
      });
      const response = await Promise.race([provider.generate(request, controller.signal), timeout]);
      if (request.responseSchema && response.structuredOutput !== undefined) {
        const issues = validateJsonSchema(request.responseSchema, response.structuredOutput);
        if (issues.length) throw new SchemaValidationError(`${providerId} structured output`, issues);
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", abortFromParent);
    }
  }
}
