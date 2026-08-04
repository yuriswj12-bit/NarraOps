export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  message?: string;
}

export class NarraOpsApiError extends Error {
  readonly code?: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error?.message ?? payload.message ?? `HTTP ${status}`);
    this.name = "NarraOpsApiError";
    this.code = payload.error?.code;
    this.details = payload.error?.details;
    this.status = status;
  }
}

export type ApiRequestOptions = RequestInit & {
  timeoutMs?: number;
};

export async function apiRequest<T = Record<string, unknown>>(
  path: `/api/v1${string}`,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { timeoutMs = 20_000, ...requestOptions } = options;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abortFromCaller();
  else options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      ...requestOptions,
      signal: controller.signal,
      credentials: options.credentials ?? "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted) {
      throw new Error("The request timed out. Please retry.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }

  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) throw new NarraOpsApiError(response.status, payload);
  return payload;
}
