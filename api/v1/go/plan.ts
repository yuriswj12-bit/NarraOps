import { REVIEWED_PULSE_SNAPSHOT } from "../pulse-snapshot";
import { buildPulsePlanResponse } from "./pulse-plan";

function sendJson(response, status, body, headers = {}) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value);
  }
  response.end(JSON.stringify(body));
}

function apiError(response, status, code, message) {
  return sendJson(response, status, {
    error: { code, message },
  });
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string" && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("allow", "POST");
    return apiError(response, 405, "METHOD_NOT_ALLOWED", "Only POST is supported");
  }

  const body = await readBody(request);
  const result = buildPulsePlanResponse(REVIEWED_PULSE_SNAPSHOT, {
    opportunityId: body.opportunityId || body.opportunity_id || null,
    message: body.message || body.input || null,
    command: body.command || null,
  });

  if (!result.ok) {
    return apiError(response, result.status, result.code, result.message);
  }

  return sendJson(response, 200, result.body, {
    "cache-control": "no-store",
  });
}
