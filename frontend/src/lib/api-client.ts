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

export async function apiRequest<T = Record<string, unknown>>(
  path: `/api/v1${string}`,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: options.credentials ?? "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) throw new NarraOpsApiError(response.status, payload);
  return payload;
}
