// @ts-nocheck
const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

export function prepareNarrativeLink(rawUrl) {
  if (!rawUrl) return { status: "not_provided", url: null };
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { status: "invalid", url: null, reason: "invalid_url" };
  }
  if (!["https:", "http:"].includes(parsed.protocol) || PRIVATE_HOST.test(parsed.hostname)) {
    return { status: "rejected", url: null, reason: "unsafe_or_unsupported_url" };
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return {
    status: "metadata_fetch_pending",
    url: parsed.toString(),
    source_domain: parsed.hostname.toLowerCase(),
    fetched: false,
    note: "Content fetching and AI enrichment require a configured provider",
  };
}

export function buildDraftMetadata({ narrative, token = {} }) {
  const domainSeed = narrative.source_domain?.split(".")[0] || "narra";
  const normalized = domainSeed.replace(/[^a-z0-9]/gi, "").slice(0, 10) || "narra";
  return {
    name: token.name || null,
    symbol: token.symbol || normalized.toUpperCase(),
    description: token.description || null,
    image_url: token.image_url || null,
    x_url: token.x_url || null,
    website_url: token.website_url || narrative.url || null,
  };
}
