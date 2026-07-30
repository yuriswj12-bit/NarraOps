#!/usr/bin/env python3
"""Read-only collectors for Pulse sources that do not require paid credentials."""

from __future__ import annotations

import html
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree

from narrative_feed import SourceItem, exact_dedupe, is_source_eligible, iso


OPENNEWS_BASE_URL = "https://ai.6551.io"
USER_AGENT = "NarraOps-Pulse/1.0"
MAX_RESPONSE_BYTES = 2_000_000


def clean_text(value: str | None) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def parse_source_timestamp(value: str) -> datetime:
    raw = value.strip()
    if not raw:
        raise ValueError("source timestamp cannot be empty")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        parsed = parsedate_to_datetime(raw)
    if parsed.tzinfo is None:
        raise ValueError("source timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def _bounded_get(url: str, timeout: float = 15.0) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("source URL must use HTTPS")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json,application/rss+xml,application/atom+xml,application/xml,text/xml",
            "User-Agent": USER_AGENT,
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > MAX_RESPONSE_BYTES:
            raise ValueError("source response is too large")
        payload = response.read(MAX_RESPONSE_BYTES + 1)
    if len(payload) > MAX_RESPONSE_BYTES:
        raise ValueError("source response is too large")
    return payload


def normalize_opennews_item(
    value: dict[str, Any],
    collected_at: datetime,
) -> SourceItem:
    source_url = str(value.get("link") or "").strip()
    published = parse_source_timestamp(
        str(value.get("published_at") or value.get("created_at") or "")
    )
    source_name = str(value.get("source") or "OpenNews")
    platform = "x" if urllib.parse.urlparse(source_url).netloc.casefold() in {
        "x.com",
        "twitter.com",
        "www.x.com",
        "www.twitter.com",
    } else "news"
    return SourceItem.from_dict(
        {
            "source_id": f"opennews:{value['id']}",
            "platform": platform,
            "source_type": "trend_discovery",
            "author_id": source_name,
            "author_name": source_name,
            "original_text": clean_text(str(value.get("title") or "")),
            "source_url": source_url,
            "media_type": None,
            "media_urls": [],
            "video_thumbnail_url": None,
            "published_at": iso(published),
            "collected_at": iso(collected_at),
        }
    )


def parse_opennews_payload(
    payload: dict[str, Any],
    collected_at: datetime,
) -> list[SourceItem]:
    if payload.get("success") is not True:
        raise ValueError("OpenNews response is not successful")
    rows: list[dict[str, Any]] = []
    for section_name in ("news", "tweets"):
        section = payload.get(section_name) or {}
        items = section.get("items") or []
        if not isinstance(items, list):
            raise ValueError(f"OpenNews {section_name} items must be an array")
        rows.extend(item for item in items if isinstance(item, dict))
    normalized: list[SourceItem] = []
    for row in rows:
        try:
            item = normalize_opennews_item(row, collected_at)
        except (KeyError, TypeError, ValueError):
            continue
        if is_source_eligible(parse_source_timestamp(item.published_at), collected_at):
            normalized.append(item)
    return exact_dedupe(normalized)


def fetch_opennews_hot(
    category: str,
    subcategory: str = "",
    *,
    now: datetime | None = None,
    timeout: float = 15.0,
) -> list[SourceItem]:
    params = {"category": category}
    if subcategory:
        params["subcategory"] = subcategory
    url = f"{OPENNEWS_BASE_URL}/open/free_hot?{urllib.parse.urlencode(params)}"
    payload = json.loads(_bounded_get(url, timeout).decode("utf-8"))
    return parse_opennews_payload(payload, now or datetime.now(timezone.utc))


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].casefold()


def _first_text(node: ElementTree.Element, names: set[str]) -> str:
    for child in node.iter():
        if _local_name(child.tag) in names and child.text:
            return clean_text(child.text)
    return ""


def _entry_link(entry: ElementTree.Element, feed_url: str) -> str:
    for child in entry.iter():
        if _local_name(child.tag) != "link":
            continue
        href = child.attrib.get("href")
        candidate = href or child.text or ""
        if candidate.strip():
            return urllib.parse.urljoin(feed_url, candidate.strip())
    return ""


def _entry_media(entry: ElementTree.Element, feed_url: str) -> list[str]:
    output: list[str] = []
    for child in entry.iter():
        if _local_name(child.tag) not in {"content", "thumbnail", "enclosure"}:
            continue
        media_type = str(child.attrib.get("type") or "")
        url = str(child.attrib.get("url") or "")
        if url and (
            media_type.startswith(("image/", "video/"))
            or _local_name(child.tag) in {"thumbnail", "enclosure"}
        ):
            output.append(urllib.parse.urljoin(feed_url, url))
    return list(dict.fromkeys(output))


def parse_feed_payload(
    xml_bytes: bytes,
    source: dict[str, Any],
    collected_at: datetime,
) -> list[SourceItem]:
    root = ElementTree.fromstring(xml_bytes)
    entries = [
        node for node in root.iter() if _local_name(node.tag) in {"item", "entry"}
    ]
    items: list[SourceItem] = []
    for entry in entries:
        title = _first_text(entry, {"title"})
        body = _first_text(entry, {"description", "summary", "content"})
        original_text = body or title
        source_url = _entry_link(entry, source["url"])
        published_raw = _first_text(
            entry, {"pubdate", "published", "updated", "date"}
        )
        if not original_text or not source_url or not published_raw:
            continue
        try:
            published = parse_source_timestamp(published_raw)
        except (TypeError, ValueError):
            continue
        if not is_source_eligible(published, collected_at):
            continue
        media_urls = _entry_media(entry, source["url"])
        source_id = _first_text(entry, {"guid", "id"}) or source_url
        source_name = str(source.get("name") or urllib.parse.urlparse(source["url"]).netloc)
        items.append(
            SourceItem.from_dict(
                {
                    "source_id": f"rss:{source_id}",
                    "platform": "rss",
                    "source_type": "public_feed",
                    "author_id": source_name,
                    "author_name": source_name,
                    "original_text": original_text,
                    "source_url": source_url,
                    "media_type": "image" if media_urls else None,
                    "media_urls": media_urls,
                    "video_thumbnail_url": None,
                    "published_at": iso(published),
                    "collected_at": iso(collected_at),
                }
            )
        )
    return exact_dedupe(items)


def fetch_rss(
    source: dict[str, Any],
    *,
    now: datetime | None = None,
    timeout: float = 15.0,
) -> list[SourceItem]:
    collected_at = now or datetime.now(timezone.utc)
    return parse_feed_payload(
        _bounded_get(str(source["url"]), timeout),
        source,
        collected_at,
    )


def collect_free_sources(
    config: list[dict[str, Any]],
    *,
    now: datetime | None = None,
) -> tuple[list[SourceItem], list[dict[str, Any]]]:
    collected_at = now or datetime.now(timezone.utc)
    items: list[SourceItem] = []
    statuses: list[dict[str, Any]] = []
    for source in config:
        if not source.get("enabled", True):
            continue
        source_id = str(source.get("id") or source.get("name") or source.get("type"))
        try:
            if source.get("type") == "opennews_free_hot":
                rows = fetch_opennews_hot(
                    str(source["category"]),
                    str(source.get("subcategory") or ""),
                    now=collected_at,
                )
            elif source.get("type") == "rss":
                rows = fetch_rss(source, now=collected_at)
            else:
                raise ValueError("unsupported free source type")
            items.extend(rows)
            statuses.append({"source_id": source_id, "status": "success", "items": len(rows)})
        except (
            ElementTree.ParseError,
            KeyError,
            TimeoutError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            urllib.error.URLError,
        ) as error:
            statuses.append(
                {
                    "source_id": source_id,
                    "status": "unavailable",
                    "error_type": type(error).__name__,
                    "items": 0,
                }
            )
    return exact_dedupe(items), statuses
