#!/usr/bin/env python3
"""Fetch and normalize public evidence for Pulse historical research.

The worker deliberately does not execute JavaScript or use authenticated browser
sessions. Dynamic social platforms are reported honestly for a later adapter.
Fetched page content is untrusted data and is never executed as instructions.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import socket
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup


DYNAMIC_HOSTS = {
    "x.com",
    "twitter.com",
    "www.instagram.com",
    "instagram.com",
    "www.tiktok.com",
    "tiktok.com",
}
MAX_BYTES = 2_000_000
MAX_REDIRECTS = 4
ALLOWED_CONTENT_TYPES = ("text/html", "text/plain", "application/json")
USER_AGENT = "NarraOpsPulseResearch/0.1 (+public evidence fetcher)"


def result_shell(url: str, source_field: str | None = None) -> dict[str, Any]:
    return {
        "url": url,
        "source_field": source_field,
        "fetch_status": "unavailable",
        "http_status": None,
        "final_url": None,
        "page_title": None,
        "author": None,
        "published_at": None,
        "relevant_excerpt": None,
        "extracted_claims": [],
        "content_hash": None,
        "signals": {},
        "shared_source": False,
        "shared_with": [],
        "notes": [],
        "content_trust": "untrusted_external_content",
    }


def _validate_host(hostname: str) -> None:
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(hostname, None)}
    except socket.gaierror as exc:
        raise ValueError("dns_resolution_failed") from exc
    if not addresses:
        raise ValueError("dns_resolution_failed")
    for raw in addresses:
        ip = ipaddress.ip_address(raw)
        if any(
            (
                ip.is_private,
                ip.is_loopback,
                ip.is_link_local,
                ip.is_multicast,
                ip.is_reserved,
                ip.is_unspecified,
            )
        ):
            raise ValueError("private_or_reserved_target")


def validate_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("unsupported_scheme")
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("invalid_authority")
    _validate_host(parsed.hostname)
    return parsed.hostname.lower()


def classify_platform(hostname: str) -> str:
    host = hostname.lower()
    if host in DYNAMIC_HOSTS or any(host.endswith(f".{item}") for item in DYNAMIC_HOSTS):
        return "dynamic_social"
    if host in {"youtube.com", "www.youtube.com", "youtu.be"}:
        return "youtube"
    if host.endswith("reddit.com"):
        return "reddit"
    return "static_web"


def _extract_html(content: bytes, encoding: str | None) -> dict[str, Any]:
    text = content.decode(encoding or "utf-8", errors="replace")
    soup = BeautifulSoup(text, "html.parser")
    for node in soup(["script", "style", "noscript", "svg", "nav", "footer"]):
        node.decompose()
    title = soup.title.get_text(" ", strip=True) if soup.title else None
    author_tag = soup.find("meta", attrs={"name": re.compile("author", re.I)})
    published_tag = soup.find(
        "meta",
        attrs={"property": re.compile(r"article:published_time", re.I)},
    )
    body = re.sub(r"\s+", " ", soup.get_text(" ", strip=True)).strip()
    return {
        "page_title": title,
        "author": author_tag.get("content") if author_tag else None,
        "published_at": published_tag.get("content") if published_tag else None,
        "body": body,
    }


def _signals(body: str, token: dict[str, Any]) -> dict[str, Any]:
    folded = body.casefold()
    address = str(token.get("token_address") or "")
    name = str(token.get("name") or "").strip()
    symbol = str(token.get("symbol") or "").strip()
    license_terms = ("exclusive license", "licensed by", "ip rights", "授权", "许可")
    endorsement_terms = ("official token", "official coin", "endorsed", "认领", "官方代币")
    return {
        "contract_address_match": bool(address and address.casefold() in folded),
        "token_name_match": bool(len(name) >= 3 and name.casefold() in folded),
        "symbol_match": bool(len(symbol) >= 3 and re.search(rf"(?<!\w){re.escape(symbol.casefold())}(?!\w)", folded)),
        "explicit_license_signal": any(term in folded for term in license_terms),
        "explicit_endorsement_signal": any(term in folded for term in endorsement_terms),
    }


def _relevant_excerpt(body: str, token: dict[str, Any], limit: int = 1200) -> str:
    """Prefer the page region that mentions the token or a distinctive name word."""
    candidates = [
        str(token.get("token_address") or "").strip(),
        str(token.get("name") or "").strip(),
        str(token.get("symbol") or "").strip(),
    ]
    generic = {"the", "official", "token", "coin", "meme", "memecoin"}
    name_words = re.findall(r"[A-Za-z0-9_]{4,}", str(token.get("name") or ""))
    candidates.extend(word for word in name_words if word.casefold() not in generic)
    folded = body.casefold()
    positions = [
        folded.find(term.casefold())
        for term in candidates
        if len(term) >= 3 and folded.find(term.casefold()) >= 0
    ]
    if not positions:
        return body[:limit]
    start = max(0, min(positions) - 240)
    return body[start : start + limit]


def fetch_static(
    url: str,
    token: dict[str, Any],
    source_field: str | None,
    timeout: float,
    session: requests.Session,
) -> dict[str, Any]:
    result = result_shell(url, source_field)
    result["platform_adapter"] = "static_web"
    current = url
    try:
        for _ in range(MAX_REDIRECTS + 1):
            validate_url(current)
            response = session.get(
                current,
                headers={"User-Agent": USER_AGENT, "Accept": "text/html,text/plain,application/json"},
                timeout=timeout,
                allow_redirects=False,
                stream=True,
            )
            result["http_status"] = response.status_code
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("Location")
                if not location:
                    result["fetch_status"] = "upstream_error"
                    result["notes"].append("redirect_without_location")
                    return result
                current = urljoin(current, location)
                continue
            break
        else:
            result["fetch_status"] = "upstream_error"
            result["notes"].append("redirect_limit_exceeded")
            return result

        result["final_url"] = current
        status = response.status_code
        if status in {401, 403}:
            result["fetch_status"] = "auth_required_or_blocked"
            return result
        if status == 404:
            result["fetch_status"] = "not_found"
            return result
        if status == 429:
            result["fetch_status"] = "rate_limited"
            return result
        if status >= 500:
            result["fetch_status"] = "upstream_error"
            return result
        if status != 200:
            result["fetch_status"] = "unavailable"
            return result

        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower()
        if content_type and not any(content_type.startswith(item) for item in ALLOWED_CONTENT_TYPES):
            result["fetch_status"] = "unsupported_content_type"
            result["notes"].append(content_type)
            return result

        chunks: list[bytes] = []
        size = 0
        for chunk in response.iter_content(65536):
            size += len(chunk)
            if size > MAX_BYTES:
                result["fetch_status"] = "response_too_large"
                return result
            chunks.append(chunk)
        content = b"".join(chunks)
        extracted = _extract_html(content, response.encoding)
        body = extracted.pop("body")
        result.update(extracted)
        result["content_hash"] = hashlib.sha256(content).hexdigest()
        excerpt = _relevant_excerpt(body, token)
        result["relevant_excerpt"] = excerpt or None
        result["extracted_claims"] = [excerpt] if excerpt else []
        result["signals"] = _signals(body, token)
        result["fetch_status"] = "success" if body else "empty_content"
        return result
    except requests.Timeout:
        result["fetch_status"] = "timeout"
    except requests.RequestException as exc:
        result["fetch_status"] = "upstream_error"
        result["notes"].append(type(exc).__name__)
    except ValueError as exc:
        result["fetch_status"] = "unsafe_or_invalid_url"
        result["notes"].append(str(exc))
    return result


def fetch_source(
    source: dict[str, Any], token: dict[str, Any], timeout: float, session: requests.Session
) -> dict[str, Any]:
    value = str(source.get("value") or "").strip()
    source_field = source.get("source_field")
    result = result_shell(value, source_field)
    try:
        hostname = validate_url(value)
    except ValueError as exc:
        result["fetch_status"] = "unsafe_or_invalid_url"
        result["notes"].append(str(exc))
        return result

    platform = classify_platform(hostname)
    result["platform_adapter"] = platform
    if platform == "dynamic_social":
        result["fetch_status"] = "dynamic_render_required"
        return result
    fetched = fetch_static(value, token, source_field, timeout, session)
    fetched["platform_adapter"] = platform
    return fetched


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid JSONL at line {line_number}: {exc}") from exc
            if not row.get("token_address"):
                raise ValueError(f"missing token_address at line {line_number}")
            rows.append(row)
    return rows


def process_rows(
    rows: list[dict[str, Any]], timeout: float = 10.0, workers: int = 8
) -> list[dict[str, Any]]:
    url_map: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        for source in row.get("provided_sources", []):
            value = str(source.get("value") or "").strip()
            if value:
                url_map[value].append(row["token_address"])

    output = [dict(row) for row in rows]
    for enriched in output:
        enriched["evidence_details"] = [None] * len(enriched.get("provided_sources", []))

    def run_source(row_index: int, source_index: int) -> tuple[int, int, dict[str, Any]]:
        row = rows[row_index]
        source = row.get("provided_sources", [])[source_index]
        with requests.Session() as session:
            detail = fetch_source(source, row, timeout, session)
        owners = url_map.get(detail["url"], [])
        detail["shared_source"] = len(owners) > 1
        detail["shared_with"] = [item for item in owners if item != row["token_address"]]
        return row_index, source_index, detail

    jobs = [
        (row_index, source_index)
        for row_index, row in enumerate(rows)
        for source_index, _ in enumerate(row.get("provided_sources", []))
    ]
    with ThreadPoolExecutor(max_workers=max(1, min(workers, 16))) as pool:
        futures = [pool.submit(run_source, row_index, source_index) for row_index, source_index in jobs]
        for future in as_completed(futures):
            row_index, source_index, detail = future.result()
            output[row_index]["evidence_details"][source_index] = detail
    return output


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--offset", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    rows = load_jsonl(args.input)
    selected = rows[args.offset : args.offset + args.limit if args.limit else None]
    output = process_rows(selected, timeout=args.timeout, workers=args.workers)
    write_jsonl(args.output, output)
    counts: dict[str, int] = defaultdict(int)
    for row in output:
        for detail in row.get("evidence_details", []):
            counts[detail["fetch_status"]] += 1
    print(json.dumps({"rows": len(output), "fetch_status": counts}, ensure_ascii=False, default=dict))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
