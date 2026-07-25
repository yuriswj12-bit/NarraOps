// @ts-nocheck
export async function requestJson(url, options = {}, policy = {}) {
  const timeoutMs = policy.timeoutMs ?? 5_000;
  const maxRetries = policy.maxRetries ?? 1;
  const requestId = policy.requestId;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...options.headers,
          ...(requestId ? { "x-request-id": requestId } : {}),
        },
      });
      if (!response.ok) {
        const error = new Error(`External service returned HTTP ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = error.name === "AbortError" || error.retryable || error instanceof TypeError;
      if (!retryable || attempt === maxRetries) break;
    } finally {
      clearTimeout(timeout);
    }
  }

  const safeError = new Error(lastError?.name === "AbortError" ? "External request timed out" : "External request failed");
  safeError.code = lastError?.name === "AbortError" ? "EXTERNAL_TIMEOUT" : "EXTERNAL_REQUEST_FAILED";
  throw safeError;
}
