// @ts-nocheck

const CATEGORIES = Object.freeze([
  "politics_satire",
  "events",
  "animals_characters",
  "internet_culture",
  "ai_tech",
  "crypto_native",
]);

export function buildPulseNarrativesResponse(rows = [], now = new Date()) {
  const currentTime = now.getTime();
  const active = rows
    .filter((row) => Number.isFinite(Date.parse(row.published_at)))
    .filter((row) => Number.isFinite(Date.parse(row.expires_at)))
    .filter((row) => Date.parse(row.expires_at) > currentTime)
    .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
    .map((row) => ({
      narrative_id: row.narrative_id,
      category: row.category,
      platform: row.platform,
      source_type: row.source_type,
      author_name: row.author_name,
      original_text: row.original_text,
      source_url: row.source_url,
      media_type: row.media_type || null,
      media_urls: Array.isArray(row.media_urls) ? row.media_urls : [],
      video_thumbnail_url: row.video_thumbnail_url || null,
      published_at: row.published_at,
      expires_at: row.expires_at,
    }));
  const columns = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      active.filter((item) => item.category === category),
    ]),
  );
  return {
    schema_version: "pulse.narratives.v1",
    data_status: active.length ? "live" : "no_fresh_narratives",
    generated_at: now.toISOString(),
    source_window_minutes: 60,
    maximum_display_minutes: 30,
    refresh_intervals_minutes: [3, 5, 15],
    default_refresh_interval_minutes: 5,
    total: active.length,
    columns,
  };
}

export async function loadPulseNarrativesResponse(supabase, now = new Date()) {
  if (!supabase) return buildPulseNarrativesResponse([], now);
  const { data, error } = await supabase
    .from("pulse_narrative_candidates")
    .select(
      "narrative_id,category,platform,source_type,author_name,original_text,source_url,media_type,media_urls,video_thumbnail_url,published_at,expires_at",
    )
    .gt("expires_at", now.toISOString())
    .order("published_at", { ascending: false })
    .limit(500);
  if (error) {
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code)) {
      return {
        ...buildPulseNarrativesResponse([], now),
        data_status: "persistence_not_ready",
      };
    }
    throw Object.assign(new Error("Unable to read Pulse narratives"), {
      status: 503,
      code: "PULSE_NARRATIVES_UNAVAILABLE",
    });
  }
  return buildPulseNarrativesResponse(data || [], now);
}
