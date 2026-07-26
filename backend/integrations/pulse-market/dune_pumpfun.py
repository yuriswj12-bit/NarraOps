"""Read the five Pump.fun aggregate metrics used by the Pulse market index."""

from __future__ import annotations

import json
import os
import re
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation


API_ROOT = "https://api.dune.com/api/v1/query"
QUERY_IDS = {
    "daily_tokens_created": 4861426,
    "tokens_launched_24h": 3979030,
    "graduated_tokens_24h": 3979025,
    "daily_active_wallets": 4903519,
    "daily_revenue_usd": 3759856,
}
FIELD_ALIASES = {
    "daily_tokens_created": (
        "daily_tokens_created",
        "daily_token_count",
        "tokens_created",
        "tokens",
        "count",
    ),
    "tokens_launched_24h": ("tokens_launched", "tokens_launched_24h", "count"),
    "graduated_tokens_24h": (
        "graduated_tokens",
        "graduated_tokens_24h",
        "withdraw_token_last_24h",
        "count",
    ),
    "daily_active_wallets": ("daily_active_wallets", "active_wallets", "wallets", "count"),
    "daily_revenue_usd": ("daily_revenue", "revenue", "revenue_usd", "amount_usd"),
}


@dataclass(frozen=True)
class DuneMetric:
    value: Decimal
    rows: tuple[dict, ...]
    query_id: int


def _decimal(value: object) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value).replace(",", "").replace("$", ""))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() and parsed >= 0 else None


def _result_rows(payload: dict) -> list[dict]:
    result = payload.get("result") or {}
    rows = result.get("rows")
    if not isinstance(rows, list):
        raise ValueError("Dune response did not contain result.rows")
    return [row for row in rows if isinstance(row, dict)]


def extract_metric(metric_name: str, payload: dict) -> DuneMetric:
    rows = _result_rows(payload)
    aliases = FIELD_ALIASES[metric_name]
    for row in rows:
        lowered = {
            re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_"): value
            for key, value in row.items()
        }
        for alias in aliases:
            parsed = _decimal(lowered.get(alias))
            if parsed is not None:
                return DuneMetric(parsed, tuple(rows), QUERY_IDS[metric_name])
    columns = sorted({str(key) for row in rows for key in row})
    raise ValueError(
        f"Query {QUERY_IDS[metric_name]} has no recognized field for "
        f"{metric_name}; columns={columns}"
    )


def fetch_query(query_id: int, api_key: str, timeout_seconds: int = 30) -> dict:
    request = urllib.request.Request(
        f"{API_ROOT}/{query_id}/results?limit=1000",
        headers={"x-dune-api-key": api_key, "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        return json.load(response)


def fetch_pumpfun_metrics(api_key: str | None = None) -> dict[str, DuneMetric]:
    secret = api_key or os.environ.get("DUNE_API_KEY")
    if not secret:
        raise RuntimeError("DUNE_API_KEY is required")
    return {
        name: extract_metric(name, fetch_query(query_id, secret))
        for name, query_id in QUERY_IDS.items()
    }
