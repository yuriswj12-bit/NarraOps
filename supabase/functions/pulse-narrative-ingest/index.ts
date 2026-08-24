import { createClient } from "npm:@supabase/supabase-js@2.55.0";

// Ingest endpoint for external account-monitor scripts (Playwright or any
// collector that watches fixed X accounts). The script normalizes tweets into
// cards and POSTs them here; this function validates, assigns lifecycle fields,
// upserts into pulse_narrative_candidates, and records a collection run.
//
// Auth: header `x-narraops-collector-secret` must equal PULSE_NARRATIVE_COLLECTOR_SECRET.
// Body: { items: SourceCard[], source_id?: string }
//   SourceCard = {
//     platform: "x",
//     source_type: "monitored_account",
//     author_name: string,
//     original_text: string,
//     source_url: string,          // https://x.com/<handle>/status/<id>
//     media_urls?: string[],
//     published_at: string,        // ISO-8601 with timezone
//     category_hint?: string,      // one of the 5 categories
//     collected_at?: string,
//   }

const PLATFORMS = new Set(["x", "news", "rss"]);
const SOURCE_TYPES = new Set(["monitored_account", "trend_discovery", "public_feed"]);
const CATEGORIES = new Set([
  "politics_satire",
  "events",
  "animals_characters",
  "internet_culture",
  "crypto_native",
]);
const SOURCE_WINDOW_MS = 4 * 60 * 60 * 1000;
const DISPLAY_WINDOW_MS = 4 * 60 * 60 * 1000;
const MAX_ITEMS = 200;

const CATEGORY_TERMS: Record<string, string[]> = {
  politics_satire: ["president", "election", "government", "trump", "congress", "minister", "politic", "satire", "senator", "parliament", "white house", "campaign"],
  animals_characters: ["cat", "dog", "raccoon", "penguin", "animal", "mascot", "character", "zoo", "puppy", "kitten", "frog", "bear", "otter"],
  internet_culture: ["viral", "meme", "internet", "creator", "streamer", "celebrity", "trend", "tiktok", "youtube", "influencer", "fandom", "cosplay"],
  crypto_native: ["crypto", "bitcoin", "ethereum", "solana", "token", "defi", "blockchain", "memecoin", "airdrop", "nft", "web3", "wallet", "pump"],
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function routeCategory(text: string, fallback: string | null) {
  const normalized = String(text || "").toLowerCase();
  let selected = "";
  let selectedCount = 0;
  for (const [category, terms] of Object.entries(CATEGORY_TERMS)) {
    const count = terms.reduce((sum, term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return sum + (new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, "i").test(normalized) ? 1 : 0);
    }, 0);
    if (count > selectedCount) {
      selected = category;
      selectedCount = count;
    }
  }
  if (selectedCount > 0) return selected;
  if (fallback && CATEGORIES.has(fallback) && fallback !== "events") return fallback;
  return "events";
}

function parseIso(value: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("published_at must be a valid ISO timestamp");
  return parsed;
}

function isValidXUrl(value: string) {
  try {
    const url = new URL(value);
    return /(^|\.)x\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function normalizeCard(input: Record<string, unknown>, sourceId: string, now: Date) {
  const platform = String(input.platform || "x");
  if (!PLATFORMS.has(platform)) throw new Error(`unsupported platform: ${platform}`);
  const sourceType = String(input.source_type || "monitored_account");
  if (!SOURCE_TYPES.has(sourceType)) throw new Error(`unsupported source_type: ${sourceType}`);
  const authorName = String(input.author_name || "").trim();
  const originalText = String(input.original_text || "").trim();
  const sourceUrl = String(input.source_url || "").trim();
  const publishedAt = parseIso(String(input.published_at || ""));
  if (!authorName) throw new Error("author_name is required");
  if (!originalText) throw new Error("original_text cannot be empty");
  if (!sourceUrl) throw new Error("source_url is required");
  if (platform === "x" && !isValidXUrl(sourceUrl)) throw new Error("x source_url must be an x.com link");
  const ageMs = now.getTime() - publishedAt.getTime();
  if (ageMs < 0 || ageMs >= SOURCE_WINDOW_MS) throw new Error("source is outside the four-hour eligibility window");

  const category = routeCategory(originalText, input.category_hint ? String(input.category_hint) : null);
  const fingerprint = await sha256(`${platform}\0${sourceId}\0${originalText.toLowerCase()}`);
  const expiresAt = new Date(Math.min(
    publishedAt.getTime() + SOURCE_WINDOW_MS,
    now.getTime() + DISPLAY_WINDOW_MS,
  ));
  const mediaUrls = Array.isArray(input.media_urls)
    ? input.media_urls.map(String).filter(Boolean).slice(0, 4)
    : [];
  return {
    narrative_id: `nar_${fingerprint.slice(0, 20)}`,
    category,
    platform,
    source_type: sourceType,
    author_name: authorName,
    original_text: originalText,
    source_url: sourceUrl,
    media_type: mediaUrls.length ? "image" : null,
    media_urls: mediaUrls,
    video_thumbnail_url: input.video_thumbnail_url ? String(input.video_thumbnail_url) : null,
    published_at: publishedAt.toISOString(),
    collected_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    content_fingerprint: fingerprint,
  };
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

  let body: { items?: unknown; source_id?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json_body" }, { status: 400 });
  }
  if (!Array.isArray(body.items) || !body.items.length) {
    return Response.json({ error: "items array is required", status: "empty" }, { status: 200 });
  }
  if (body.items.length > MAX_ITEMS) {
    return Response.json({ error: `too many items (max ${MAX_ITEMS})` }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const startedAt = new Date();
  const sourceId = String(body.source_id || "external-x-monitor");

  const accepted: Record<string, unknown>[] = [];
  const rejected: { reason: string; source_url?: string }[] = [];
  for (const raw of body.items) {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    try {
      accepted.push(await normalizeCard(item, sourceId, startedAt));
    } catch (error) {
      rejected.push({
        reason: error instanceof Error ? error.message.slice(0, 160) : "invalid item",
        source_url: String(item.source_url || "").slice(0, 200) || undefined,
      });
    }
  }

  // Dedupe by narrative_id / source_url.
  const uniqueById = new Map<string, Record<string, unknown>>();
  const seenUrls = new Set<string>();
  for (const row of accepted) {
    const id = String(row.narrative_id);
    const url = String(row.source_url || "").toLowerCase().replace(/\/$/, "");
    if (uniqueById.has(id) || seenUrls.has(url)) continue;
    uniqueById.set(id, row);
    seenUrls.add(url);
  }
  const rows = [...uniqueById.values()];

  if (rows.length) {
    const { error } = await supabase
      .from("pulse_narrative_candidates")
      .upsert(rows, { onConflict: "narrative_id" });
    if (error) throw error;
  }
  await supabase
    .from("pulse_narrative_candidates")
    .delete()
    .lt("expires_at", startedAt.toISOString());

  await supabase.from("pulse_narrative_collection_runs").insert({
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    status: rejected.length && accepted.length ? "partial" : rejected.length ? "failed" : "completed",
    source_count: 1,
    successful_source_count: accepted.length ? 1 : 0,
    collected_item_count: accepted.length,
    eligible_item_count: rows.length,
    source_status: [{ source_id: sourceId, status: accepted.length ? "success" : "failed", items: accepted.length, rejected: rejected.length }],
  });

  return Response.json({
    status: rejected.length && accepted.length ? "partial" : rejected.length ? "failed" : "completed",
    accepted: accepted.length,
    inserted: rows.length,
    rejected: rejected.length,
    rejected_reasons: rejected.slice(0, 20),
  });
});