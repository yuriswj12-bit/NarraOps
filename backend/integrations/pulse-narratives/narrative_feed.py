#!/usr/bin/env python3
"""Deterministic contracts and lifecycle rules for Pulse narrative cards."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable


PLATFORMS = frozenset({"x", "news", "rss"})
MONITORED_PLATFORMS = frozenset({"x"})
SOURCE_TYPES = frozenset(
    {"monitored_account", "trend_discovery", "public_feed"}
)
CATEGORIES = frozenset(
    {
        "politics_satire",
        "events",
        "animals_characters",
        "internet_culture",
        "crypto_native",
    }
)
USER_STATES = frozenset({"unseen", "seen", "dismissed", "used"})
SOURCE_WINDOW = timedelta(hours=1)
MAX_DISPLAY_LIFETIME = timedelta(minutes=30)
CATEGORY_TERMS = {
    "politics_satire": frozenset(
        {"president", "election", "government", "trump", "congress", "minister", "politic"}
    ),
    "animals_characters": frozenset(
        {"cat", "dog", "raccoon", "penguin", "animal", "mascot", "character"}
    ),
    "internet_culture": frozenset(
        {"viral", "meme", "internet", "creator", "streamer", "celebrity", "trend"}
    ),
    "crypto_native": frozenset(
        {"crypto", "bitcoin", "ethereum", "solana", "token", "defi", "blockchain"}
    ),
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def card_expiry(published_at: datetime, first_displayed_at: datetime) -> datetime:
    """Expire at the earlier of source-age 1H and display-age 30M."""
    return min(
        published_at + SOURCE_WINDOW,
        first_displayed_at + MAX_DISPLAY_LIFETIME,
    )


def is_source_eligible(published_at: datetime, now: datetime | None = None) -> bool:
    current = now or utc_now()
    age = current - published_at
    return timedelta(0) <= age < SOURCE_WINDOW


def route_category(original_text: str) -> str:
    """Route source text deterministically; events is the honest fallback."""
    text = original_text.casefold()
    matches = {
        category: sum(
            bool(re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text))
            for term in terms
        )
        for category, terms in CATEGORY_TERMS.items()
    }
    category, count = max(matches.items(), key=lambda item: item[1])
    return category if count else "events"


def content_fingerprint(platform: str, source_id: str, original_text: str) -> str:
    normalized = " ".join(original_text.casefold().split())
    value = f"{platform}\0{source_id}\0{normalized}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SourceItem:
    source_id: str
    platform: str
    source_type: str
    author_id: str
    author_name: str
    original_text: str
    source_url: str
    media_type: str | None
    media_urls: tuple[str, ...]
    video_thumbnail_url: str | None
    published_at: str
    collected_at: str

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "SourceItem":
        required = {
            "source_id",
            "platform",
            "source_type",
            "author_id",
            "author_name",
            "original_text",
            "source_url",
            "published_at",
            "collected_at",
        }
        missing = sorted(required - value.keys())
        if missing:
            raise ValueError(f"missing source fields: {', '.join(missing)}")
        if value["platform"] not in PLATFORMS:
            raise ValueError("unsupported platform")
        if value["source_type"] not in SOURCE_TYPES:
            raise ValueError("unsupported source type")
        if not str(value["original_text"]).strip():
            raise ValueError("original_text cannot be empty")
        if not str(value["source_url"]).strip():
            raise ValueError("source_url cannot be empty")
        parse_timestamp(str(value["published_at"]))
        parse_timestamp(str(value["collected_at"]))
        media_urls = tuple(str(url) for url in value.get("media_urls") or ())
        return cls(
            source_id=str(value["source_id"]),
            platform=str(value["platform"]),
            source_type=str(value["source_type"]),
            author_id=str(value["author_id"]),
            author_name=str(value["author_name"]),
            original_text=str(value["original_text"]),
            source_url=str(value["source_url"]),
            media_type=value.get("media_type"),
            media_urls=media_urls,
            video_thumbnail_url=value.get("video_thumbnail_url"),
            published_at=str(value["published_at"]),
            collected_at=str(value["collected_at"]),
        )

    def to_card(
        self,
        category: str,
        first_displayed_at: datetime,
        narrative_id: str | None = None,
    ) -> dict[str, Any]:
        if category not in CATEGORIES:
            raise ValueError("unsupported category")
        published = parse_timestamp(self.published_at)
        if not is_source_eligible(published, first_displayed_at):
            raise ValueError("source is outside the one-hour eligibility window")
        fingerprint = content_fingerprint(
            self.platform,
            self.source_id,
            self.original_text,
        )
        return {
            "narrative_id": narrative_id or f"nar_{fingerprint[:20]}",
            "category": category,
            "platform": self.platform,
            "source_type": self.source_type,
            "author_name": self.author_name,
            "original_text": self.original_text,
            "source_url": self.source_url,
            "media_type": self.media_type,
            "media_urls": list(self.media_urls),
            "video_thumbnail_url": self.video_thumbnail_url,
            "published_at": self.published_at,
            "first_displayed_at": iso(first_displayed_at),
            "expires_at": iso(card_expiry(published, first_displayed_at)),
            "content_fingerprint": fingerprint,
        }


def exact_dedupe(items: Iterable[SourceItem]) -> list[SourceItem]:
    output: list[SourceItem] = []
    seen_source_keys: set[tuple[str, str]] = set()
    seen_source_urls: set[str] = set()
    seen_fingerprints: set[str] = set()
    for item in items:
        source_key = (item.platform, item.source_id)
        source_url = item.source_url.casefold().rstrip("/")
        fingerprint = content_fingerprint(
            item.platform,
            item.source_id,
            item.original_text,
        )
        if (
            source_key in seen_source_keys
            or source_url in seen_source_urls
            or fingerprint in seen_fingerprints
        ):
            continue
        seen_source_keys.add(source_key)
        seen_source_urls.add(source_url)
        seen_fingerprints.add(fingerprint)
        output.append(item)
    return output


def load_source_registry(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, list):
        raise ValueError("source registry must be a JSON array")
    seen: set[tuple[str, str]] = set()
    output: list[dict[str, Any]] = []
    for row in payload:
        platform = row.get("platform")
        source_type = row.get("source_type")
        handle = str(row.get("handle") or "").strip().removeprefix("@")
        if platform not in MONITORED_PLATFORMS:
            raise ValueError("source registry has an unsupported monitored platform")
        if source_type not in SOURCE_TYPES:
            raise ValueError("source registry has an unsupported source type")
        if not handle:
            raise ValueError("source registry handle cannot be empty")
        key = (platform, handle.casefold())
        if key in seen:
            raise ValueError(f"duplicate source registry entry: {platform}/{handle}")
        seen.add(key)
        output.append(
            {
                "platform": platform,
                "source_type": source_type,
                "handle": handle,
                "category_hint": row.get("category_hint"),
                "priority": int(row.get("priority", 100)),
                "enabled": bool(row.get("enabled", True)),
            }
        )
    return output
