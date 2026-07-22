// @ts-nocheck
export class ApiError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorPayload(error, requestId) {
  const known = error instanceof ApiError || error?.name === "ExecutionError";
  const payload = {
    error: {
      code: known ? error.code : "INTERNAL_ERROR",
      message: known ? error.message : "An unexpected error occurred",
      requestId,
    },
  };
  if (known && error.details) payload.error.details = error.details;
  return payload;
}

export function statusCodeFor(error) {
  if (error instanceof ApiError) return error.statusCode;
  if (error?.name === "ExecutionError") return 502;
  return 500;
}
