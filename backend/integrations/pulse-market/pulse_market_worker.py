"""One-shot Pulse market collector designed for a cloud cron/worker.

GMGN Trenches is used only as a bounded event-discovery source. Because the
route is capped, its row count is never published as a full-market total.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone


PLATFORMS = (
    "Pump.fun",
    "pump_mayhem",
    "pump_mayhem_agent",
    "pump_agent",
    "letsbonk",
    "bonkers",
    "bags",
    "memoo",
    "liquid",
    "bankr",
    "zora",
    "surge",
    "anoncoin",
    "moonshot_app",
    "wendotdev",
    "heaven",
    "sugar",
    "token_mill",
    "believe",
    "trendsfun",
    "trends_fun",
    "jup_studio",
    "Moonshot",
    "boop",
    "ray_launchpad",
    "meteora_virtual_curve",
)
TRENCH_TYPES = ("new_creation", "completed")
TRENCH_LIMIT = 80


def run_gmgn_query(platform: str, category: str) -> tuple[str, str, dict]:
    configured_cli = os.getenv("GMGN_CLI_PATH")
    cli_path = (
        configured_cli
        or shutil.which("gmgn-cli")
        or shutil.which("gmgn-cli.cmd")
        or "gmgn-cli"
    )
    command = [
        cli_path,
        "market",
        "trenches",
        "--chain",
        "sol",
        "--raw",
        "--type",
        category,
        "--launchpad-platform",
        platform,
        "--limit",
        str(TRENCH_LIMIT),
    ]
    if category == "new_creation":
        command.extend(
            ("--max-created", f"{int(os.getenv('PULSE_POLL_WINDOW_MINUTES', '1'))}m")
        )
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=int(os.getenv("PULSE_GMGN_TIMEOUT_SECONDS", "30")),
    )
    return platform, category, json.loads(completed.stdout)


def run_gmgn() -> tuple[list[tuple[str, str, dict]], dict]:
    results: list[tuple[str, str, dict]] = []
    failures: list[dict] = []
    saturated: list[dict] = []
    jobs = [(platform, category) for platform in PLATFORMS for category in TRENCH_TYPES]
    with ThreadPoolExecutor(
        max_workers=int(os.getenv("PULSE_GMGN_CONCURRENCY", "3"))
    ) as executor:
        futures = {
            executor.submit(run_gmgn_query, platform, category): (platform, category)
            for platform, category in jobs
        }
        for future in as_completed(futures):
            platform, category = futures[future]
            try:
                result = future.result()
                results.append(result)
                rows = poll_window_rows(result[2], category)
                if len(rows) >= TRENCH_LIMIT:
                    saturated.append(
                        {"platform": platform, "category": category, "rows": len(rows)}
                    )
            except Exception as error:
                failures.append(
                    {
                        "platform": platform,
                        "category": category,
                        "error": type(error).__name__,
                    }
                )
    return results, {
        "expected_calls": len(jobs),
        "succeeded_calls": len(results),
        "failed_calls": failures,
        "saturated_calls": saturated,
    }


def category_rows(payload: dict, category: str) -> list[dict]:
    if category == "new_creation":
        return payload.get("new_creation", [])
    return payload.get("completed", [])


def poll_window_rows(payload: dict, category: str) -> list[dict]:
    rows = category_rows(payload, category)
    if category == "new_creation":
        return rows
    cutoff = int(time.time()) - int(os.getenv("PULSE_POLL_WINDOW_MINUTES", "1")) * 60
    return [
        row
        for row in rows
        if int(row.get("complete_timestamp") or 0) >= cutoff
    ]


def normalize_events(
    results: list[tuple[str, str, dict]], observed_at: str
) -> list[dict]:
    events: dict[str, dict] = {}
    for platform, category, payload in results:
        for row in category_rows(payload, category):
            token = row.get("address")
            creator = row.get("creator")
            launched = timestamp(row.get("created_timestamp"))
            if not token or not creator or not launched:
                continue
            complete = timestamp(row.get("complete_timestamp"))
            current = events.get(token, {})
            events[token] = {
                "chain": "solana",
                "token_address": token,
                "creator_address": creator,
                "launchpad_platform": row.get("launchpad_platform") or platform,
                "launched_at": launched,
                "graduated_at": complete or current.get("graduated_at"),
                "source": "gmgn",
                "source_coverage": "continuous_poll",
                "observed_at": observed_at,
            }
    return list(events.values())


def fetch_solana_dex_volume() -> int:
    url = (
        "https://api.llama.fi/overview/dexs/Solana"
        "?excludeTotalDataChart=true"
        "&excludeTotalDataChartBreakdown=true"
        "&dataType=dailyVolume"
    )
    request = urllib.request.Request(
        url,
        headers={"user-agent": "NarraOps Pulse Market Worker/1.0"},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read())
    value = payload.get("total24h")
    if not isinstance(value, (int, float)) or value < 0:
        raise RuntimeError("DefiLlama response is missing total24h")
    return int(value)


def timestamp(value: object) -> str | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return datetime.fromtimestamp(parsed, tz=timezone.utc).isoformat()


class SupabaseRest:
    def __init__(self) -> None:
        self.url = os.environ["SUPABASE_URL"].rstrip("/")
        self.key = (
            os.getenv("SUPABASE_SECRET_KEY")
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or ""
        )
        if not self.key:
            raise RuntimeError("SUPABASE_SECRET_KEY is required")

    def request(
        self,
        method: str,
        path: str,
        body: object | None = None,
        prefer: str | None = None,
    ) -> object:
        headers = {
            "apikey": self.key,
            "authorization": f"Bearer {self.key}",
            "content-type": "application/json",
        }
        if prefer:
            headers["prefer"] = prefer
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = urllib.request.Request(
            f"{self.url}/rest/v1/{path}",
            data=data,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase request failed ({error.code}): {detail}") from error
        return json.loads(payload) if payload else None

    def upsert_events(self, events: list[dict]) -> None:
        if not events:
            return
        self.request(
            "POST",
            "pulse_launch_events?on_conflict=chain,token_address",
            events,
            "resolution=merge-duplicates,return=minimal",
        )

    def insert_collection_run(
        self, observed_at: str, diagnostics: dict, event_count: int
    ) -> None:
        self.request(
            "POST",
            "pulse_market_collection_runs",
            {
                "observed_at": observed_at,
                "poll_window_minutes": int(
                    os.getenv("PULSE_POLL_WINDOW_MINUTES", "1")
                ),
                "platform_count": len(PLATFORMS),
                "expected_calls": diagnostics["expected_calls"],
                "succeeded_calls": diagnostics["succeeded_calls"],
                "failed_call_count": len(diagnostics["failed_calls"]),
                "saturated_call_count": len(diagnostics["saturated_calls"]),
                "event_count": event_count,
                "details": diagnostics,
            },
            "return=minimal",
        )

    def refresh_wallets(self, observed_at: str) -> None:
        self.request(
            "POST",
            "rpc/refresh_pulse_dev_wallets",
            {
                "p_observed_at": observed_at,
                "p_long_term_age_days": int(
                    os.getenv("PULSE_LONG_TERM_AGE_DAYS", "60")
                ),
                "p_long_term_window_days": int(
                    os.getenv("PULSE_LONG_TERM_WINDOW_DAYS", "15")
                ),
                "p_long_term_daily_launches": int(
                    os.getenv("PULSE_LONG_TERM_DAILY_LAUNCHES", "20")
                ),
                "p_recent_age_days": int(os.getenv("PULSE_RECENT_AGE_DAYS", "10")),
                "p_inactive_days": int(os.getenv("PULSE_INACTIVE_DAYS", "10")),
            },
            "return=minimal",
        )

    def status_count(self, status: str) -> int:
        encoded = urllib.parse.quote(status)
        rows = self.request(
            "GET",
            f"pulse_dev_wallets?select=wallet_address&lifecycle_status=eq.{encoded}",
        )
        return len(rows or [])

    def event_totals(self, observed_at: str) -> dict:
        rows = self.request(
            "POST",
            "rpc/pulse_market_event_totals",
            {"p_observed_at": observed_at},
        )
        return (rows or [{}])[0]

    def coverage(self, observed_at: str) -> dict:
        rows = self.request(
            "POST",
            "rpc/pulse_market_collection_coverage",
            {
                "p_observed_at": observed_at,
                "p_required_hours": 24,
            },
        )
        return (rows or [{}])[0]

    def upsert_observation(self, observed_at: str, dex_volume_usd: int) -> dict:
        coverage = self.coverage(observed_at)
        complete = bool(coverage.get("is_complete"))
        totals = self.event_totals(observed_at) if complete else {}
        row = {
            "observed_on": observed_at[:10],
            "long_term_dev_count": self.status_count("long_term"),
            "recent_dev_count": self.status_count("recent"),
            "daily_launch_count": totals.get("daily_launch_count") if complete else None,
            "graduated_count": totals.get("graduated_count") if complete else None,
            "dex_volume_usd": dex_volume_usd,
            "calculation_status": "partial_data",
            "component_status": {
                "long_term_dev_count": "warming_up_60d",
                "recent_dev_count": "warming_up_10d",
                "daily_launch_count": "complete" if complete else "warming_up_24h",
                "graduated_count": "complete" if complete else "warming_up_24h",
                "dex_volume_usd": "complete",
            },
            "source_status": {
                "gmgn": "continuous_per_platform_poll",
                "collection_coverage": coverage,
                "dex_volume": "defillama_solana_chain_total",
            },
            "observed_at": observed_at,
        }
        self.request(
            "POST",
            "pulse_market_observations?on_conflict=observed_on",
            row,
            "resolution=merge-duplicates,return=minimal",
        )
        return {"coverage": coverage, "totals": totals}


def main() -> int:
    observed_at = datetime.now(timezone.utc).isoformat()
    results, diagnostics = run_gmgn()
    events = normalize_events(results, observed_at)
    dex_volume_usd = fetch_solana_dex_volume()
    database = SupabaseRest()
    database.upsert_events(events)
    database.insert_collection_run(observed_at, diagnostics, len(events))
    database.refresh_wallets(observed_at)
    observation = database.upsert_observation(observed_at, dex_volume_usd)
    index_published = bool(
        observation["coverage"].get("is_complete")
        and observation["totals"].get("daily_launch_count") is not None
    )
    print(
        json.dumps(
            {
                "status": "partial_data",
                "sources": ["gmgn", "defillama"],
                "coverage": observation["coverage"],
                "events_upserted": len(events),
                "calls_succeeded": diagnostics["succeeded_calls"],
                "calls_failed": len(diagnostics["failed_calls"]),
                "calls_saturated": len(diagnostics["saturated_calls"]),
                "dex_volume_usd": dex_volume_usd,
                "observed_at": observed_at,
                "index_published": index_published,
            }
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(
            json.dumps(
                {"status": "failed", "error": type(error).__name__, "message": str(error)}
            ),
            file=sys.stderr,
        )
        raise SystemExit(1)
