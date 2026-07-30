function normalizedMediaUrls(snapshot) {
  if (Array.isArray(snapshot?.media_urls)) return snapshot.media_urls;
  if (Array.isArray(snapshot?.mediaUrls)) return snapshot.mediaUrls;
  return [];
}

export function buildNarrativeSnapshotPlanResponse(snapshot) {
  const source = {
    snapshot_id: snapshot.snapshot_id,
    narrative_id: snapshot.narrative_id,
    category: snapshot.category,
    platform: snapshot.platform,
    source_type: snapshot.source_type,
    author_name: snapshot.author_name,
    original_text: snapshot.original_text,
    source_url: snapshot.source_url,
    media_type: snapshot.media_type,
    media_urls: normalizedMediaUrls(snapshot),
    video_thumbnail_url: snapshot.video_thumbnail_url,
    source_published_at: snapshot.source_published_at,
    source_expires_at: snapshot.source_expires_at,
    snapshot_created_at: snapshot.created_at,
  };

  const plan = {
    snapshot_id: snapshot.snapshot_id,
    narrative_id: snapshot.narrative_id,
    title: snapshot.original_text,
    source,
    executable: false,
    requires_user_confirmation: true,
    next_step: "analyze_source",
  };

  return {
    schema_version: "go.plan.v1",
    mode: "pulse_narrative_snapshot",
    data_status: "private_snapshot",
    execution: "disabled",
    source,
    plan,
    card: {
      type: "narrative_snapshot",
      status: "source_ready",
      data: plan,
    },
    message: {
      role: "assistant",
      content:
        "Loaded the private Pulse source snapshot. The original source is preserved and ready for analysis.",
      suggestion:
        "Review the source, then ask NarraOps to analyze the narrative or prepare a launch draft.",
    },
  };
}
