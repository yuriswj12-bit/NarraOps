// @ts-nocheck
import http from "node:http";
import { randomUUID } from "node:crypto";
import { ApiError, errorPayload, statusCodeFor } from "./errors.ts";
import {
  validateAgentTask,
  validateLaunchPackage,
  validateNarrativeGenerate,
  validateNarrativeScan,
  validateConversationCreate,
  validateConversationMessage,
  validateLaunchDraft,
  validatePortfolioPeriod,
  validateTransferPreview,
  validateTransferSubmit,
  validateWalletAdd,
  validateWalletBatchDelete,
  validateWalletExport,
  validateWalletGroupCreate,
  validateFourMemeNonce,
  validateLaunchTransactionPlan,
  validateInternalLaunchPrepare,
  validateLaunchConfirm,
} from "./validation.ts";
import { InMemoryTaskRepository } from "./repositories/in-memory-task-repository.ts";
import { InMemoryConversationRepository } from "./repositories/in-memory-conversation-repository.ts";
import { InMemoryDevWalletRepository } from "./repositories/in-memory-dev-wallet-repository.ts";
import { InMemoryLaunchDraftRepository } from "./repositories/in-memory-launch-draft-repository.ts";
import { InMemoryWalletGroupRepository } from "./repositories/in-memory-wallet-group-repository.ts";
import { InMemoryTransferRepository } from "./repositories/in-memory-transfer-repository.ts";
import { TaskManager } from "../../agents/task-manager.ts";
import { AGENT_CAPABILITIES, normalizeLaunchDraftPatch } from "../../agents/agent-runtime.ts";
import { generateAgentReply } from "../../agents/llm-provider.ts";
import { createAgentHandlers } from "../../agents/agent-handlers.ts";
import { createIntegrationRegistry } from "../../integrations/registry.ts";
import { liveSettings, unavailableInviteSummary, unavailablePulse } from "../../integrations/product-state-data.ts";
import { GO_CATEGORIES, GO_COMMANDS, policyForType } from "../../agents/go-command-catalog.ts";
import { buildPulseMarketResponse } from "../../../api/v1/pulse-market.ts";
import { buildPulseDevWalletPnlResponse } from "../../../api/v1/pulse-dev-wallet-pnl.ts";
import { buildPulseNarrativesResponse } from "../../../api/v1/pulse-narratives.ts";
import { listLaunchPlatforms, resolveLaunchPlatform } from "../../integrations/launch-platform-registry.ts";
import { buildDraftMetadata, prepareNarrativeLink } from "../../integrations/narrative-link-adapter.ts";
import { walletCapabilities } from "../../integrations/wallet-provider-registry.ts";
import { unavailablePortfolio } from "../../integrations/account-state-data.ts";

function sendJson(res, statusCode, payload, requestId, extraHeaders = {}) {
  const body = statusCode === 204 ? "" : JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

function addDecimalStrings(left, right) {
  const decimals = Math.max((String(left).split(".")[1] || "").length, (String(right).split(".")[1] || "").length);
  const scale = 10n ** BigInt(decimals);
  const atomic = (value) => {
    const [whole, fraction = ""] = String(value).split(".");
    return (BigInt(whole) * scale) + BigInt(fraction.padEnd(decimals, "0"));
  };
  const total = atomic(left) + atomic(right);
  const fraction = String(total % scale).padStart(decimals, "0").replace(/0+$/, "");
  return `${total / scale}${fraction ? `.${fraction}` : ""}`;
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the configured limit"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > limit) return;
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ApiError(400, "INVALID_JSON", "Request body must contain valid JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function imageUrlToDataUrl(imageUrl, timeoutMs = 8_000) {
  const value = String(imageUrl || "").trim();
  if (value.startsWith("data:image/")) return value;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(400, "INVALID_TOKEN_IMAGE", "Token image must be a public HTTP(S) URL");
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|::1)$/i.test(parsed.hostname)) {
    throw new ApiError(400, "INVALID_TOKEN_IMAGE", "Token image must be a public HTTP(S) URL");
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new ApiError(502, "TOKEN_IMAGE_UNAVAILABLE", "The token image could not be downloaded");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0] || "";
  if (!contentType.startsWith("image/")) throw new ApiError(400, "INVALID_TOKEN_IMAGE", "The token image URL did not return an image");
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 5_500_000) throw new ApiError(413, "TOKEN_IMAGE_TOO_LARGE", "The token image must be smaller than 5.5 MB");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 5_500_000) throw new ApiError(413, "TOKEN_IMAGE_TOO_LARGE", "The token image must be smaller than 5.5 MB");
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

async function waitForTaskCompletion(manager, taskId, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let task = await manager.get(taskId);
  while (task && !["succeeded", "failed"].includes(task.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    task = await manager.get(taskId);
  }
  return task;
}

function startSse(req, res, manager, config, requestId, taskIdFilter) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId,
  });
  res.write(": connected\n\n");

  const sentEventIds = new Set();
  const listener = (event) => {
    const eventTaskId = event.data?.task_id || event.task?.taskId;
    if (taskIdFilter && eventTaskId !== taskIdFilter) return;
    if (sentEventIds.has(event.eventId) || res.writableEnded) return;
    sentEventIds.add(event.eventId);
    res.write(`id: ${event.eventId}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data ?? event.task)}\n\n`);
  };
  manager.on("taskEvent", listener);
  if (taskIdFilter) {
    for (const event of manager.eventsForTask(taskIdFilter)) listener(event);
  }
  const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), config.sseHeartbeatMs);
  const cleanup = () => {
    clearInterval(heartbeat);
    manager.off("taskEvent", listener);
  };
  req.once("close", cleanup);
  res.once("close", cleanup);
}

function toGoTask(task) {
  const payload = {
    task_id: task.taskId,
    type: task.type,
    status: task.status,
    progress: task.progress,
    requires_confirmation: task.requiresConfirmation,
    execution_mode: task.executionMode,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
  if (task.result !== undefined) payload.result = task.result;
  if (task.failure !== undefined) payload.failure = task.failure;
  return payload;
}

export function createApplication({ config, logger, repository, conversationRepository, devWalletRepository, launchDraftRepository, walletGroupRepository, transferRepository, integrations, taskManager, launchService, walletProvisioningService, walletExportService, launchCoordinator, assetService, authService } = {}) {
  const registry = integrations || createIntegrationRegistry(config);
  const repo = repository || new InMemoryTaskRepository();
  const devWallets = devWalletRepository || new InMemoryDevWalletRepository();
  const conversations = conversationRepository || new InMemoryConversationRepository();
  const launchDrafts = launchDraftRepository || new InMemoryLaunchDraftRepository();
  const walletGroups = walletGroupRepository || new InMemoryWalletGroupRepository({ seed: !walletProvisioningService });
  const transfers = transferRepository || new InMemoryTransferRepository({ walletGroupRepository: walletGroups, assetService });
  const assetActor = (req) => {
    if (!authService) return null;
    const session = authService.authenticate(req.headers.cookie);
    if (!session) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in with a Web3 wallet to access Assets");
    return session.user.userId;
  };
  const ownedGroup = (groupId, ownerUserId) => {
    const group = walletGroups.getGroup(groupId, ownerUserId ?? undefined);
    if (!group) throw new ApiError(404, "WALLET_GROUP_NOT_FOUND", "Wallet group was not found");
    return group;
  };
  const walletsWithBalances = async (groupId) => {
    const wallets = walletGroups.listWallets(groupId);
    if (!assetService) return wallets;
    return Promise.all(wallets.map(async (wallet) => ({ ...wallet, balances: await assetService.balances(wallet) })));
  };
  const groupWithBalances = async (group) => {
    const wallets = await walletsWithBalances(group.groupId);
    const totals = {};
    for (const wallet of wallets) {
      for (const balance of Object.values(wallet.balances || {})) {
        if (balance.status !== "live" || balance.atomic == null) continue;
        const current = totals[balance.asset] || 0n;
        totals[balance.asset] = current + BigInt(balance.atomic);
      }
    }
    const formatted = {};
    for (const [asset, atomic] of Object.entries(totals)) {
      const decimals = asset === "SOL" ? 9n : 18n;
      const scale = 10n ** decimals;
      const fraction = String(atomic % scale).padStart(Number(decimals), "0").replace(/0+$/, "");
      formatted[asset] = `${atomic / scale}${fraction ? `.${fraction}` : ""}`;
    }
    return { ...group, balances: formatted, balanceStatus: assetService ? "live" : "unavailable" };
  };
  const livePortfolio = async (period, ownerUserId) => {
    const groups = await Promise.all(walletGroups.listGroups(ownerUserId ?? undefined).map(groupWithBalances));
    const totals = {};
    for (const group of groups) for (const [asset, amount] of Object.entries(group.balances || {})) {
      totals[asset] = addDecimalStrings(totals[asset] || "0", amount);
    }
    return { mode: "live", period, balances: totals, turnover: null, realizedPnl: null, unrealizedPnl: null, pnlPercent: null, history: [], dataStatus: "live_native_balances", updatedAt: new Date().toISOString() };
  };
  const manager = taskManager || new TaskManager({
    repository: repo,
    handlers: createAgentHandlers(registry, {
      devWalletRepository: devWallets,
      launchDraftRepository: launchDrafts,
      conversationRepository: conversations,
      walletGroupRepository: walletGroups,
    }),
    stepDelayMs: config.taskStepDelayMs,
  });
  const inlineWaitingTaskIds = new Set();

  manager.on("taskEvent", (event) => {
    void (async () => {
    if (event.type !== "task.completed" && event.type !== "task.failed") return;
    const task = event.task;
    if (inlineWaitingTaskIds.has(task?.taskId)) return;
    const conversationId = await conversations.conversationIdForTask(task?.taskId);
    if (!conversationId) return;
    if (event.type === "task.completed") {
      await conversations.addMessage(conversationId, {
        role: "assistant",
        taskId: task.taskId,
        status: "completed",
        blocks: task.result?.card ? [task.result.card] : [{ type: "text", text: "Task completed" }],
      });
    } else {
      await conversations.addMessage(conversationId, {
        role: "assistant",
        taskId: task.taskId,
        status: "failed",
        blocks: [{ type: "error", error: task.failure }],
      });
    }
    })();
  });

  const server = http.createServer(async (req, res) => {
    const requestId = typeof req.headers["x-request-id"] === "string" && req.headers["x-request-id"].length <= 128
      ? req.headers["x-request-id"]
      : randomUUID();
    const startedAt = Date.now();
    const url = new URL(req.url || "/", "http://internal");

    try {
      if (req.method === "GET" && url.pathname === "/api/v1/health") {
        sendJson(res, 200, {
          ok: true,
          service: "narraops-api",
          version: "v1",
          mode: config.gmgnLiveEnabled ? "live" : "unavailable",
          time: new Date().toISOString(),
          integrations: registry.list(),
        }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/events") {
        startSse(req, res, manager, config, requestId, url.searchParams.get("taskId"));
        return;
      }

      const conversationMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/agent\/conversations\/([0-9a-f-]{36})$/i);
      if (conversationMatch) {
        const conversation = await conversations.get(conversationMatch[1]);
        if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
        sendJson(res, 200, conversation, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/agent/commands") {
        sendJson(res, 200, { categories: GO_CATEGORIES, commands: GO_COMMANDS }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/account/portfolio") {
        const ownerUserId = assetActor(req);
        const period = validatePortfolioPeriod(url.searchParams.get("period"));
        sendJson(res, 200, assetService ? await livePortfolio(period, ownerUserId) : unavailablePortfolio(period), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallet-groups") {
        const ownerUserId = assetActor(req);
        sendJson(res, 200, { mode: walletGroups.mode(), balanceMode: assetService ? "live" : "unavailable", groups: await Promise.all(walletGroups.listGroups(ownerUserId ?? undefined).map(groupWithBalances)) }, requestId);
        return;
      }

      const groupWalletsMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets$/i);
      if (groupWalletsMatch) {
        const ownerUserId = assetActor(req);
        const group = ownedGroup(groupWalletsMatch[1], ownerUserId);
        sendJson(res, 200, { mode: walletGroups.mode(), balanceMode: assetService ? "live" : "unavailable", group: await groupWithBalances(group), wallets: await walletsWithBalances(group.groupId) }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/pulse") {
        sendJson(res, 200, unavailablePulse(), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/pulse/market") {
        sendJson(res, 200, buildPulseMarketResponse([]), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/pulse/dev-wallet-pnl") {
        sendJson(res, 200, buildPulseDevWalletPnlResponse([]), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/pulse/narratives") {
        sendJson(res, 200, buildPulseNarrativesResponse([]), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/chains/solana/latest-blockhash") {
        const rpcResponse = await fetch(config.solanaRpcUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method: "getLatestBlockhash", params: [{ commitment: "confirmed" }] }),
          signal: AbortSignal.timeout(config.externalTimeoutMs || 8_000),
        });
        const rpcPayload = await rpcResponse.json().catch(() => null);
        if (!rpcResponse.ok || rpcPayload?.error || !rpcPayload?.result?.value?.blockhash) {
          throw new ApiError(502, "SOLANA_RPC_UNAVAILABLE", "Solana RPC could not provide a recent blockhash", {
            rpcStatus: rpcResponse.status,
            rpcCode: rpcPayload?.error?.code,
          });
        }
        sendJson(res, 200, {
          blockhash: rpcPayload.result.value.blockhash,
          lastValidBlockHeight: rpcPayload.result.value.lastValidBlockHeight,
        }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/launch/platforms") {
        sendJson(res, 200, { execution_enabled: true, platforms: listLaunchPlatforms() }, requestId);
        return;
      }

      const launchDraftMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/launch\/drafts\/([0-9a-f-]{36})$/i);
      if (launchDraftMatch) {
        const draft = await launchDrafts.get(launchDraftMatch[1]);
        if (!draft) throw new ApiError(404, "LAUNCH_DRAFT_NOT_FOUND", "Launch draft was not found");
        sendJson(res, 200, draft, requestId);
        return;
      }

      const launchDraftPatchMatch = req.method === "PATCH" && url.pathname.match(/^\/api\/v1\/go\/launch-drafts\/([0-9a-f-]{36})$/i);
      if (launchDraftPatchMatch) {
        const draft = await launchDrafts.update(launchDraftPatchMatch[1], normalizeLaunchDraftPatch(await readJson(req, config.bodyLimitBytes)));
        if (!draft) throw new ApiError(404, "LAUNCH_DRAFT_NOT_FOUND", "Launch draft was not found");
        sendJson(res, 200, {
          schema_version: "go.launch_draft.v1",
          draft,
          card: {
            type: "launch_draft",
            status: draft.preparation_status,
            data: { ...draft, executable: true, submitted: false, reason: "awaiting_user_confirmation" },
          },
        }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/market/dev-wallets") {
        const chain = url.searchParams.get("chain") || undefined;
        sendJson(res, 200, {
          data_source: "gmgn",
          wallets: devWallets.list({ chain }),
        }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/invite/summary") {
        sendJson(res, 200, unavailableInviteSummary(), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/settings") {
        sendJson(res, 200, liveSettings(), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallets/capabilities") {
        sendJson(res, 200, walletCapabilities(config), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/execution/capabilities") {
        sendJson(res, 200, {
          execution_enabled: true,
          native_assets: assetService ? { balances: ["SOL", "BNB"], deposits: true, withdrawals: true, wallet_group_transfers: true } : null,
          signing: assetService ? "encrypted_vault" : "provider_configuration_required",
          broadcasting: "enabled",
        }, requestId);
        return;
      }

      const taskMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/agent\/tasks\/([0-9a-f-]{36})$/i);
      if (taskMatch) {
        const task = await manager.get(taskMatch[1]);
        if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Agent task was not found");
        sendJson(res, 200, toGoTask(task), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/auth/session") {
        const session = authService?.authenticate(req.headers.cookie);
        sendJson(res, 200, session || { authenticated: false, user: null }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/account/login-wallet-assets") {
        const session = authService?.authenticate(req.headers.cookie);
        if (!session) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in with a Web3 wallet to view login-wallet assets");
        const wallets = await Promise.all(session.user.identities.map(async (identity) => {
          const addresses = identity.chain === "solana" ? { solana: identity.address } : { bsc: identity.address };
          return { chain: identity.chain, address: identity.address, balances: assetService ? await assetService.balances({ addresses }) : {} };
        }));
        sendJson(res, 200, { mode: assetService ? "live" : "unavailable", wallets }, requestId);
        return;
      }

      const launchExecutionMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/launch\/executions\/([0-9a-f-]{36})$/i);
      if (launchExecutionMatch) {
        if (!launchCoordinator) throw new ApiError(503, "LAUNCH_EXECUTION_UNAVAILABLE", "Internal Cooking-wallet launch execution is not configured");
        sendJson(res, 200, launchCoordinator.getStatus(launchExecutionMatch[1]), requestId);
        return;
      }

      if (req.method === "POST") {
        const body = await readJson(req, config.bodyLimitBytes);
        let task;

        if (url.pathname === "/api/v1/chains/solana/send-transaction") {
          const signedTransactionBase64 = typeof body?.signedTransactionBase64 === "string" ? body.signedTransactionBase64.trim() : "";
          if (!/^[A-Za-z0-9+/=]+$/.test(signedTransactionBase64)) {
            throw new ApiError(400, "INVALID_SIGNED_TRANSACTION", "signedTransactionBase64 is required");
          }
          const sendResponse = await fetch(config.solanaRpcUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: requestId,
              method: "sendTransaction",
              params: [signedTransactionBase64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }],
            }),
            signal: AbortSignal.timeout(config.externalTimeoutMs || 8_000),
          });
          const sendPayload = await sendResponse.json().catch(() => null);
          if (!sendResponse.ok || sendPayload?.error || !sendPayload?.result) {
            throw new ApiError(502, "SOLANA_TRANSACTION_REJECTED", "Solana RPC rejected the signed transaction", {
              rpcStatus: sendResponse.status,
              rpcCode: sendPayload?.error?.code,
              rpcMessage: sendPayload?.error?.message,
            });
          }
          const signature = sendPayload.result;
          let confirmed = false;
          let slot = null;
          for (let attempt = 0; attempt < 12; attempt += 1) {
            const statusResponse = await fetch(config.solanaRpcUrl, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: `${requestId}-${attempt}`, method: "getSignatureStatuses", params: [[signature], { searchTransactionHistory: false }] }),
              signal: AbortSignal.timeout(config.externalTimeoutMs || 8_000),
            });
            const statusPayload = await statusResponse.json().catch(() => null);
            const status = statusPayload?.result?.value?.[0];
            if (status?.err) throw new ApiError(502, "SOLANA_TRANSACTION_FAILED", "Solana transaction failed", { signature, error: status.err });
            if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
              confirmed = true;
              slot = status.slot;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
          sendJson(res, 202, { signature, txHash: signature, status: confirmed ? "confirmed" : "submitted", confirmed, slot }, requestId);
          return;
        }

        if (url.pathname === "/api/v1/auth/web3/challenge") {
          if (!authService) throw new ApiError(503, "AUTH_UNAVAILABLE", "Web3 authentication is not configured");
          sendJson(res, 201, authService.createChallenge({ chain: body.chain, address: body.address, chainId: body.chainId == null ? undefined : Number(body.chainId) }), requestId);
          return;
        }

        if (url.pathname === "/api/v1/auth/web3/verify") {
          if (!authService) throw new ApiError(503, "AUTH_UNAVAILABLE", "Web3 authentication is not configured");
          const result = authService.verify({ challengeId: body.challengeId, signature: body.signature });
          const secure = config.secureCookies ? "; Secure" : "";
          sendJson(res, 200, result.session, requestId, { "set-cookie": `narraops_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${result.maxAge}${secure}` });
          return;
        }

        if (url.pathname === "/api/v1/auth/logout") {
          authService?.logout(req.headers.cookie);
          sendJson(res, 200, { authenticated: false }, requestId, { "set-cookie": `narraops_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.secureCookies ? "; Secure" : ""}` });
          return;
        }

        if (url.pathname === "/api/v1/auth/onboarding/complete") {
          if (!authService) throw new ApiError(503, "AUTH_UNAVAILABLE", "Web3 authentication is not configured");
          sendJson(res, 200, authService.completeOnboarding(req.headers.cookie), requestId);
          return;
        }

        if (url.pathname === "/api/v1/auth/web3/link") {
          if (!authService) throw new ApiError(503, "AUTH_UNAVAILABLE", "Web3 authentication is not configured");
          sendJson(res, 200, authService.linkIdentity(req.headers.cookie, { challengeId: body.challengeId, signature: body.signature }), requestId);
          return;
        }

        if (url.pathname === "/api/v1/wallet-groups") {
          const ownerUserId = assetActor(req);
          const input = validateWalletGroupCreate(body);
          const group = walletGroups.createGroup({ ...input, ownerUserId });
          if (walletProvisioningService) {
            for (const wallet of walletGroups.listWallets(group.groupId)) {
              walletGroups.activateWallet(wallet.walletId, await walletProvisioningService.provision({ walletId: wallet.walletId, network: group.network }));
            }
          }
          sendJson(res, 201, walletGroups.getGroup(group.groupId), requestId);
          return;
        }

        if (url.pathname === "/api/v1/launch/auth/fourmeme/nonce") {
          if (!launchService) throw new ApiError(503, "LAUNCH_SERVICE_UNAVAILABLE", "Launch planning service is not configured");
          sendJson(res, 200, await launchService.requestFourMemeLogin(validateFourMemeNonce(body)), requestId);
          return;
        }

        if (url.pathname === "/api/v1/launch/transactions/plan") {
          if (!launchService) throw new ApiError(503, "LAUNCH_SERVICE_UNAVAILABLE", "Launch planning service is not configured");
          const plan = await launchService.plan(validateLaunchTransactionPlan(body));
          sendJson(res, 201, { status: "requires_user_signature", broadcastByNarraOps: false, plan }, requestId);
          return;
        }

        if (url.pathname === "/api/v1/launch/executions/prepare") {
          if (!launchCoordinator) throw new ApiError(503, "LAUNCH_EXECUTION_UNAVAILABLE", "Internal Cooking-wallet launch execution is not configured");
          sendJson(res, 201, await launchCoordinator.prepare(validateInternalLaunchPrepare(body)), requestId);
          return;
        }

        const launchDraftExecuteMatch = url.pathname.match(/^\/api\/v1\/go\/launch-drafts\/([0-9a-f-]{36})\/execute$/i);
        if (launchDraftExecuteMatch) {
          if (!launchCoordinator || !launchService) throw new ApiError(503, "LAUNCH_EXECUTION_UNAVAILABLE", "Live Cooking-wallet launch execution is not configured");
          const draft = await launchDrafts.get(launchDraftExecuteMatch[1]);
          if (!draft) throw new ApiError(404, "LAUNCH_DRAFT_NOT_FOUND", "Launch draft was not found");
          const platformId = typeof draft.platform === "string" ? draft.platform : draft.platform?.id;
          const token = draft.token || {};
          if (platformId !== "pump") throw new ApiError(400, "UNSUPPORTED_LAUNCH_PLATFORM", "The Go launch button currently supports Pump only");
          if (!draft.cooking_wallet_group_id || !draft.bundled_wallet_group_id) throw new ApiError(400, "WALLET_GROUP_SELECTION_REQUIRED", "Select both a Cooking wallet group and a bundled wallet group before launching");
          const input = validateInternalLaunchPrepare({
            platform: "pump",
            name: token.name,
            symbol: token.symbol,
            description: token.description,
            imageBase64: await imageUrlToDataUrl(token.image_url, config.externalTimeoutMs || 8_000),
            imageName: "narraops-token-image",
            imageType: "image/png",
            twitter: token.x_url || "",
            website: token.website_url || "",
            developerBuyAmount: token.initial_buy || "0",
            cookingWalletGroupId: draft.cooking_wallet_group_id,
            boundBuy: { enabled: false },
          });
          const prepared = await launchCoordinator.prepare(input);
          const launched = await launchCoordinator.confirm({ executionId: prepared.executionId, confirmationToken: prepared.confirmationToken });
          sendJson(res, 202, { draft_id: draft.launch_draft_id, status: launched.status, execution: launched, token_address: launched.tokenAddress || null, transaction_hash: launched.transactionHash || null }, requestId);
          return;
        }

        const launchConfirmMatch = url.pathname.match(/^\/api\/v1\/launch\/executions\/([0-9a-f-]{36})\/confirm$/i);
        if (launchConfirmMatch) {
          if (!launchCoordinator) throw new ApiError(503, "LAUNCH_EXECUTION_UNAVAILABLE", "Internal Cooking-wallet launch execution is not configured");
          sendJson(res, 202, await launchCoordinator.confirm({ executionId: launchConfirmMatch[1], ...validateLaunchConfirm(body) }), requestId);
          return;
        }


        const launchRetryMatch = url.pathname.match(/^\/api\/v1\/launch\/executions\/([0-9a-f-]{36})\/retry$/i);
        if (launchRetryMatch) {
          if (!launchCoordinator) throw new ApiError(503, "LAUNCH_EXECUTION_UNAVAILABLE", "Internal Cooking-wallet launch execution is not configured");
          sendJson(res, 202, await launchCoordinator.retryFailedFollowBuys({ executionId: launchRetryMatch[1], confirmRetry: body.confirmRetry }), requestId);
          return;
        }

        const addWalletsMatch = url.pathname.match(/^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets$/i);
        if (addWalletsMatch) {
          const ownerUserId = assetActor(req);
          ownedGroup(addWalletsMatch[1], ownerUserId);
          const input = validateWalletAdd(body);
          const created = walletGroups.addWallets(addWalletsMatch[1], input.count);
          if (walletProvisioningService) {
            const group = walletGroups.getGroup(addWalletsMatch[1]);
            for (const wallet of created) walletGroups.activateWallet(wallet.walletId, await walletProvisioningService.provision({ walletId: wallet.walletId, network: group.network }));
          }
          sendJson(res, 201, {
            mode: walletGroups.mode(),
            group: walletGroups.getGroup(addWalletsMatch[1]),
            wallets: walletGroups.listWallets(addWalletsMatch[1]).filter(({ walletId }) => created.some((wallet) => wallet.walletId === walletId)),
          }, requestId);
          return;
        }

        const batchDeleteMatch = url.pathname.match(/^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets\/batch-delete$/i);
        if (batchDeleteMatch) {
          const ownerUserId = assetActor(req);
          ownedGroup(batchDeleteMatch[1], ownerUserId);
          const input = validateWalletBatchDelete(body);
          const result = input.confirm
            ? walletGroups.confirmBatchDelete(batchDeleteMatch[1], input, requestId)
            : walletGroups.previewBatchDelete(batchDeleteMatch[1], input.walletIds, requestId);
          sendJson(res, input.confirm ? 200 : 202, result, requestId);
          return;
        }

        const exportMatch = url.pathname.match(/^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/exports$/i);
        if (exportMatch) {
          const ownerUserId = assetActor(req);
          const groupId = exportMatch[1];
          const group = ownedGroup(groupId, ownerUserId);
          if (authService && !authService.authenticate(req.headers.cookie)) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in before exporting private keys");
          try {
            validateWalletExport(body);
          } catch (error) {
            walletGroups.recordExportAttempt({ requestId, groupId, outcome: "explicit_confirmation_missing" });
            throw error;
          }
          const reauthenticatedAt = typeof req.headers["x-reauthenticated-at"] === "string"
            ? Date.parse(req.headers["x-reauthenticated-at"])
            : Number.NaN;
          const reauthRecent = Number.isFinite(reauthenticatedAt) && Date.now() - reauthenticatedAt >= 0 && Date.now() - reauthenticatedAt <= 5 * 60_000;
          if (!reauthRecent) {
            walletGroups.recordExportAttempt({ requestId, groupId, outcome: "recent_reauthentication_required" });
            throw new ApiError(401, "RECENT_REAUTHENTICATION_REQUIRED", "Wallet export requires reauthentication within the last five minutes");
          }
          if (req.headers["x-mfa-verified"] !== "true") {
            walletGroups.recordExportAttempt({ requestId, groupId, outcome: "mfa_required" });
            throw new ApiError(403, "MFA_REQUIRED", "Wallet export requires a verified MFA challenge");
          }
          if (!walletExportService) {
            walletGroups.recordExportAttempt({ requestId, groupId, outcome: "export_service_unavailable" });
            throw new ApiError(503, "WALLET_EXPORT_UNAVAILABLE", "Wallet export requires the encrypted wallet vault", { ordinaryJsonResponseAllowed: false, requiresOneTimeEncryptedDownload: true, privateKeyMaterialReturned: false });
          }
          const result = await walletExportService.exportText(group, walletGroups.getExportWallets(groupId));
          walletGroups.recordExportAttempt({ requestId, groupId, outcome: "export_completed" });
          sendJson(res, 200, result, requestId, { "cache-control": "no-store", pragma: "no-cache" });
          return;
        }

        if (url.pathname === "/api/v1/transfers/preview") {
          const input = validateTransferPreview(body);
          sendJson(res, 201, await transfers.preview(input, requestId), requestId);
          return;
        }

        if (url.pathname === "/api/v1/transfers") {
          const input = validateTransferSubmit(body, req.headers["idempotency-key"]);
          sendJson(res, 202, await transfers.create(input, req.headers["idempotency-key"], requestId), requestId);
          return;
        }

        if (url.pathname === "/api/v1/agent/conversations") {
          const context = validateConversationCreate(body);
          const conversation = await conversations.create(context);
          sendJson(res, 201, conversation, requestId);
          return;
        }

        if (url.pathname === "/api/v1/launch/drafts") {
          const input = validateLaunchDraft(body);
          const platform = resolveLaunchPlatform(input);
          if (!platform || platform.chain !== input.chain) {
            throw new ApiError(400, "LAUNCH_PLATFORM_MISMATCH", "The selected platform does not support the requested chain");
          }
          const narrative = prepareNarrativeLink(input.narrative_url);
          if (["invalid", "rejected"].includes(narrative.status)) {
            throw new ApiError(400, "NARRATIVE_URL_REJECTED", "narrative_url must be a safe public HTTP(S) URL");
          }
          const token = buildDraftMetadata({ narrative, token: input.token });
          const required = ["name", "symbol", "description", "image_url"];
          const missingFields = required.filter((field) => !token[field]);
          const draft = await launchDrafts.create({
            chain: input.chain,
            platform,
            narrative,
            token,
            dev_wallet_id: input.dev_wallet_id || null,
            wallet_group_id: input.wallet_group_id || null,
            preparation_status: missingFields.length ? "requires_enrichment" : "ready_for_user_review",
            missing_fields: missingFields,
            requires_user_confirmation: true,
          });
          sendJson(res, 201, draft, requestId);
          return;
        }

        if (url.pathname === "/api/v1/launch/images") {
          throw new ApiError(503, "IMAGE_GENERATION_NOT_CONFIGURED", "AI 生图与 IPFS 固定服务尚未配置；请在生产密钥管理中提供图像模型和对象存储凭证");
        }

        const messageMatch = url.pathname.match(/^\/api\/v1\/agent\/conversations\/([0-9a-f-]{36})\/messages$/i);
        if (messageMatch) {
          const conversation = await conversations.get(messageMatch[1]);
          if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
          const message = validateConversationMessage(body);
          await conversations.addMessage(conversation.conversationId, {
            role: "user",
            content: message.message,
            command: message.command,
          });
          const parsed = validateAgentTask({
            ...(message.command ? { command: message.command } : { input: message.message }),
            parameters: { context: message.context },
          });
          task = await manager.create(parsed.type, parsed.input, requestId, {
            ...parsed.metadata,
            conversation_id: conversation.conversationId,
          });
          if (message.wait) inlineWaitingTaskIds.add(task.taskId);
          await conversations.bindTask(conversation.conversationId, task.taskId);
          const resultTask = message.wait
            ? await waitForTaskCompletion(manager, task.taskId, message.timeout_ms)
            : task;
          inlineWaitingTaskIds.delete(task.taskId);
          let assistantMessage = null;
          if (message.wait) {
            const restoredConversation = await conversations.get(conversation.conversationId);
            const reply = await generateAgentReply({
              message: message.message,
              language: message.context.language,
              history: restoredConversation?.messages || [],
              task: resultTask,
              capabilities: AGENT_CAPABILITIES,
            });
            assistantMessage = {
              role: "assistant",
              content: reply.content,
              suggestion: reply.suggestion,
              provider: reply.provider,
              used_llm: Boolean(reply.used_llm),
              ...(reply.model ? { model: reply.model } : {}),
            };
            await conversations.addMessage(conversation.conversationId, {
              role: "assistant",
              content: reply.content,
              taskId: resultTask?.taskId || task.taskId,
              status: resultTask?.status || task.status,
              blocks: resultTask?.result?.card
                ? [resultTask.result.card]
                : [{ type: "text", text: reply.content }],
            });
          }
          sendJson(res, message.wait && resultTask?.status === "succeeded" ? 200 : 202, {
            taskId: resultTask?.taskId || task.taskId,
            conversationId: conversation.conversationId,
            status: resultTask?.status || task.status,
            task: resultTask,
            message: assistantMessage,
            cards: resultTask?.result?.card ? [resultTask.result.card] : [],
          }, requestId);
          return;
        }

        if (url.pathname === "/api/v1/narratives/scan") {
          task = await manager.create("narrative.scan", validateNarrativeScan(body), requestId, policyForType("narrative.scan"));
        } else if (url.pathname === "/api/v1/narratives/generate") {
          task = await manager.create("narrative.generate", validateNarrativeGenerate(body), requestId, policyForType("narrative.generate"));
        } else if (url.pathname === "/api/v1/launch/packages") {
          task = await manager.create("launch.package", validateLaunchPackage(body), requestId, policyForType("launch.package"));
        } else if (url.pathname === "/api/v1/agent/tasks") {
          const command = validateAgentTask(body);
          task = await manager.create(command.type, command.input, requestId, command.metadata);
          sendJson(res, 202, toGoTask(task), requestId);
          return;
        } else if (url.pathname === "/api/v1/market/dev-wallets/scan") {
          const command = validateAgentTask({ type: "dev.market.scan", input: body });
          task = await manager.create(command.type, command.input, requestId, command.metadata);
          sendJson(res, 202, toGoTask(task), requestId);
          return;
        }
        if (task) {
          sendJson(res, 202, task, requestId);
          return;
        }
      }

      throw new ApiError(404, "ROUTE_NOT_FOUND", "API route was not found");
    } catch (error) {
      const statusCode = statusCodeFor(error);
      logger.error("request_failed", { requestId, method: req.method, path: url.pathname, code: error.code || "INTERNAL_ERROR", message: error.message });
      if (!res.headersSent) sendJson(res, statusCode, errorPayload(error, requestId), requestId);
      else res.end();
    } finally {
      if (url.pathname !== "/api/v1/events") {
        logger.info("request_completed", { requestId, method: req.method, path: url.pathname, statusCode: res.statusCode, durationMs: Date.now() - startedAt });
      }
    }
  });

  return {
    server,
    taskManager: manager,
    conversationRepository: conversations,
    devWalletRepository: devWallets,
    launchDraftRepository: launchDrafts,
    walletGroupRepository: walletGroups,
    transferRepository: transfers,
    close() {
      manager.close();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
