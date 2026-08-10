import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseSecret) {
  throw new Error("Server-only Supabase credentials are required");
}

function client() {
  return createClient(supabaseUrl, supabaseSecret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function requireResult(result, label) {
  const settled = await result;
  if (settled.error) {
    throw new Error(`${label}: ${settled.error.code || ""} ${settled.error.message}`);
  }
  return settled.data;
}

const control = client();
const contenderA = client();
const contenderB = client();
const ids = {
  actor: randomUUID(),
  task: randomUUID(),
  toolCall: randomUUID(),
  event: randomUUID(),
  approval: randomUUID(),
  intent: randomUUID(),
  execution: randomUUID(),
  resource: randomUUID(),
};
const messageHash = digest(`canary-message:${ids.execution}`);
const intentDigest = digest(`canary-intent:${ids.execution}`);
const requestFingerprint = digest(`canary-request:${ids.execution}`);
const signer = "1".repeat(32);
const txSignature = "2".repeat(88);
const startedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
const startKey = `canary:wallet-concurrency:start:${ids.execution}`;
const executionKey = `canary:wallet-concurrency:execution:${ids.execution}`;

const startRecord = {
  schemaVersion: "agent.financial_tool_start.v1",
  taskId: ids.task,
  toolCallId: ids.toolCall,
  eventId: ids.event,
  actorId: ids.actor,
  client: "production-canary",
  capability: "launch.execute",
  taskType: "launch.execute",
  taskStatus: "waiting_approval",
  toolName: "launch.pump.broadcast",
  toolVersion: "1.0.0",
  toolStatus: "waiting_approval",
  risk: "financial_irreversible",
  resourceType: "go_launch_draft",
  resourceId: ids.resource,
  safeInput: { messageHash },
  inputDigest: intentDigest,
  contextRefs: [],
  idempotencyKey: startKey,
  toolIdempotencyKey: `${startKey}:tool`,
  traceId: `canary-wallet-concurrency-${ids.execution}`,
  createdAt: startedAt,
  approval: {
    schemaVersion: "agent.approval.v1",
    approvalId: ids.approval,
    intent: {
      schemaVersion: "agent.execution_intent.v1",
      intentId: ids.intent,
      actorId: ids.actor,
      action: "launch.broadcast",
      resourceType: "go_launch_draft",
      resourceId: ids.resource,
      parameters: {
        message_hash: messageHash,
        fee_payer: signer,
      },
      intentDigest,
      risk: "financial_irreversible",
      status: "requested",
      createdAt: startedAt,
      expiresAt,
    },
    actorId: ids.actor,
    taskId: ids.task,
    toolCallId: ids.toolCall,
    status: "requested",
    policy: "explicit",
    idempotencyKey: `${startKey}:approval`,
    stateVersion: 1,
    requestedAt: startedAt,
    expiresAt,
  },
};

const reservation = {
  schemaVersion: "agent.execution.v1",
  executionId: ids.execution,
  taskId: ids.task,
  toolCallId: ids.toolCall,
  approvalId: ids.approval,
  intentId: ids.intent,
  actorId: ids.actor,
  action: "launch.broadcast",
  resourceType: "go_launch_draft",
  resourceId: ids.resource,
  intentDigest,
  idempotencyKey: executionKey,
  requestFingerprint,
  provider: "pump.fun",
  chain: "solana",
  status: "reserved",
  stateVersion: 1,
  createdAt: startedAt,
  updatedAt: startedAt,
};
const evidence = {
  schemaVersion: "agent.wallet_signature_confirmation.v1",
  messageHash,
  txSignature,
  signer,
  verifiedAt: startedAt,
};
const rpcArgs = {
  p_record: reservation,
  p_evidence: evidence,
  p_expected_approval_version: 1,
  p_expected_task_version: 1,
};
let passedChecks;

try {
  await requireResult(
    control.rpc("agent_begin_financial_tool_v1", { p_record: startRecord }),
    "Unable to create concurrency canary approval",
  );

  const attempts = await Promise.all([
    contenderA.rpc("agent_reserve_wallet_signed_execution_v1", rpcArgs),
    contenderB.rpc("agent_reserve_wallet_signed_execution_v1", rpcArgs),
  ]);
  for (const attempt of attempts) {
    if (attempt.error || !attempt.data) {
      throw new Error(
        `Concurrent reservation failed: ${attempt.error?.code || ""} ${attempt.error?.message || "empty result"}`,
      );
    }
  }
  const results = attempts.map(({ data }) => data);
  const executionIds = new Set(
    results.map((result) =>
      result.reservation?.execution_id || result.reservation?.executionId),
  );
  const replayFlags = results
    .map((result) => Boolean(result.idempotentReplay))
    .sort();
  if (
    executionIds.size !== 1
    || !executionIds.has(ids.execution)
    || JSON.stringify(replayFlags) !== JSON.stringify([false, true])
    || results.some((result) => result.reservation?.status !== "reserved")
  ) {
    throw new Error("Concurrent reservation did not converge to one exact execution");
  }

  const drift = await contenderA.rpc(
    "agent_reserve_wallet_signed_execution_v1",
    {
      ...rpcArgs,
      p_evidence: { ...evidence, txSignature: "3".repeat(88) },
    },
  );
  if (!drift.error) {
    throw new Error("Conflicting wallet-signature evidence unexpectedly replayed");
  }

  const executionRows = await requireResult(
    control
      .from("agent_executions")
      .select("execution_id,status", { count: "exact" })
      .eq("actor_id", ids.actor),
    "Unable to verify execution count",
  );
  const approvalAudit = await requireResult(
    control
      .from("agent_authorization_audit")
      .select("audit_id,event_type")
      .eq("approval_id", ids.approval)
      .eq("event_type", "approval.approved"),
    "Unable to verify approval audit",
  );
  if (
    executionRows.length !== 1
    || executionRows[0]?.execution_id !== ids.execution
    || approvalAudit.length !== 1
  ) {
    throw new Error("Concurrent reservation created duplicate durable evidence");
  }

  passedChecks = [
    "two_concurrent_callers",
    "single_execution_reservation",
    "one_idempotent_replay",
    "single_wallet_approval_audit",
    "evidence_drift_rejected",
    "zero_broadcasts",
  ];
} finally {
  const cleanupSteps = [
    ["execution", () => control.from("agent_executions").delete().eq("execution_id", ids.execution)],
    ["approval", () => control.from("agent_authorizations").delete().eq("approval_id", ids.approval)],
    ["intent", () => control.from("agent_authorization_intents").delete().eq("intent_id", ids.intent)],
    ["tool call", () => control.from("agent_tool_calls").delete().eq("tool_call_id", ids.toolCall)],
    ["event outbox", () => control.from("agent_event_outbox").delete().eq("task_id", ids.task)],
    ["task", () => control.from("agent_tasks").delete().eq("task_id", ids.task)],
  ];
  for (const [label, cleanup] of cleanupSteps) {
    const result = await cleanup();
    if (result.error) {
      throw new Error(`Concurrency canary ${label} cleanup failed: ${result.error.message}`);
    }
  }
  const residueChecks = [
    ["execution", control.from("agent_executions").select("execution_id").eq("execution_id", ids.execution)],
    ["approval", control.from("agent_authorizations").select("approval_id").eq("approval_id", ids.approval)],
    ["intent", control.from("agent_authorization_intents").select("intent_id").eq("intent_id", ids.intent)],
    ["tool call", control.from("agent_tool_calls").select("tool_call_id").eq("tool_call_id", ids.toolCall)],
    ["task", control.from("agent_tasks").select("task_id").eq("task_id", ids.task)],
  ];
  for (const [label, query] of residueChecks) {
    const rows = await requireResult(query, `Unable to verify ${label} cleanup`);
    if (rows.length) throw new Error(`Concurrency canary left ${label} residue`);
  }
}

console.log(JSON.stringify({
  ok: true,
  checks: [...passedChecks, "cleanup_verified"],
}));
