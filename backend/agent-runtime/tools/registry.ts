import type {
  AgentTool,
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "../contracts/tool.ts";
import { SchemaValidationError, validateJsonSchema } from "./schema-validator.ts";

export class ToolRegistryError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

export class ToolRegistry {
  readonly #tools = new Map<string, AgentTool>();

  register(tool: AgentTool): this {
    validateDefinition(tool.definition);
    const key = toolKey(tool.definition.name, tool.definition.version);
    if (this.#tools.has(key)) {
      throw new ToolRegistryError("TOOL_ALREADY_REGISTERED", `Tool ${key} is already registered`);
    }
    this.#tools.set(key, tool);
    return this;
  }

  get(name: string, version?: string): AgentTool | null {
    if (version) return this.#tools.get(toolKey(name, version)) || null;
    return this.list()
      .filter((definition) => definition.name === name)
      .sort((left, right) => compareSemanticVersions(right.version, left.version))
      .map((definition) => this.#tools.get(toolKey(definition.name, definition.version)) || null)
      .find(Boolean) || null;
  }

  list(): ToolDefinition[] {
    return [...this.#tools.values()]
      .map((tool) => structuredClone(tool.definition))
      .sort((left, right) => toolKey(left.name, left.version).localeCompare(toolKey(right.name, right.version)));
  }

  async execute<I, O>(
    name: string,
    version: string,
    context: ToolExecutionContext,
    input: I,
  ): Promise<ToolResult<O>> {
    const tool = this.get(name, version) as AgentTool<I, O> | null;
    if (!tool) throw new ToolRegistryError("TOOL_NOT_FOUND", `Tool ${name}@${version} is not registered`);

    enforcePermissions(tool.definition, context);
    const inputIssues = validateJsonSchema(tool.definition.inputSchema, input);
    if (inputIssues.length) throw new SchemaValidationError(`${name}@${version} input`, inputIssues);
    // Approval must bind an already validated intent. Asking a user to approve
    // malformed or out-of-contract parameters makes the approval ambiguous and
    // cannot become an execution authority later.
    enforceApproval(tool.definition, context);

    const controller = new AbortController();
    const abortFromParent = () => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", abortFromParent, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const error = new ToolRegistryError("TOOL_TIMEOUT", `${name}@${version} timed out`);
          controller.abort(error);
          reject(error);
        }, tool.definition.timeoutMs);
      });
      const result = await Promise.race([
        tool.execute({ ...context, signal: controller.signal }, input),
        timeout,
      ]);
      if (result.status === "succeeded") {
        const outputIssues = validateJsonSchema(tool.definition.outputSchema, result.data);
        if (outputIssues.length) throw new SchemaValidationError(`${name}@${version} output`, outputIssues);
      }
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      context.signal.removeEventListener("abort", abortFromParent);
    }
  }
}

function validateDefinition(definition: ToolDefinition): void {
  if (!/^[a-z][a-z0-9_.-]{2,100}$/.test(definition.name)) {
    throw new ToolRegistryError("INVALID_TOOL_DEFINITION", `Invalid tool name: ${definition.name}`);
  }
  if (!/^[1-9]\d*\.\d+\.\d+$/.test(definition.version)) {
    throw new ToolRegistryError("INVALID_TOOL_DEFINITION", `Invalid semantic version for ${definition.name}`);
  }
  if (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 100 || definition.timeoutMs > 120_000) {
    throw new ToolRegistryError("INVALID_TOOL_DEFINITION", `Invalid timeout for ${definition.name}`);
  }
  if (definition.risk === "financial_irreversible" && definition.approvalPolicy === "none") {
    throw new ToolRegistryError(
      "INVALID_TOOL_DEFINITION",
      `Financial tool ${definition.name} must require explicit approval`,
    );
  }
}

function enforcePermissions(definition: ToolDefinition, context: ToolExecutionContext): void {
  const available = new Set(context.policy.permissions);
  const missing = definition.requiredPermissions.filter((permission) => !available.has(permission));
  if (missing.length) {
    throw new ToolRegistryError("TOOL_PERMISSION_DENIED", `Missing tool permissions: ${missing.join(", ")}`);
  }
}

function enforceApproval(definition: ToolDefinition, context: ToolExecutionContext): void {
  if (definition.approvalPolicy === "none") return;
  const approval = context.approval;
  if (!approval || !["approved", "consumed"].includes(approval.status)) {
    throw new ToolRegistryError("TOOL_APPROVAL_REQUIRED", `${definition.name} requires explicit approval`);
  }
  if (definition.risk === "financial_irreversible" && approval.status !== "consumed") {
    throw new ToolRegistryError(
      "TOOL_APPROVAL_NOT_CONSUMED",
      `${definition.name} requires an atomically consumed approval`,
    );
  }
  if (approval.actorId !== context.actor.actorId) {
    throw new ToolRegistryError("TOOL_APPROVAL_ACTOR_MISMATCH", "Approval actor does not match the tool actor");
  }
  if (!context.intentDigest || approval.intentDigest !== context.intentDigest) {
    throw new ToolRegistryError("TOOL_APPROVAL_INTENT_MISMATCH", "Approval does not match the exact tool intent");
  }
  if (Date.parse(approval.expiresAt) <= Date.now()) {
    throw new ToolRegistryError("TOOL_APPROVAL_EXPIRED", "Approval has expired");
  }
  if (definition.approvalPolicy === "explicit_and_recent_auth") {
    const recentAuthAt = Date.parse(approval.recentAuthAt || "");
    if (!Number.isFinite(recentAuthAt) || Date.now() - recentAuthAt > 5 * 60_000) {
      throw new ToolRegistryError("TOOL_RECENT_AUTH_REQUIRED", "Recent authentication is required");
    }
  }
}

function toolKey(name: string, version: string): string {
  return `${name}@${version}`;
}

function compareSemanticVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}
