import http from "node:http";
import { randomUUID } from "node:crypto";
import { ApiError, errorPayload } from "./errors.mjs";
import {
  validateAgentTask,
  validateLaunchPackage,
  validateNarrativeGenerate,
  validateNarrativeScan,
} from "./validation.mjs";
import { InMemoryTaskRepository } from "./repositories/in-memory-task-repository.mjs";
import { TaskManager } from "../../agents/task-manager.mjs";
import { createMockHandlers } from "../../agents/mock-handlers.mjs";
import { createIntegrationRegistry } from "../../integrations/registry.mjs";

function sendJson(res, statusCode, payload, requestId) {
  const body = statusCode === 204 ? "" : JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-request-id": requestId,
    "x-content-type-options": "nosniff",
  });
  res.end(body);
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

function startSse(req, res, manager, config, requestId) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
    "x-request-id": requestId,
  });
  res.write(": connected\n\n");

  const listener = (event) => {
    res.write(`id: ${event.eventId}\n`);
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.task)}\n\n`);
  };
  manager.on("taskEvent", listener);
  const heartbeat = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), config.sseHeartbeatMs);
  const cleanup = () => {
    clearInterval(heartbeat);
    manager.off("taskEvent", listener);
  };
  req.once("close", cleanup);
  res.once("close", cleanup);
}

export function createApplication({ config, logger, repository, integrations, taskManager } = {}) {
  const registry = integrations || createIntegrationRegistry();
  const repo = repository || new InMemoryTaskRepository();
  const manager = taskManager || new TaskManager({
    repository: repo,
    handlers: createMockHandlers(registry),
    stepDelayMs: config.taskStepDelayMs,
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
          mode: "mock",
          time: new Date().toISOString(),
          integrations: registry.list(),
        }, requestId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/v1/events") {
        startSse(req, res, manager, config, requestId);
        return;
      }

      const taskMatch = req.method === "GET" && url.pathname.match(/^\/api\/v1\/agent\/tasks\/([0-9a-f-]{36})$/i);
      if (taskMatch) {
        const task = manager.get(taskMatch[1]);
        if (!task) throw new ApiError(404, "TASK_NOT_FOUND", "Agent task was not found");
        sendJson(res, 200, task, requestId);
        return;
      }

      if (req.method === "POST") {
        const body = await readJson(req, config.bodyLimitBytes);
        let task;
        if (url.pathname === "/api/v1/narratives/scan") {
          task = manager.create("narrative.scan", validateNarrativeScan(body), requestId);
        } else if (url.pathname === "/api/v1/narratives/generate") {
          task = manager.create("narrative.generate", validateNarrativeGenerate(body), requestId);
        } else if (url.pathname === "/api/v1/launch/packages") {
          task = manager.create("launch.package", validateLaunchPackage(body), requestId);
        } else if (url.pathname === "/api/v1/agent/tasks") {
          const command = validateAgentTask(body);
          task = manager.create(command.type, command.input, requestId);
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
    close() {
      manager.close();
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
