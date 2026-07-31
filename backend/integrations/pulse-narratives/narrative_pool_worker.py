#!/usr/bin/env python3
"""Collect credential-free sources and persist the current honest narrative pool."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from free_source_collectors import collect_free_sources
from narrative_feed import iso, route_category


HERE = Path(__file__).resolve().parent


def supabase(path: str, method: str = "GET", body=None, prefer: str = "return=representation"):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    secret = os.environ["SUPABASE_SECRET_KEY"]
    request = urllib.request.Request(
        f"{base}/rest/v1/{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def candidate_row(item, collected_at: datetime) -> dict:
    card = item.to_card(
        route_category(item.original_text, getattr(item, "category_hint", None)),
        collected_at,
    )
    return {
        "narrative_id": card["narrative_id"],
        "category": card["category"],
        "platform": card["platform"],
        "source_type": card["source_type"],
        "author_name": card["author_name"],
        "original_text": card["original_text"],
        "source_url": card["source_url"],
        "media_type": card["media_type"],
        "media_urls": card["media_urls"],
        "video_thumbnail_url": card["video_thumbnail_url"],
        "published_at": card["published_at"],
        "expires_at": card["expires_at"],
        "content_fingerprint": card["content_fingerprint"],
        "collected_at": item.collected_at,
        "updated_at": iso(collected_at),
    }


def dedupe_candidate_rows(rows: list[dict]) -> list[dict]:
    """Prefer the first row per narrative_id and source_url to avoid 409 conflicts."""
    unique_by_id: dict[str, dict] = {}
    seen_urls: set[str] = set()
    for row in rows:
        narrative_id = str(row.get("narrative_id") or "")
        source_url = str(row.get("source_url") or "").casefold().rstrip("/")
        if not narrative_id or not source_url:
            continue
        if narrative_id in unique_by_id or source_url in seen_urls:
            continue
        unique_by_id[narrative_id] = row
        seen_urls.add(source_url)
    return list(unique_by_id.values())


def upsert_candidates(rows: list[dict]) -> None:
    """Upsert in small batches so one conflict cannot drop the entire run."""
    batch_size = 50
    for index in range(0, len(rows), batch_size):
        batch = rows[index:index + batch_size]
        try:
            supabase(
                "pulse_narrative_candidates?on_conflict=narrative_id",
                "POST",
                batch,
                "return=minimal,resolution=merge-duplicates",
            )
        except urllib.error.HTTPError as error:
            # Fallback to single-row upserts when a batch hits source_url uniqueness.
            if error.code not in {409, 400}:
                raise
            for row in batch:
                try:
                    supabase(
                        "pulse_narrative_candidates?on_conflict=narrative_id",
                        "POST",
                        [row],
                        "return=minimal,resolution=merge-duplicates",
                    )
                except urllib.error.HTTPError as row_error:
                    if row_error.code in {409, 400}:
                        continue
                    raise


def run(config_path: Path | None = None) -> dict:
    started_at = datetime.now(timezone.utc)
    config = json.loads(
        (config_path or HERE / "free-sources.example.json").read_text(encoding="utf-8-sig")
    )
    items, statuses = collect_free_sources(config, now=started_at)
    rows = dedupe_candidate_rows([candidate_row(item, started_at) for item in items])
    if rows:
        upsert_candidates(rows)
    cutoff = urllib.parse.quote(iso(started_at), safe=":-TZ.")
    supabase(
        f"pulse_narrative_candidates?expires_at=lt.{cutoff}",
        "DELETE",
        prefer="return=minimal",
    )
    successful = sum(status["status"] == "success" for status in statuses)
    status = "completed" if successful == len(statuses) else "partial" if successful else "failed"
    run_row = {
        "started_at": iso(started_at),
        "completed_at": iso(datetime.now(timezone.utc)),
        "status": status,
        "source_count": len(statuses),
        "successful_source_count": successful,
        "collected_item_count": len(items),
        "eligible_item_count": len(rows),
        "source_status": statuses,
    }
    supabase("pulse_narrative_collection_runs", "POST", run_row, "return=minimal")
    return run_row


if __name__ == "__main__":
    print(json.dumps(run(), ensure_ascii=False))
