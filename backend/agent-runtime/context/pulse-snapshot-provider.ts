import type {
  ActorRef,
  ContextProvider,
  ContextRef,
  ResolvedContextRef,
} from "../contracts/index.ts";
import { ContextResolutionError, contextDigest } from "./resolver.ts";

export interface PulseNarrativeSnapshotRow {
  snapshot_id: string;
  user_id?: string;
  narrative_id: string;
  category: string;
  platform: string;
  source_type: string;
  author_name: string;
  original_text: string;
  source_url: string;
  media_type?: string | null;
  media_urls?: string[];
  video_thumbnail_url?: string | null;
  source_published_at: string;
  source_expires_at: string;
  created_at: string;
}

export interface PulseSnapshotRepository {
  getOwnedSnapshot(snapshotId: string, actorId: string): Promise<PulseNarrativeSnapshotRow | null>;
}

export class PulseSnapshotContextProvider implements ContextProvider {
  readonly kind = "pulse.narrative_snapshot" as const;

  constructor(readonly repository: PulseSnapshotRepository) {}

  async resolve(actor: ActorRef, ref: ContextRef, _signal: AbortSignal): Promise<ResolvedContextRef> {
    const snapshot = await this.repository.getOwnedSnapshot(ref.id, actor.actorId);
    if (!snapshot) {
      throw new ContextResolutionError(
        "PULSE_SNAPSHOT_NOT_FOUND",
        "Pulse narrative snapshot was not found for the authenticated actor",
      );
    }
    const safeData = {
      narrativeId: snapshot.narrative_id,
      category: snapshot.category,
      platform: snapshot.platform,
      sourceType: snapshot.source_type,
      authorName: snapshot.author_name,
      originalText: snapshot.original_text,
      sourceUrl: snapshot.source_url,
      mediaType: snapshot.media_type || null,
      mediaUrls: Array.isArray(snapshot.media_urls) ? snapshot.media_urls.slice(0, 20) : [],
      videoThumbnailUrl: snapshot.video_thumbnail_url || null,
      sourcePublishedAt: snapshot.source_published_at,
      sourceExpiresAt: snapshot.source_expires_at,
      snapshotCreatedAt: snapshot.created_at,
    };
    return {
      kind: this.kind,
      id: snapshot.snapshot_id,
      version: snapshot.created_at,
      digest: contextDigest(safeData),
      safeData,
      resolvedAt: new Date().toISOString(),
    };
  }
}
