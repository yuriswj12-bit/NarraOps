#!/usr/bin/env python3
"""Collect small public feeds, deduplicate them, cluster events, and emit Pulse cards."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urljoin
from xml.etree import ElementTree

import requests

from evidence_processor import MAX_BYTES, USER_AGENT, validate_url


PROMOTION_TERMS = {
    "contract address", "token address", "buy now", "pump.fun", "dexscreener",
    "airdrop", "presale", "ca:", "合约地址", "发币", "空投", "买入",
}
ANIMAL_TERMS = {"cat", "dog", "raccoon", "penguin", "bear", "bull", "bird", "monkey", "猫", "狗", "浣熊", "企鹅", "熊", "鸟"}
EMOTION_TERMS = {"rescued", "saved", "dies", "died", "crying", "funny", "absurd", "shocking", "hero", "救", "去世", "哭", "搞笑", "荒诞", "震惊", "英雄"}
EVENT_TERMS = {"wins", "loses", "launches", "announces", "arrested", "banned", "breaks", "viral", "爆火", "宣布", "获胜", "被捕", "禁令"}
IDENTITY_TERMS = {"community", "movement", "generation", "workers", "fans", "culture", "社区", "群体", "文化", "一代"}
STOPWORDS = {"the", "and", "for", "with", "from", "that", "this", "into", "after", "about", "your", "you", "its", "are", "was", "were"}
CLUSTER_GENERIC = STOPWORDS | {
    "viral", "internet", "culture", "animal", "animals", "video", "news", "says",
    "launches", "report", "reports", "latest", "global", "social", "media",
} | ANIMAL_TERMS
ENTITY_GENERIC = CLUSTER_GENERIC | {
    "this", "these", "those", "what", "when", "where", "why", "how", "here",
    "times", "news", "post", "press", "daily", "today", "world", "report",
    "agent", "agents", "newest", "favorite", "believed", "becomes", "turns",
    "going", "anymore", "have", "more", "over", "move", "best", "biggest",
    "latest", "reveals", "explaining", "moment", "moments", "takes",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def clean_text(value: str | None) -> str:
    text = html.unescape(value or "")
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def content_hash(title: str, content: str) -> str:
    normalized = re.sub(r"\W+", " ", f"{title} {content}".casefold()).strip()
    return hashlib.sha256(normalized.encode()).hexdigest()


def tokenize(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[\w]{3,}", value.casefold(), flags=re.UNICODE)
        if token not in STOPWORDS and not token.isdigit()
    }


def article_title(title: str) -> str:
    return re.split(r"\s[-–—]\s", title, maxsplit=1)[0]


def entity_tokens(title: str) -> set[str]:
    words = re.findall(r"\b[A-Z][A-Za-z0-9'-]{3,}\b", article_title(title))
    return {word.casefold() for word in words if word.casefold() not in ENTITY_GENERIC}


def jaccard(left: set[str], right: set[str]) -> float:
    return len(left & right) / len(left | right) if left and right else 0.0


def contains_term(text: str, term: str) -> bool:
    if re.fullmatch(r"[a-z0-9 ]+", term):
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", text))
    return term in text


def contains_any(text: str, terms: set[str]) -> bool:
    return any(contains_term(text, term) for term in terms)


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].casefold()


def _child_text(node: ElementTree.Element, names: set[str]) -> str:
    for child in node.iter():
        if _local_name(child.tag) in names and child.text:
            return clean_text(child.text)
    return ""


def parse_feed(xml_bytes: bytes, source: dict[str, Any]) -> list[dict[str, Any]]:
    root = ElementTree.fromstring(xml_bytes)
    entries = [node for node in root.iter() if _local_name(node.tag) in {"item", "entry"}]
    collected_at = now_iso()
    output = []
    for entry in entries:
        title = _child_text(entry, {"title"})
        content = _child_text(entry, {"description", "summary", "content"})
        author = _child_text(entry, {"author", "creator", "name"}) or None
        publisher = _child_text(entry, {"source"}) or source.get("name") or source["url"]
        published_at = _child_text(entry, {"pubdate", "published", "updated", "date"}) or None
        link = _child_text(entry, {"link"})
        if not link:
            for child in entry.iter():
                if _local_name(child.tag) == "link" and child.attrib.get("href"):
                    link = child.attrib["href"]
                    break
        if not title or not link:
            continue
        link = urljoin(source["url"], link)
        digest = content_hash(title, content)
        output.append(
            {
                "candidate_id": f"cand_{digest[:16]}",
                "source_url": link,
                "source_name": source.get("name") or source["url"],
                "platform": source.get("platform") or "rss",
                "title": title,
                "content": content,
                "author": author,
                "publisher": publisher,
                "published_at": published_at,
                "collected_at": collected_at,
                "media_urls": [],
                "content_hash": digest,
            }
        )
    return output


def fetch_feed(source: dict[str, Any], timeout: float = 10.0) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    url = source["url"]
    validate_url(url)
    status = {"name": source.get("name"), "url": url, "status": "unavailable", "items": 0}
    try:
        current = url
        for _ in range(5):
            validate_url(current)
            response = requests.get(
                current,
                headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml,application/atom+xml,application/xml,text/xml"},
                timeout=timeout,
                allow_redirects=False,
                stream=True,
            )
            if response.status_code not in {301, 302, 303, 307, 308}:
                break
            location = response.headers.get("Location")
            if not location:
                status["status"] = "invalid_redirect"
                return [], status
            current = urljoin(current, location)
        else:
            status["status"] = "redirect_limit_exceeded"
            return [], status
        status["http_status"] = response.status_code
        if response.status_code == 429:
            status["status"] = "rate_limited"
            return [], status
        if response.status_code in {401, 403}:
            status["status"] = "blocked"
            return [], status
        if response.status_code != 200:
            status["status"] = "upstream_error" if response.status_code >= 500 else "unavailable"
            return [], status
        chunks, size = [], 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > MAX_BYTES:
                status["status"] = "response_too_large"
                return [], status
            chunks.append(chunk)
        candidates = parse_feed(b"".join(chunks), source)
        status.update({"status": "success", "items": len(candidates)})
        return candidates, status
    except requests.Timeout:
        status["status"] = "timeout"
    except (requests.RequestException, ElementTree.ParseError, ValueError) as exc:
        status["status"] = "invalid_or_upstream_error"
        status["error_type"] = type(exc).__name__
    return [], status


def exact_dedupe(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen_hashes, seen_urls, output = set(), set(), []
    for candidate in candidates:
        if candidate["content_hash"] in seen_hashes or candidate["source_url"] in seen_urls:
            continue
        seen_hashes.add(candidate["content_hash"])
        seen_urls.add(candidate["source_url"])
        output.append(candidate)
    return output


def cluster_candidates(candidates: list[dict[str, Any]], threshold: float = 0.34) -> list[list[dict[str, Any]]]:
    clusters: list[list[dict[str, Any]]] = []
    cluster_tokens: list[set[str]] = []
    cluster_entities: list[set[str]] = []
    title_tokens = [tokenize(article_title(candidate["title"])) for candidate in candidates]
    raw_entities = [entity_tokens(candidate["title"]) for candidate in candidates]
    frequency: dict[str, int] = {}
    entity_frequency: dict[str, int] = {}
    for tokens in title_tokens:
        for token in tokens:
            frequency[token] = frequency.get(token, 0) + 1
    for entities in raw_entities:
        for entity in entities:
            entity_frequency[entity] = entity_frequency.get(entity, 0) + 1
    rare_limit = max(2, round(len(candidates) * 0.04))

    for candidate_index, candidate in enumerate(candidates):
        tokens = tokenize(candidate["title"])
        entities = {entity for entity in raw_entities[candidate_index] if entity_frequency.get(entity, 0) <= rare_limit}
        distinctive = {
            token
            for token in title_tokens[candidate_index]
            if len(token) >= 6 and token not in CLUSTER_GENERIC and frequency.get(token, 0) <= rare_limit
        }
        best_index, best_score = None, 0.0
        for index, representative_tokens in enumerate(cluster_tokens):
            score = jaccard(tokens, representative_tokens)
            shares_entity = bool(entities & cluster_entities[index])
            if shares_entity and distinctive:
                score = max(score, threshold)
            if score > best_score:
                best_index, best_score = index, score
        if best_index is not None and best_score >= threshold:
            clusters[best_index].append(candidate)
        else:
            clusters.append([candidate])
            cluster_tokens.append(tokens)
            cluster_entities.append(entities)
    return clusters


def analyze_cluster(cluster: list[dict[str, Any]]) -> dict[str, Any]:
    primary = max(cluster, key=lambda item: len(item["content"]) + len(item["title"]))
    text = " ".join(f"{item['title']} {item['content']}" for item in cluster).casefold()
    promotional = contains_any(text, PROMOTION_TERMS)
    hooks = []
    for name, terms in (
        ("visual_animal", ANIMAL_TERMS),
        ("emotion", EMOTION_TERMS),
        ("event", EVENT_TERMS),
        ("identity", IDENTITY_TERMS),
    ):
        if contains_any(text, terms):
            hooks.append(name)
    story_gate = len(primary["title"]) >= 12 and len(text) >= 60 and bool(hooks)
    independent_sources = len({item.get("publisher") or item["source_name"] for item in cluster})
    amplification_gate = len(hooks) >= 2 or independent_sources >= 2
    if promotional:
        state = "reject"
    elif story_gate and len(hooks) >= 2 and independent_sources >= 2:
        state = "high_priority"
    elif story_gate and amplification_gate:
        state = "review"
    elif story_gate:
        state = "watch"
    else:
        state = "reject"
    cluster_seed = "|".join(sorted(item["candidate_id"] for item in cluster))
    cluster_id = "nar_" + hashlib.sha256(cluster_seed.encode()).hexdigest()[:16]
    return {
        "opportunity_id": cluster_id,
        "state": state,
        "headline": primary["title"],
        "what_happened": clean_text(primary["content"])[:360] or primary["title"],
        "why_memeable": hooks,
        "story_gate": "pass" if story_gate else "fail",
        "amplification_gate": "pass" if amplification_gate else "fail",
        "relationship": "not_yet_token_linked",
        "evidence_confidence": min(90, 35 + 15 * independent_sources + 5 * len(cluster)),
        "source_count": len(cluster),
        "independent_source_count": independent_sources,
        "sources": [
            {
                "url": item["source_url"],
                "platform": item["platform"],
                "source_name": item["source_name"],
                "publisher": item.get("publisher"),
                "published_at": item["published_at"],
            }
            for item in cluster
        ],
        "risk_flags": ["token_promotion_detected"] if promotional else [],
        "missing_evidence": [
            message
            for message, missing in (
                ("No independent second source observed.", independent_sources < 2),
                ("No clear narrative hook observed.", not hooks),
                ("Original social post has not been verified.", True),
            )
            if missing
        ],
        "candidate_ids": [item["candidate_id"] for item in cluster],
        "generated_at": now_iso(),
    }


def load_sources(path: Path) -> list[dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, list):
        raise ValueError("sources config must be a JSON array")
    return [item for item in data if item.get("enabled", True)]


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("sources", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--limit-per-source", type=int, default=50)
    args = parser.parse_args()
    candidates, statuses = [], []
    for source in load_sources(args.sources):
        rows, status = fetch_feed(source, args.timeout)
        candidates.extend(rows[: max(1, min(args.limit_per_source, 100))])
        statuses.append(status)
    candidates = exact_dedupe(candidates)
    cards = [analyze_cluster(cluster) for cluster in cluster_candidates(candidates)]
    state_order = {"high_priority": 0, "review": 1, "watch": 2, "reject": 3}
    cards.sort(key=lambda card: (state_order[card["state"]], -card["evidence_confidence"]))
    write_jsonl(args.output_dir / "candidates.jsonl", candidates)
    write_jsonl(args.output_dir / "pulse-cards.jsonl", cards)
    write_jsonl(args.output_dir / "pulse-active.jsonl", [card for card in cards if card["state"] != "reject"])
    (args.output_dir / "run-status.json").write_text(
        json.dumps(
            {
                "sources": statuses,
                "candidate_count": len(candidates),
                "card_count": len(cards),
                "active_card_count": sum(card["state"] != "reject" for card in cards),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(json.dumps({"candidates": len(candidates), "cards": len(cards), "sources": statuses}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
