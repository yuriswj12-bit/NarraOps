import type {
  PulseNarrativeSnapshotRow,
  PulseSnapshotRepository,
} from "./pulse-snapshot-provider.ts";

interface SupabaseLike {
  from(table: string): any;
}

export class SupabasePulseSnapshotRepository implements PulseSnapshotRepository {
  constructor(readonly supabase: SupabaseLike) {}

  async getOwnedSnapshot(snapshotId: string, actorId: string): Promise<PulseNarrativeSnapshotRow | null> {
    if (!snapshotId || !actorId) return null;
    const { data, error } = await this.supabase
      .from("pulse_narrative_snapshots")
      .select(
        "snapshot_id,user_id,narrative_id,category,platform,source_type,author_name,original_text,source_url,media_type,media_urls,video_thumbnail_url,source_published_at,source_expires_at,created_at",
      )
      .eq("snapshot_id", snapshotId)
      .eq("user_id", actorId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }
}
