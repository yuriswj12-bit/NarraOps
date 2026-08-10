import type { JsonSchema } from "../contracts/common.ts";

export interface SchemaIssue {
  path: string;
  message: string;
}

export class SchemaValidationError extends Error {
  readonly code = "SCHEMA_VALIDATION_FAILED";
  readonly issues: SchemaIssue[];

  constructor(label: string, issues: SchemaIssue[]) {
    super(`${label} failed schema validation: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "SchemaValidationError";
    this.issues = issues;
  }
}

export function validateJsonSchema(schema: JsonSchema, value: unknown, path = "$"): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  const type = schema.type;

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push({ path, message: `must be one of ${schema.enum.map(String).join(", ")}` });
    return issues;
  }

  if (type === "object") {
    if (!isObject(value)) return [{ path, message: "must be an object" }];
    const properties = isObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required.map(String) : [];
    for (const key of required) {
      if (!(key in value)) issues.push({ path: `${path}.${key}`, message: "is required" });
    }
    for (const [key, item] of Object.entries(value)) {
      const childSchema = properties[key];
      if (isObject(childSchema)) {
        issues.push(...validateJsonSchema(childSchema, item, `${path}.${key}`));
      } else if (schema.additionalProperties === false) {
        issues.push({ path: `${path}.${key}`, message: "is not allowed" });
      }
    }
    return issues;
  }

  if (type === "array") {
    if (!Array.isArray(value)) return [{ path, message: "must be an array" }];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      issues.push({ path, message: `must contain at least ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      issues.push({ path, message: `must contain at most ${schema.maxItems} items` });
    }
    if (isObject(schema.items)) {
      value.forEach((item, index) => issues.push(...validateJsonSchema(schema.items as JsonSchema, item, `${path}[${index}]`)));
    }
    return issues;
  }

  if (type === "string") {
    if (typeof value !== "string") return [{ path, message: "must be a string" }];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      issues.push({ path, message: `must contain at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      issues.push({ path, message: `must contain at most ${schema.maxLength} characters` });
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      issues.push({ path, message: `must match ${schema.pattern}` });
    }
    if (
      typeof schema.format === "string"
      && !matchesSupportedFormat(schema.format, value)
    ) {
      issues.push({ path, message: `must match ${schema.format} format` });
    }
    return issues;
  }

  if (type === "number" || type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (type === "integer" && !Number.isInteger(value))) {
      return [{ path, message: `must be ${type === "integer" ? "an integer" : "a number"}` }];
    }
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({ path, message: `must be at least ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({ path, message: `must be at most ${schema.maximum}` });
    }
    return issues;
  }

  if (type === "boolean" && typeof value !== "boolean") {
    issues.push({ path, message: "must be a boolean" });
  }
  if (type === "null" && value !== null) {
    issues.push({ path, message: "must be null" });
  }
  return issues;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function matchesSupportedFormat(format: string, value: string): boolean {
  if (format === "uuid") {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }
  if (format === "date-time") {
    return /^\d{4}-\d{2}-\d{2}T/.test(value)
      && Number.isFinite(Date.parse(value));
  }
  if (format === "uri") {
    try {
      const parsed = new URL(value);
      return Boolean(parsed.protocol && parsed.hostname);
    } catch {
      return false;
    }
  }
  // Unknown annotations stay non-assertive, matching JSON Schema's format
  // behavior while keeping the Runtime's supported security formats explicit.
  return true;
}
