#!/usr/bin/env python3
"""Probe optional X API readiness without logging credentials."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request


def probe_x(query: str) -> dict:
    token = os.environ.get("X_BEARER_TOKEN")
    if not token:
        return {
            "provider": "x",
            "status": "not_configured",
            "required_secret": "X_BEARER_TOKEN",
            "suitable_for_one_hour_feed": True,
        }
    params = urllib.parse.urlencode(
        {
            "query": query,
            "max_results": 10,
            "tweet.fields": "created_at,author_id,attachments",
            "expansions": "author_id,attachments.media_keys",
            "user.fields": "username,name",
            "media.fields": "type,url,preview_image_url",
        }
    )
    request = urllib.request.Request(
        f"https://api.x.com/2/tweets/search/recent?{params}",
        headers={"Authorization": f"Bearer {token}", "User-Agent": "NarraOps/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.load(response)
        return {
            "provider": "x",
            "status": "success",
            "result_count": int(payload.get("meta", {}).get("result_count", 0)),
            "has_media_expansion": bool(payload.get("includes", {}).get("media")),
            "suitable_for_one_hour_feed": True,
        }
    except urllib.error.HTTPError as error:
        return {
            "provider": "x",
            "status": "unauthorized" if error.code in {401, 403} else "upstream_error",
            "http_status": error.code,
            "suitable_for_one_hour_feed": True,
        }
    except (urllib.error.URLError, TimeoutError):
        return {
            "provider": "x",
            "status": "unavailable",
            "suitable_for_one_hour_feed": True,
        }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--x-query",
        default="(meme OR viral) -is:retweet",
        help="X recent-search query used only when X_BEARER_TOKEN is configured.",
    )
    args = parser.parse_args()
    print(
        json.dumps(
            {
                "x": probe_x(args.x_query),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
