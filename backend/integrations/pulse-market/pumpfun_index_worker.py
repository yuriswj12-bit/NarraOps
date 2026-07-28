"""Collect Dune Pump.fun aggregates and upsert a Pulse index snapshot."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from dune_pumpfun import QUERY_IDS, fetch_pumpfun_metrics
from market_index import calculate_index


def supabase_request(path: str, method: str = "GET", body: object | None = None):
    base_url = os.environ["SUPABASE_URL"].rstrip("/")
    secret = os.environ["SUPABASE_SECRET_KEY"]
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/rest/v1/{path}",
        data=data,
        method=method,
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def load_history() -> list[dict]:
    select = ",".join((*QUERY_IDS.keys(), "observed_at"))
    query = urllib.parse.urlencode(
        {"select": select, "order": "observed_at.desc", "limit": "90"},
        safe=",.",
    )
    rows = supabase_request(f"pulse_pumpfun_market_observations?{query}") or []
    return list(reversed(rows))


def run() -> dict:
    if os.getenv("DUNE_PIPELINE_RETIRED", "").lower() == "true":
        raise RuntimeError(
            "The scheduled Dune collector is retired; use the direct Solana collector."
        )
    metrics = fetch_pumpfun_metrics()
    current = {name: str(metric.value) for name, metric in metrics.items()}
    calculated = calculate_index(current, load_history())
    now = datetime.now(timezone.utc)
    payload = {
        "observation_bucket": now.replace(minute=0, second=0, microsecond=0).isoformat(),
        "observed_at": now.isoformat(),
        **current,
        **{
            f"{name}_score": calculated["components"][name]["score"]
            for name in QUERY_IDS
        },
        "market_activity_index": calculated["value"],
        "calculation_status": calculated["status"],
        "component_status": calculated["components"],
        "source_status": {
            name: {"provider": "dune", "query_id": query_id, "status": "complete"}
            for name, query_id in QUERY_IDS.items()
        },
    }
    rows = supabase_request(
        "pulse_pumpfun_market_observations?on_conflict=observation_bucket",
        "POST",
        payload,
    )
    return rows[0] if rows else payload


if __name__ == "__main__":
    result = run()
    print(
        json.dumps(
            {
                "status": result["calculation_status"],
                "observed_at": result["observed_at"],
                "market_activity_index": result["market_activity_index"],
            }
        )
    )
