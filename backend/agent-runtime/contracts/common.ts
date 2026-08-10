export type JsonObject = Record<string, unknown>;
export type JsonSchema = JsonObject;

export interface ActorRef {
  actorId: string;
  tenantId?: string;
  sessionId?: string;
  permissions: string[];
}

export interface ActorScope {
  actorId: string;
  tenantId?: string;
}

export interface TraceContext {
  requestId: string;
  traceId: string;
}

export interface ResourceVersionRef {
  kind: string;
  id: string;
  version?: string;
  digest?: string;
}
