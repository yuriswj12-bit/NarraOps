const SECRET_KEY_PATTERN = /^(authorization|cookie|set-cookie|token|access_?token|refresh_?token|api_?key|private_?key|secret_?key|mnemonic|seed|seed_?phrase)$/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(entry),
    ]),
  );
}

export function containsForbiddenSecret(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenSecret);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) => SECRET_KEY_PATTERN.test(key) || containsForbiddenSecret(entry),
  );
}

export function createLogger(level = "info") {
  const enabled = level !== "silent";
  return {
    info(message, metadata = {}) {
      if (enabled) console.log(JSON.stringify({ level: "info", message, ...redact(metadata) }));
    },
    error(message, metadata = {}) {
      if (enabled) console.error(JSON.stringify({ level: "error", message, ...redact(metadata) }));
    },
  };
}
