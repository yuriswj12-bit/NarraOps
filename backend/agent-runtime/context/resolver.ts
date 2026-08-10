import { createHash } from "node:crypto";
import type {
  ActorRef,
  AgentClient,
  ContextProvider,
  ContextRef,
  ContextRefKind,
  ResolvedContextEnvelope,
  ResolvedContextRef,
} from "../contracts/index.ts";

const MAX_CONTEXT_REFS = 20;
const MAX_SAFE_CONTEXT_BYTES = 64_000;
const SECRET_KEY = /^(authorization|cookie|set-cookie|api[_-]?key|private[_-]?key|secret[_-]?key|mnemonic|seed(?:[_-]?phrase)?|access[_-]?token|refresh[_-]?token|signature)$/i;

export class ContextResolutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContextResolutionError";
  }
}

export interface ResolveContextRequest {
  actor: ActorRef;
  client: AgentClient;
  conversationId: string;
  refs: ContextRef[];
  policyProfile?: string;
  signal?: AbortSignal;
}

export class ContextResolver {
  readonly #providers = new Map<ContextRefKind, ContextProvider>();

  constructor(providers: ContextProvider[] = []) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: ContextProvider): this {
    if (this.#providers.has(provider.kind)) {
      throw new ContextResolutionError(
        "CONTEXT_PROVIDER_ALREADY_REGISTERED",
        `Context provider already registered for ${provider.kind}`,
      );
    }
    this.#providers.set(provider.kind, provider);
    return this;
  }

  kinds(): ContextRefKind[] {
    return [...this.#providers.keys()].sort();
  }

  async resolve(request: ResolveContextRequest): Promise<ResolvedContextEnvelope> {
    if (!request.actor?.actorId) {
      throw new ContextResolutionError("CONTEXT_ACTOR_REQUIRED", "Authenticated actor is required to resolve context");
    }
    if (!Array.isArray(request.refs) || request.refs.length > MAX_CONTEXT_REFS) {
      throw new ContextResolutionError(
        "CONTEXT_REF_LIMIT_EXCEEDED",
        `Context refs must contain at most ${MAX_CONTEXT_REFS} entries`,
      );
    }
    const signal = request.signal || new AbortController().signal;
    const seen = new Set<string>();
    const resolved: ResolvedContextRef[] = [];
    for (const ref of request.refs) {
      const key = `${ref.kind}:${ref.id}`;
      if (seen.has(key)) {
        throw new ContextResolutionError("CONTEXT_REF_DUPLICATE", `Duplicate context ref: ${key}`);
      }
      seen.add(key);
      const provider = this.#providers.get(ref.kind);
      if (!provider) {
        throw new ContextResolutionError("CONTEXT_PROVIDER_NOT_FOUND", `No provider registered for ${ref.kind}`);
      }
      const item = await provider.resolve(request.actor, ref, signal);
      assertResolvedRef(ref, item);
      assertSafeData(item.safeData);
      if (ref.digest && item.digest !== ref.digest) {
        throw new ContextResolutionError("CONTEXT_DIGEST_MISMATCH", `Context changed for ${key}`);
      }
      resolved.push(item);
    }

    const safeModelContext = {
      sources: resolved.map(({ kind, id, version, digest, safeData }) => ({
        kind,
        id,
        ...(version ? { version } : {}),
        ...(digest ? { digest } : {}),
        data: safeData,
      })),
    };
    if (Buffer.byteLength(JSON.stringify(safeModelContext), "utf8") > MAX_SAFE_CONTEXT_BYTES) {
      throw new ContextResolutionError(
        "CONTEXT_SAFE_PROJECTION_TOO_LARGE",
        `Resolved model context exceeds ${MAX_SAFE_CONTEXT_BYTES} bytes`,
      );
    }

    return {
      schemaVersion: "agent.context.v1",
      actor: {
        actorId: request.actor.actorId,
        ...(request.actor.tenantId ? { tenantId: request.actor.tenantId } : {}),
        ...(request.actor.sessionId ? { sessionId: request.actor.sessionId } : {}),
        permissions: [...new Set(request.actor.permissions || [])].sort(),
      },
      client: request.client,
      conversationId: request.conversationId,
      refs: resolved,
      safeModelContext,
      policyContext: {
        permissions: [...new Set(request.actor.permissions || [])].sort(),
        resourceScopes: resolved.map(({ kind, id, version, digest }) => ({ kind, id, version, digest })),
        policyProfile: request.policyProfile || "default",
      },
      createdAt: new Date().toISOString(),
    };
  }
}

export function contextDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertResolvedRef(expected: ContextRef, actual: ResolvedContextRef): void {
  if (actual.kind !== expected.kind || actual.id !== expected.id) {
    throw new ContextResolutionError(
      "CONTEXT_PROVIDER_REF_MISMATCH",
      `Provider returned ${actual.kind}:${actual.id} for ${expected.kind}:${expected.id}`,
    );
  }
  if (!actual.digest) {
    throw new ContextResolutionError("CONTEXT_DIGEST_REQUIRED", `Provider omitted digest for ${actual.kind}:${actual.id}`);
  }
}

function assertSafeData(value: unknown, path = "$", seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) throw new ContextResolutionError("CONTEXT_CYCLIC_DATA", `Cyclic safe context at ${path}`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeData(item, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new ContextResolutionError("CONTEXT_SECRET_FIELD_REJECTED", `Secret-shaped context field rejected: ${path}.${key}`);
    }
    assertSafeData(item, `${path}.${key}`, seen);
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}
