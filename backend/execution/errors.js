export class ExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ExecutionError";
    this.code = code;
    this.details = details;
  }
}

