import http from "node:http";
import { randomUUID } from "node:crypto";
import { ApiError, errorPayload } from "./errors.mjs";
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
} from "./validation.mjs";
import { InMemoryTaskRepository } from "./repositories/in-memory-task-repository.mjs";
import { InMemoryConversationRepository } from "./repositories/in-memory-conversation-repository.mjs";
import { InMemoryDevWalletRepository } from "./repositories/in-memory-dev-wallet-repository.mjs";
import { InMemoryLaunchDraftRepository } from "./repositories/in-memory-launch-draft-repository.mjs";
import { InMemoryWalletGroupRepository } from "./repositories/in-memory-wallet-group-repository.mjs";
import { InMemoryTransferRepository } from "./repositories/in-memory-transfer-repository.mjs";
import { TaskManager } from "../../agents/task-manager.mjs";
import { createMockHandlers } from "../../agents/mock-handlers.mjs";
import { createIntegrationRegistry } from "../../integrations/registry.mjs";
import { mockInviteSummary, mockPulse, mockSettings } from "../../integrations/mock-product-data.mjs";
import { GO_CATEGORIES, GO_COMMANDS, policyForType } from "../../agents/go-command-catalog.mjs";
import { EXECUTION_SIMULATION_STATUSES, EXECUTION_SIMULATION_TYPES } from "../../agents/execution-simulator.mjs";
import { listLaunchPlatforms, resolveLaunchPlatform } from "../../integrations/launch-platform-registry.mjs";
import { buildDraftMetadata, prepareNarrativeLink } from "../../integrations/narrative-link-adapter.mjs";
import { walletCapabilities } from "../../integrations/wallet-provider-registry.mjs";
import { mockAccountPortfolio } from "../../integrations/mock-account-data.mjs";

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

export function createApplication({ config, logger, repository, conversationRepository, devWalletRepository, launchDraftRepository, walletGroupRepository, transferRepository, integrations, taskManager, launchService, walletProvisioningService, launchCoordinator, assetService, authService } = {}) {
  const registry = integrations || createIntegrationRegistry(config);
  const repo = repository || new InMemoryTaskRepository();
  const devWallets = devWalletRepository || new InMemoryDevWalletRepository();
  const conversations = conversationRepository || new InMemoryConversationRepository();
  const launchDrafts = launchDraftRepository || new InMemoryLaunchDraftRepository();
  const walletGroups = walletGroupRepository || new InMemoryWalletGroupRepository({ seed: !walletProvisioningService });
  const transfers = transferRepository || new InMemoryTransferRepository({ walletGroupRepository: walletGroups, assetService });
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
  const livePortfolio = async (period) => {
    const groups = await Promise.all(walletGroups.listGroups().map(groupWithBalances));
    const totals = {};
    for (const group of groups) for (const [asset, amount] of Object.entries(group.balances || {})) {
      totals[asset] = addDecimalStrings(totals[asset] || "0", amount);
    }
    return { mode: "live", period, balances: totals, turnover: null, realizedPnl: null, unrealizedPnl: null, pnlPercent: null, history: [], dataStatus: "live_native_balances", updatedAt: new Date().toISOString() };
  };
  const manager = taskManager || new TaskManager({
    repository: repo,
    handlers: createMockHandlers(registry, { devWalletRepository: devWallets, launchDraftRepository: launchDrafts }),
    stepDelayMs: config.taskStepDelayMs,
  });

  manager.on("taskEvent", (event) => {
    if (event.type !== "task.completed" && event.type !== "task.failed") return;
    const task = event.task;
    const conversationId = conversations.conversationIdForTask(task?.taskId);
    if (!conversationId) return;
    if (event.type === "task.completed") {
      conversations.addMessage(conversationId, {
        role: "assistant",
        taskId: task.taskId,
        status: "completed",
        blocks: task.result?.card ? [task.result.card] : [{ type: "text", text: "Task completed" }],
      });
    } else {
      conversations.addMessage(conversationId, {
        role: "assistant",
        taskId: task.taskId,
        status: "failed",
        blocks: [{ type: "error", error: task.failure }],
      });
    }
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
          mode: config.gmgnLiveEnabled || config.hertzflowLiveEnabled ? "hybrid" : "mock",
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
        const conversation = conversations.get(conversationMatch[1]);
        if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
        sendJson(res, 200, conversation, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/agent/commands") {
        sendJson(res, 200, { categories: GO_CATEGORIES, commands: GO_COMMANDS }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/account/portfolio") {
        const period = validatePortfolioPeriod(url.searchParams.get("period"));
        sendJson(res, 200, assetService ? await livePortfolio(period) : mockAccountPortfolio(period), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallet-groups") {
        sendJson(res, 200, { mode: walletGroups.mode(), balanceMode: assetService ? "live" : "unavailable", groups: await Promise.all(walletGroups.listGroups().map(groupWithBalances)) }, requestId);
        return;
      }

      const groupWalletsMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/wallets$/i);
      if (groupWalletsMatch) {
        const group = walletGroups.getGroup(groupWalletsMatch[1]);
        if (!group) throw new ApiError(404, "WALLET_GROUP_NOT_FOUND", "Wallet group was not found");
        sendJson(res, 200, { mode: walletGroups.mode(), balanceMode: assetService ? "live" : "unavailable", group: await groupWithBalances(group), wallets: await walletsWithBalances(group.groupId) }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/pulse") {
        sendJson(res, 200, mockPulse(), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/launch/platforms") {
        sendJson(res, 200, { execution_enabled: false, platforms: listLaunchPlatforms() }, requestId);
        return;
      }

      const launchDraftMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/launch\/drafts\/([0-9a-f-]{36})$/i);
      if (launchDraftMatch) {
        const draft = launchDrafts.get(launchDraftMatch[1]);
        if (!draft) throw new ApiError(404, "LAUNCH_DRAFT_NOT_FOUND", "Launch draft was not found");
        sendJson(res, 200, draft, requestId);
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
        sendJson(res, 200, mockInviteSummary(), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/settings") {
        sendJson(res, 200, mockSettings(), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/wallets/capabilities") {
        sendJson(res, 200, walletCapabilities(config), requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/execution/capabilities") {
        sendJson(res, 200, {
          execution_enabled: Boolean(config.realExecutionEnabled),
          native_assets: assetService ? { balances: ["SOL", "BNB"], deposits: true, withdrawals: config.realExecutionEnabled, wallet_group_transfers: config.realExecutionEnabled } : null,
          simulation_types: EXECUTION_SIMULATION_TYPES,
          statuses: EXECUTION_SIMULATION_STATUSES,
          signing: assetService ? "encrypted_vault" : "signing_disabled",
          broadcasting: config.realExecutionEnabled ? "enabled" : "broadcasting_disabled",
        }, requestId);
        return;
      }

      const taskMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/agent\/tasks\/([0-9a-f-]{36})$/i);
      if (taskMatch) {
        const task = manager.get(taskMatch[1]);
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
          const input = validateWalletGroupCreate(body);
          const group = walletGroups.createGroup(input);
          if (walletProvisioningService) {
            for (const wallet of walletGroups.listWallets(group.groupId)) {
              walletGroups.activateWallet(wallet.walletId, await walletProvisioningService.provision({ walletId: wallet.walletId }));
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
          const input = validateWalletAdd(body);
          const created = walletGroups.addWallets(addWalletsMatch[1], input.count);
          if (walletProvisioningService) {
            for (const wallet of created) walletGroups.activateWallet(wallet.walletId, await walletProvisioningService.provision({ walletId: wallet.walletId }));
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
          const input = validateWalletBatchDelete(body);
          const result = input.confirm
            ? walletGroups.confirmBatchDelete(batchDeleteMatch[1], input, requestId)
            : walletGroups.previewBatchDelete(batchDeleteMatch[1], input.walletIds, requestId);
          sendJson(res, input.confirm ? 200 : 202, result, requestId);
          return;
        }

        const exportMatch = url.pathname.match(/^\/api\/v1\/wallet-groups\/([0-9a-f-]{36})\/exports$/i);
        if (exportMatch) {
          const groupId = exportMatch[1];
          if (!walletGroups.getGroup(groupId)) throw new ApiError(404, "WALLET_GROUP_NOT_FOUND", "Wallet group was not found");
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
          walletGroups.recordExportAttempt({ requestId, groupId, outcome: "export_service_disabled" });
          throw new ApiError(503, "WALLET_EXPORT_DISABLED", "One-time encrypted wallet export is disabled until the isolated custody service and immutable audit store pass security review", {
            ordinaryJsonResponseAllowed: false,
            requiresOneTimeEncryptedDownload: true,
            privateKeyMaterialReturned: false,
          });
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
          const conversation = conversations.create(context);
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
          const draft = launchDrafts.create({
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
          const conversation = conversations.get(messageMatch[1]);
          if (!conversation) throw new ApiError(404, "CONVERSATION_NOT_FOUND", "Agent conversation was not found");
          const message = validateConversationMessage(body);
          conversations.addMessage(conversation.conversationId, {
            role: "user",
            content: message.message,
            command: message.command,
          });
          const parsed = validateAgentTask({
            ...(message.command ? { command: message.command } : { input: message.message }),
            parameters: { context: message.context },
          });
          task = manager.create(parsed.type, parsed.input, requestId, {
            ...parsed.metadata,
            conversation_id: conversation.conversationId,
          });
          conversations.bindTask(conversation.conversationId, task.taskId);
          sendJson(res, 202, {
            taskId: task.taskId,
            conversationId: conversation.conversationId,
            status: task.status,
          }, requestId);
          return;
        }

        if (url.pathname === "/api/v1/narratives/scan") {
          task = manager.create("narrative.scan", validateNarrativeScan(body), requestId, policyForType("narrative.scan"));
        } else if (url.pathname === "/api/v1/narratives/generate") {
          task = manager.create("narrative.generate", validateNarrativeGenerate(body), requestId, policyForType("narrative.generate"));
        } else if (url.pathname === "/api/v1/launch/packages") {
          task = manager.create("launch.package", validateLaunchPackage(body), requestId, policyForType("launch.package"));
        } else if (url.pathname === "/api/v1/agent/tasks") {
          const command = validateAgentTask(body);
          task = manager.create(command.type, command.input, requestId, command.metadata);
          sendJson(res, 202, toGoTask(task), requestId);
          return;
        } else if (url.pathname === "/api/v1/market/dev-wallets/scan") {
          const command = validateAgentTask({ type: "dev.market.scan", input: body });
          task = manager.create(command.type, command.input, requestId, command.metadata);
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
      const statusCode = error instanceof ApiError ? error.statusCode : 500;
      logger.error("request_failed", { requestId, method: req.method, path: url.pathname, code: error.code || "INTERNAL_ERROR" });
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
