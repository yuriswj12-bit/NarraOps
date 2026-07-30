// @ts-nocheck

const CATEGORIES = Object.freeze([
  "politics_satire",
  "events",
  "animals_characters",
  "internet_culture",
  "ai_tech",
  "crypto_native",
]);

export function buildPulseNarrativesResponse(
  rows = [],
  now = new Date(),
  hiddenNarrativeIds = new Set(),
) {
  const currentTime = now.getTime();
  const active = rows
    .filter((row) => Number.isFinite(Date.parse(row.published_at)))
    .filter((row) => Number.isFinite(Date.parse(row.expires_at)))
    .filter((row) => Date.parse(row.expires_at) > currentTime)
    .filter((row) => !hiddenNarrativeIds.has(row.narrative_id))
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

export async function loadPulseNarrativesResponse(
  supabase,
  now = new Date(),
  userId = null,
) {
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
  let hiddenNarrativeIds = new Set();
  if (userId) {
    const { data: states, error: statesError } = await supabase
      .from("pulse_narrative_user_states")
      .select("narrative_id")
      .eq("user_id", userId)
      .in("state", ["dismissed", "used"]);
    if (statesError && !["42P01", "PGRST204", "PGRST205"].includes(statesError.code)) {
      throw Object.assign(new Error("Unable to read private narrative state"), {
        status: 503,
        code: "PULSE_NARRATIVE_STATE_UNAVAILABLE",
      });
    }
    hiddenNarrativeIds = new Set((states || []).map((state) => state.narrative_id));
  }
  return buildPulseNarrativesResponse(data || [], now, hiddenNarrativeIds);
}

export async function dismissPulseNarrative(supabase, userId, narrativeId, now = new Date()) {
  const { data: candidate, error: candidateError } = await supabase
    .from("pulse_narrative_candidates")
    .select("narrative_id,category")
    .eq("narrative_id", narrativeId)
    .gt("expires_at", now.toISOString())
    .maybeSingle();
  if (candidateError) throw candidateError;
  if (!candidate) {
    throw Object.assign(new Error("Narrative is unavailable or expired"), {
      status: 404,
      code: "PULSE_NARRATIVE_NOT_FOUND",
    });
  }
  const updatedAt = now.toISOString();
  const { error } = await supabase.from("pulse_narrative_user_states").upsert(
    {
      user_id: userId,
      narrative_id: candidate.narrative_id,
      category: candidate.category,
      state: "dismissed",
      updated_at: updatedAt,
    },
    { onConflict: "user_id,narrative_id" },
  );
  if (error) throw error;
  return {
    narrative_id: candidate.narrative_id,
    state: "dismissed",
    updated_at: updatedAt,
  };
}

export async function usePulseNarrative(supabase, userId, narrativeId) {
  const { data, error } = await supabase
    .rpc("pulse_use_narrative", {
      p_user_id: userId,
      p_narrative_id: narrativeId,
    })
    .single();
  if (error) {
    if (error.code === "P0002") {
      throw Object.assign(new Error("Narrative is unavailable or expired"), {
        status: 404,
        code: "PULSE_NARRATIVE_NOT_FOUND",
      });
    }
    throw error;
  }
  return {
    snapshot_id: data.snapshot_id,
    narrative_id: data.narrative_id,
    category: data.category,
    platform: data.platform,
    author_name: data.author_name,
    original_text: data.original_text,
    source_url: data.source_url,
    media_type: data.media_type,
    media_urls: data.media_urls || [],
    video_thumbnail_url: data.video_thumbnail_url,
    source_published_at: data.source_published_at,
    created_at: data.created_at,
  };
}
