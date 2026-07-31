import { createClient } from "npm:@supabase/supabase-js@2.55.0";

const SOURCE_WINDOW_MS = 60 * 60 * 1000;
const DISPLAY_WINDOW_MS = 30 * 60 * 1000;
const BUCKET_MS = 5 * 60 * 1000;
const MAX_ITEMS_PER_SOURCE = 100;

const rssSources = [
["google-news-politics-satire", "Google News - politics and satire", "https://news.google.com/rss/search?q=politics%20satire%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "politics_satire"],
["google-news-trump-viral", "Google News - Trump viral", "https://news.google.com/rss/search?q=Trump%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "politics_satire"],
["google-news-president-controversy", "Google News - president controversy", "https://news.google.com/rss/search?q=president%20controversy%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "politics_satire"],
["google-news-election-meme", "Google News - election meme", "https://news.google.com/rss/search?q=election%20meme%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "politics_satire"],
["google-news-politician-bizarre", "Google News - politician bizarre moment", "https://news.google.com/rss/search?q=politician%20bizarre%20moment%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "politics_satire"],
["google-news-breaking-events", "Google News - breaking viral events", "https://news.google.com/rss/search?q=breaking%20viral%20event%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "events"],
["google-news-unusual-incident", "Google News - unusual incident", "https://news.google.com/rss/search?q=unusual%20incident%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "events"],
["google-news-bizarre-news", "Google News - bizarre news", "https://news.google.com/rss/search?q=bizarre%20news%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "events"],
["google-news-public-protest", "Google News - public protest", "https://news.google.com/rss/search?q=public%20protest%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "events"],
["google-news-unexpected-announcement", "Google News - unexpected announcement", "https://news.google.com/rss/search?q=unexpected%20announcement%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "events"],
["google-news-animals-characters", "Google News - viral animals and characters", "https://news.google.com/rss/search?q=animal%20character%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "animals_characters"],
["google-news-funny-cat", "Google News - funny cat", "https://news.google.com/rss/search?q=funny%20cat%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "animals_characters"],
["google-news-unusual-dog", "Google News - unusual dog", "https://news.google.com/rss/search?q=unusual%20dog%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "animals_characters"],
["google-news-zoo-viral", "Google News - zoo viral", "https://news.google.com/rss/search?q=zoo%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "animals_characters"],
["google-news-new-mascot", "Google News - new mascot", "https://news.google.com/rss/search?q=new%20mascot%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "animals_characters"],
["google-news-cartoon-character", "Google News - cartoon character viral", "https://news.google.com/rss/search?q=cartoon%20character%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "animals_characters"],
["google-news-internet-culture", "Google News - internet memes", "https://news.google.com/rss/search?q=internet%20meme%20viral%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "internet_culture"],
["google-news-social-media-trend", "Google News - social media trend", "https://news.google.com/rss/search?q=social%20media%20trend%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "internet_culture"],
["google-news-celebrity-viral", "Google News - celebrity viral moment", "https://news.google.com/rss/search?q=celebrity%20viral%20moment%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "internet_culture"],
["google-news-streamer-controversy", "Google News - streamer controversy", "https://news.google.com/rss/search?q=streamer%20controversy%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "internet_culture"],
["google-news-new-meme", "Google News - new meme", "https://news.google.com/rss/search?q=new%20meme%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "internet_culture"],
["google-news-crypto-native", "Google News - crypto memes", "https://news.google.com/rss/search?q=crypto%20meme%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "crypto_native"],
["google-news-solana-meme", "Google News - Solana meme", "https://news.google.com/rss/search?q=Solana%20meme%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "crypto_native"],
["google-news-crypto-controversy", "Google News - crypto controversy", "https://news.google.com/rss/search?q=crypto%20controversy%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "crypto_native"],
["google-news-bitcoin-meme", "Google News - Bitcoin meme", "https://news.google.com/rss/search?q=Bitcoin%20meme%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "crypto_native"],
["google-news-token-launch", "Google News - token launch", "https://news.google.com/rss/search?q=token%20launch%20crypto%20when%3A1h&hl=en-US&gl=US&ceid=US:en", "crypto_native"],
["bbc-world", "BBC News", "https://feeds.bbci.co.uk/news/rss.xml", "events"],
["npr-news", "NPR", "https://feeds.npr.org/1001/rss.xml", "events"],
["know-your-meme", "Know Your Meme", "https://knowyourmeme.com/newsfeed.rss", "internet_culture"],
["polygon-culture", "Polygon Culture", "https://www.polygon.com/rss/index.xml", "internet_culture"],
["the-onion", "The Onion", "https://www.theonion.com/rss", "politics_satire"],
["babylon-bee", "Babylon Bee", "https://babylonbee.com/feed", "politics_satire"],
["cointelegraph", "Cointelegraph", "https://cointelegraph.com/rss", "crypto_native"],
["decrypt", "Decrypt", "https://decrypt.co/feed", "crypto_native"],
["coindesk", "CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/", "crypto_native"],
["the-block", "The Block", "https://www.theblock.co/rss.xml", "crypto_native"],
] as const;

const categoryTerms = {
  politics_satire: ["president", "election", "government", "trump", "congress", "minister", "politic", "satire", "senator", "parliament", "white house", "campaign"],
  animals_characters: ["cat", "dog", "raccoon", "penguin", "animal", "mascot", "character", "zoo", "puppy", "kitten", "frog", "bear", "otter"],
  internet_culture: ["viral", "meme", "internet", "creator", "streamer", "celebrity", "trend", "tiktok", "youtube", "influencer", "fandom", "cosplay"],
  crypto_native: ["crypto", "bitcoin", "ethereum", "solana", "token", "defi", "blockchain", "memecoin", "airdrop", "nft", "web3", "wallet", "pump"],
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
      const escaped = term.replace(/[.*+?^${}()|[\]\]/g, "\$&");
      return sum + (new RegExp(`(^|\W)${escaped}(?=\W|$)`, "i").test(normalized) ? 1 : 0);
    }, 0);
    if (count > selectedCount) {
      selected = category;
      selectedCount = count;
    }
  }
  if (selectedCount > 0) return selected;
  return fallback || "events";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attributeValue(block: string, tagPattern: string, attribute: string) {
  const match = block.match(new RegExp(`<${tagPattern}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, "i"));
  return decodeXml(match?.[1] || "");
}

async function fetchRssSource(
  sourceId: string,
  sourceName: string,
  url: string,
  categoryHint: string,
  now: Date,
) {
  const response = await fetch(url, {
    headers: { "User-Agent": "NarraOps-Pulse/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`${sourceName} returned ${response.status}`);
  const xml = await response.text();
  const itemBlocks = [
    ...[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]),
    ...[...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]),
  ]
    .slice(0, MAX_ITEMS_PER_SOURCE)
    .map((item) => item);
  const rows = [];
  for (const item of itemBlocks) {
    const title = xmlValue(item, "title");
    const sourceUrl = xmlValue(item, "link") || attributeValue(item, "link", "href");
    const publishedAt = new Date(
      xmlValue(item, "pubDate")
      || xmlValue(item, "published")
      || xmlValue(item, "updated"),
    );
    const ageMs = now.getTime() - publishedAt.getTime();
    if (!title || !sourceUrl || !Number.isFinite(publishedAt.getTime()) || ageMs < 0 || ageMs >= SOURCE_WINDOW_MS) continue;
    const fingerprint = await sha256(`rss\0${sourceUrl.toLowerCase().replace(/\/$/, "")}\0${title.toLowerCase()}`);
    const expiresAt = new Date(Math.min(
      publishedAt.getTime() + SOURCE_WINDOW_MS,
      now.getTime() + DISPLAY_WINDOW_MS,
    ));
    const mediaUrl = attributeValue(item, "(?:media:)?(?:content|thumbnail)|enclosure", "url");
    rows.push({
      narrative_id: `nar_${fingerprint.slice(0, 20)}`,
      category: routeCategory(title, categoryHint),
      platform: "rss",
      source_type: "public_feed",
      author_name: sourceName,
      original_text: title,
      source_url: sourceUrl,
      media_type: mediaUrl ? "image" : null,
      media_urls: mediaUrl ? [mediaUrl] : [],
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

  const sourceResults = await Promise.all(rssSources.map(async ([sourceId, sourceName, url, categoryHint]) => {
    try {
      const rows = await fetchRssSource(sourceId, sourceName, url, categoryHint, startedAt);
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
