import { createClient } from "npm:@supabase/supabase-js@2.55.0";

const SOURCE_WINDOW_MS = 60 * 60 * 1000;
const DISPLAY_WINDOW_MS = 30 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const MAX_ITEMS_PER_SOURCE = 100;

const sources = [
  ["politics-satire", "politics satire when:1h", "politics_satire"],
  ["breaking-viral", "viral when:1h", "events"],
  ["animals-characters", "animal character viral when:1h", "animals_characters"],
  ["internet-culture", "internet meme viral when:1h", "internet_culture"],
  ["ai-tech", "AI technology viral when:1h", "ai_tech"],
  ["crypto-native", "crypto meme when:1h", "crypto_native"],
] as const;

const categoryTerms = {
  politics_satire: ["president", "election", "government", "trump", "congress", "minister", "politic", "satire"],
  animals_characters: ["cat", "dog", "raccoon", "penguin", "animal", "mascot", "character"],
  internet_culture: ["viral", "meme", "internet", "creator", "streamer", "celebrity", "trend"],
  ai_tech: ["ai", "artificial intelligence", "robot", "agent", "grok", "openai", "model"],
  crypto_native: ["crypto", "bitcoin", "ethereum", "solana", "token", "defi", "blockchain"],
} as const;

function decodeXml(value: string) {
  return value
    .replaceAll("<![CDATA[", "")
    .replaceAll("]]>", "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\s+/g, " ")
    .trim();
}

function xmlValue(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

function routeCategory(text: string, fallback: string) {
  const normalized = text.toLowerCase();
  let selected = fallback;
  let selectedCount = 0;
  for (const [category, terms] of Object.entries(categoryTerms)) {
    const count = terms.reduce((sum, term) => {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return sum + (new RegExp(`(^|\\W)${escaped}(?=\\W|$)`, "i").test(normalized) ? 1 : 0);
    }, 0);
    if (count > selectedCount) {
      selected = category;
      selectedCount = count;
    }
  }
  return selected;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchGoogleNews(query: string, sourceId: string, categoryHint: string, now: Date) {
  const params = new URLSearchParams({
    q: query,
    hl: "en-US",
    gl: "US",
    ceid: "US:en",
  });
  const response = await fetch(`https://news.google.com/rss/search?${params}`, {
    headers: { "User-Agent": "NarraOps-Pulse/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`Google News returned ${response.status}`);
  const xml = await response.text();
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, MAX_ITEMS_PER_SOURCE)
    .map((match) => match[1]);
  const rows = [];
  for (const item of itemBlocks) {
    const title = xmlValue(item, "title");
    const url = xmlValue(item, "link");
    const publishedAt = new Date(xmlValue(item, "pubDate"));
    const ageMs = now.getTime() - publishedAt.getTime();
    if (!title || !url || !Number.isFinite(publishedAt.getTime()) || ageMs < 0 || ageMs >= SOURCE_WINDOW_MS) continue;
    const fingerprint = await sha256(`rss\0${url.toLowerCase().replace(/\/$/, "")}\0${title.toLowerCase()}`);
    const expiresAt = new Date(Math.min(
      publishedAt.getTime() + SOURCE_WINDOW_MS,
      now.getTime() + DISPLAY_WINDOW_MS,
    ));
    rows.push({
      narrative_id: `nar_${fingerprint.slice(0, 20)}`,
      category: routeCategory(title, categoryHint),
      platform: "rss",
      source_type: "public_feed",
      author_name: "Google News",
      original_text: title,
      source_url: url,
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

  const sourceResults = await Promise.all(sources.map(async ([sourceId, query, categoryHint]) => {
    try {
      const rows = await fetchGoogleNews(query, sourceId, categoryHint, startedAt);
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

  return Response.json({
    status: runStatus,
    collected_item_count: uniqueRows.length,
    source_status: statuses,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
  });
});
