import type { ActorRef, JsonObject, ResourceVersionRef } from "./common.ts";

export type AgentClient = "go" | "pulse" | "assets" | "api" | "telegram" | (string & {});

export type ContextRefKind =
  | "pulse.narrative_snapshot"
  | "pulse.opportunity"
  | "assets.wallet_group"
  | "assets.wallet"
  | "agent.artifact";

export interface ContextRef extends ResourceVersionRef {
  kind: ContextRefKind;
}

export interface ResolvedContextRef extends ContextRef {
  resolvedAt: string;
  safeData: unknown;
}

export interface PolicyContext {
  permissions: string[];
  resourceScopes: ResourceVersionRef[];
  policyProfile: string;
}

export interface ResolvedContextEnvelope {
  schemaVersion: "agent.context.v1";
  actor: ActorRef;
  client: AgentClient;
  conversationId: string;
  refs: ResolvedContextRef[];
  safeModelContext: JsonObject;
  policyContext: PolicyContext;
  createdAt: string;
}

export interface ContextProvider {
  readonly kind: ContextRefKind;
  resolve(actor: ActorRef, ref: ContextRef, signal: AbortSignal): Promise<ResolvedContextRef>;
}
