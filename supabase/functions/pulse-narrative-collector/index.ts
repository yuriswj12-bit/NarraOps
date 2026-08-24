import { createClient } from "npm:@supabase/supabase-js@2.55.0";

const SOURCE_WINDOW_MS = 4 * 60 * 60 * 1000;
const DISPLAY_WINDOW_MS = 4 * 60 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const OPENNEWS_BASE = "https://ai.6551.io/open/free_hot";
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const GENERIC_AUTHORS = new Set(["twitter", "x", "google news", "rss", "news"]);
const JUNK_NARRATIVE = /\b(weather|forecast|thunderstorm|rainfall|flood warning|obituar\w*|funeral|killed in crash|died at the age|gaap|earnings call|quarterly (?:results|revenue)|10-k|10-q|unemployment|job market|graduates face|100x|10,000%|10000%|missed (?:shib|floki)|next \d+x meme|price today|to usd live price)\b/i;

const openNewsQueries = [
  ["opennews-web3-meme", "web3", "meme", "crypto_native"],
  ["opennews-web3", "web3", "", "events"],
  ["opennews-ai", "ai", "", "internet_culture"],
] as const;

const categoryTerms = {
  politics_satire: ["president", "election", "government", "trump", "congress", "minister", "politic", "satire", "senator", "parliament", "white house", "campaign"],
  animals_characters: ["cat", "dog", "raccoon", "penguin", "animal", "mascot", "character", "zoo", "puppy", "kitten", "frog", "bear", "otter"],
  internet_culture: ["viral", "meme", "internet", "creator", "streamer", "celebrity", "trend", "tiktok", "youtube", "influencer", "fandom", "cosplay"],
  crypto_native: ["crypto", "bitcoin", "ethereum", "solana", "token", "defi", "blockchain", "memecoin", "airdrop", "nft", "web3", "wallet", "pump"],
} as const;

function routeCategory(text: string, fallback: string) {
  const normalized = text.toLowerCase();
  let selected = fallback;
  let selectedCount = 0;
  for (const [category, terms] of Object.entries(categoryTerms)) {
    const count = terms.reduce((sum, term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\]/g, "\$&");
      return sum + (new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, "i").test(normalized) ? 1 : 0);
    }, 0);
    if (count > selectedCount) {
      selected = category;
      selectedCount = count;
    }
  }
  if (selectedCount > 0) return selected;
  return fallback || "events";
}

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isXSourceUrl(url: string) {
  const host = hostnameOf(url);
  return X_HOSTS.has(host) || host.endsWith(".x.com") || host.endsWith(".twitter.com");
}

function xHandleFromUrl(url: string) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length >= 3 && parts[1].toLowerCase() === "status") {
      const handle = parts[0];
      if (!["i", "intent", "share", "search"].includes(handle.toLowerCase())) return handle;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function displayAuthor(authorName: string, sourceUrl: string) {
  const handle = xHandleFromUrl(sourceUrl);
  const generic = GENERIC_AUTHORS.has(String(authorName || "").trim().toLowerCase().replace(/^@/, ""));
  if (handle && (generic || !String(authorName || "").trim())) return handle;
  return String(authorName || handle || "").trim();
}

function isDisplayableNarrative(text: string, sourceUrl: string) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length < 8) return false;
  if (!isXSourceUrl(sourceUrl)) return false;
  if (JUNK_NARRATIVE.test(normalized)) return false;
  return true;
}

function cleanText(value: string) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchOpenNewsX(
  sourceId: string,
  category: string,
  subcategory: string,
  categoryHint: string,
  now: Date,
) {
  const params = new URLSearchParams({ category });
  if (subcategory) params.set("subcategory", subcategory);
  const response = await fetch(`${OPENNEWS_BASE}?${params}`, {
    headers: { "User-Agent": "NarraOps-Pulse/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${sourceId} returned ${response.status}`);
  const payload = await response.json();
  if (payload?.success !== true) throw new Error(`${sourceId} was unsuccessful`);
  const items = [
    ...((payload.news && payload.news.items) || []),
    ...((payload.tweets && payload.tweets.items) || []),
  ].filter((item) => item && typeof item === "object");
  const rows = [];
  for (const item of items) {
    const sourceUrl = String(item.link || "").trim();
    const title = cleanText(String(item.title || ""));
    const publishedAt = new Date(item.published_at || item.created_at || "");
    const ageMs = now.getTime() - publishedAt.getTime();
    if (!isDisplayableNarrative(title, sourceUrl)) continue;
    if (!Number.isFinite(publishedAt.getTime()) || ageMs < 0 || ageMs >= SOURCE_WINDOW_MS) continue;
    const fingerprint = await sha256(`x\0${sourceUrl.toLowerCase().replace(/\/$/, "")}\0${title.toLowerCase()}`);
    const expiresAt = new Date(Math.min(
      publishedAt.getTime() + SOURCE_WINDOW_MS,
      now.getTime() + DISPLAY_WINDOW_MS,
    ));
    rows.push({
      narrative_id: `nar_${fingerprint.slice(0, 20)}`,
      category: routeCategory(title, categoryHint),
      platform: "x",
      source_type: "trend_discovery",
      author_name: displayAuthor(String(item.source || ""), sourceUrl),
      original_text: title,
      source_url: sourceUrl,
      media_type: null,
      media_urls: [],
      video_thumbnail_url: null,
      published_at: publishedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      content_fingerprint: fingerprint,
      collected_at: now.toISOString(),
      updated_at: now.toISOString(),
      source_id: sourceId,
    });
  }
  return rows;
}


Deno.serve(async (request) => {
  const expectedSecret = Deno.env.get("PULSE_NARRATIVE_COLLECTOR_SECRET");
  if (!expectedSecret || request.headers.get("x-narraops-collector-secret") !== expectedSecret) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: "collector is not configured" }, { status: 503 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const startedAt = new Date();
  const bucket = new Date(Math.floor(startedAt.getTime() / BUCKET_MS) * BUCKET_MS).toISOString();
  const { error: leaseError } = await supabase
    .from("pulse_narrative_collection_leases")
    .insert({ bucket_started_at: bucket });
  if (leaseError?.code === "23505") {
    return Response.json({ status: "skipped", reason: "already_collected", bucket });
  }
  if (leaseError) throw leaseError;

  const sourceResults = await Promise.all(openNewsQueries.map(async ([sourceId, category, subcategory, categoryHint]) => {
    try {
      const rows = await fetchOpenNewsX(sourceId, category, subcategory, categoryHint, startedAt);
      return {
        rows,
        status: { source_id: sourceId, status: "success", items: rows.length },
      };
    } catch (error) {
      return {
        rows: [],
        status: {
          source_id: sourceId,
          status: "unavailable",
          error_type: error instanceof Error ? error.name : "Error",
          error_message: error instanceof Error ? error.message.slice(0, 160) : "unknown error",
          items: 0,
        },
      };
    }
  }));
  const statuses = sourceResults.map((result) => result.status);
  const collected = sourceResults.flatMap((result) => result.rows);

  const uniqueRows = [...new Map(collected.map((row) => [row.narrative_id, row])).values()]
    .map(({ source_id: _sourceId, ...row }) => row);
  if (uniqueRows.length) {
    const { error } = await supabase
      .from("pulse_narrative_candidates")
      .upsert(uniqueRows, { onConflict: "narrative_id" });
    if (error) throw error;
  }
  await supabase
    .from("pulse_narrative_candidates")
    .delete()
    .lt("expires_at", startedAt.toISOString());

  const successful = statuses.filter((status) => status.status === "success").length;
  const runStatus = successful === statuses.length ? "completed" : successful ? "partial" : "failed";
  const completedAt = new Date();
  await supabase.from("pulse_narrative_collection_runs").insert({
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    status: runStatus,
    source_count: statuses.length,
    successful_source_count: successful,
    collected_item_count: uniqueRows.length,
    eligible_item_count: uniqueRows.length,
    source_status: statuses,
  });

  const categoryCounts = uniqueRows.reduce((acc, row) => {
    acc[row.category] = (acc[row.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Response.json({
    status: runStatus,
    collected_item_count: uniqueRows.length,
    eligible_item_count: uniqueRows.length,
    source_count: statuses.length,
    successful_source_count: successful,
    category_counts: categoryCounts,
    source_status: statuses,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    next_due_at: new Date(startedAt.getTime() + BUCKET_MS).toISOString(),
  });
});
