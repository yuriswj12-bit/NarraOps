// @ts-nocheck
const PRIVATE_HOST = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1_000_000;

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
  const isSocial = /^(x|x\.com|twitter|twitter\.com|publish\.twitter\.com|t\.co)$/i.test(narrative.source_domain || "");
  return {
    name: token.name || null,
    symbol: token.symbol || normalized.toUpperCase(),
    description: token.description || null,
    image_url: token.image_url || narrative.image_url || null,
    x_url: token.x_url || (isSocial ? narrative.url : null),
    telegram_url: token.telegram_url || null,
    website_url: token.website_url || (!isSocial ? narrative.url : null),
    initial_buy: token.initial_buy || "0",
  };
}

export async function fetchNarrativeLink(rawUrl, { fetchImpl = globalThis.fetch, timeoutMs = 8_000 } = {}) {
  const prepared = prepareNarrativeLink(rawUrl);
  if (!prepared.url || prepared.status !== "metadata_fetch_pending") return prepared;
  let currentUrl = prepared.url;
  try {
    if (isXUrl(currentUrl)) {
      const xResult = await fetchXPost(currentUrl, { fetchImpl, timeoutMs });
      if (xResult.status === "live") return { ...prepared, ...xResult, url: currentUrl };
      return { ...prepared, ...xResult, url: currentUrl };
    }
    const page = await fetchPublicPage(currentUrl, { fetchImpl, timeoutMs });
    if (page.status !== "live") return { ...prepared, ...page, url: currentUrl };
    const metadata = parseHtmlMetadata(page.body, currentUrl);
    return {
      ...prepared,
      status: metadata.content || metadata.title || metadata.summary ? "live" : "partial",
      fetched: true,
      fetched_at: new Date().toISOString(),
      title: metadata.title,
      summary: metadata.summary,
      content: metadata.content,
      author_name: metadata.author_name,
      image_url: metadata.image_url,
      canonical_url: metadata.canonical_url || currentUrl,
      content_type: page.content_type,
      ...(metadata.content || metadata.title || metadata.summary ? {} : { reason: "public_page_has_no_extractable_text" }),
    };
  } catch (error) {
    return {
      ...prepared,
      status: error?.code === "UNSAFE_REDIRECT" ? "rejected" : "unavailable",
      fetched: false,
      reason: error?.code === "UNSAFE_REDIRECT" ? "unsafe_redirect" : "public_content_fetch_failed",
      error_detail: safeFetchError(error),
    };
  }
}

async function fetchXPost(url, { fetchImpl, timeoutMs }) {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
  const response = await fetchPublicPage(oembedUrl, { fetchImpl, timeoutMs, accept: "application/json" });
  if (response.status !== "live") return response;
  let payload;
  try { payload = JSON.parse(response.body); } catch { return { status: "unavailable", reason: "x_oembed_invalid_json" }; }
  const content = stripXEmbedHtml(payload.html || "");
  if (!content) return { status: "unavailable", reason: "x_post_text_unavailable" };
  const author = String(payload.author_name || "").trim();
  const enhanced = shouldEnhanceXPost(payload.html, content)
    ? await fetchFxTwitterPost(url, { fetchImpl, timeoutMs }).catch(() => null)
    : null;
  return {
    status: "live",
    fetched: true,
    fetched_at: new Date().toISOString(),
    title: author ? `X post by ${author}` : "X post",
    summary: String(enhanced?.content || content).slice(0, 500),
    content: enhanced?.content || content,
    author_name: author || null,
    author_url: payload.author_url || null,
    image_url: enhanced?.image_url || null,
    canonical_url: url,
    content_type: "application/json+oembed",
    fetch_method: enhanced ? "twitter_oembed+fxtwitter" : "twitter_oembed",
  };
}

async function fetchFxTwitterPost(url, { fetchImpl, timeoutMs }) {
  const postId = new URL(url).pathname.match(/\/status\/(\d+)/)?.[1];
  if (!postId) return null;
  const response = await fetchPublicPage(`https://api.fxtwitter.com/status/${postId}`, {
    fetchImpl,
    timeoutMs,
    accept: "application/json",
  });
  if (response.status !== "live") return null;
  const payload = JSON.parse(response.body);
  const tweet = payload?.tweet;
  const content = String(tweet?.text || "").trim();
  if (!content) return null;
  const media = Array.isArray(tweet?.media?.all) ? tweet.media.all : [];
  const image = media.find((item) => item?.type === "photo" && item?.url)?.url
    || media.find((item) => item?.thumbnail_url)?.thumbnail_url
    || tweet?.media?.mosaic?.formats?.jpeg
    || tweet?.card?.image?.url;
  return {
    content,
    image_url: absoluteUrl(image, url),
  };
}

function shouldEnhanceXPost(html, content) {
  return /pic\.twitter\.com|t\.co\//i.test(String(html || ""))
    || /…|\.\.\.$/.test(String(content || "").trim());
}

async function fetchPublicPage(rawUrl, { fetchImpl, timeoutMs, accept = "text/html" } = {}) {
  let currentUrl = rawUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    assertSafeUrl(currentUrl);
    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept,
        "user-agent": "NarraOps/1.0 public-narrative-reader",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers?.get?.("location");
      if (!location || redirect === MAX_REDIRECTS) return { status: "unavailable", reason: "redirect_limit_exceeded" };
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) return { status: "unavailable", reason: `public_http_${response.status}` };
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return { status: "unavailable", reason: "public_page_too_large" };
    return {
      status: "live",
      body,
      content_type: response.headers?.get?.("content-type") || null,
      final_url: currentUrl,
    };
  }
  return { status: "unavailable", reason: "redirect_limit_exceeded" };
}

function parseHtmlMetadata(html, sourceUrl) {
  const meta = {};
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const name = (attribute(tag, "property") || attribute(tag, "name") || "").toLowerCase();
    const content = attribute(tag, "content");
    if (!name || !content) continue;
    if (["og:title", "twitter:title"].includes(name) && !meta.title) meta.title = content;
    if (["og:description", "twitter:description", "description"].includes(name) && !meta.summary) meta.summary = content;
    if (["og:image", "twitter:image"].includes(name) && !meta.image_url) meta.image_url = absoluteUrl(content, sourceUrl);
    if (["author", "twitter:creator"].includes(name) && !meta.author_name) meta.author_name = content;
    if (["og:url", "twitter:url"].includes(name) && !meta.canonical_url) meta.canonical_url = absoluteUrl(content, sourceUrl);
  }
  meta.title ||= decodeEntities(String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim() || null;
  meta.content = meta.summary || null;
  return meta;
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeEntities(match[1]).trim() : null;
}

function stripHtml(value) {
  return decodeEntities(String(value || "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function stripXEmbedHtml(value) {
  const html = String(value || "");
  const postBody = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || html;
  return stripHtml(postBody);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function absoluteUrl(value, base) {
  try { return new URL(value, base).toString(); } catch { return null; }
}

function isXUrl(value) {
  try { return /(^|\.)((x|twitter)\.com)$/i.test(new URL(value).hostname); } catch { return false; }
}

function assertSafeUrl(value) {
  const parsed = new URL(value);
  if (!["https:", "http:"].includes(parsed.protocol) || PRIVATE_HOST.test(parsed.hostname)) {
    const error = new Error("unsafe redirect");
    error.code = "UNSAFE_REDIRECT";
    throw error;
  }
}

function safeFetchError(error) {
  return String(error?.name || error?.message || "fetch_error").replace(/\s+/g, " ").slice(0, 160);
}
