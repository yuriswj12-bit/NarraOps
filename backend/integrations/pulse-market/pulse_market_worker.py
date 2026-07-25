"""One-shot Pulse market collector designed for a cloud cron/worker.

GMGN Trenches is used only as a bounded event-discovery source. Because the
route is capped, its row count is never published as a full-market total.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


PLATFORMS = (
    "Pump.fun",
    "pump_mayhem",
    "pump_mayhem_agent",
    "pump_agent",
    "letsbonk",
    "bonkers",
    "bags",
)


def run_gmgn() -> dict:
    command = [
        os.getenv("GMGN_CLI_PATH", "gmgn-cli"),
        "market",
        "trenches",
        "--chain",
        "sol",
        "--raw",
        "--type",
        "new_creation",
        "--type",
        "completed",
    ]
    for platform in PLATFORMS:
        command.extend(("--launchpad-platform", platform))
    command.extend(("--limit", "80"))
    completed = subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        timeout=int(os.getenv("PULSE_GMGN_TIMEOUT_SECONDS", "30")),
    )
    return json.loads(completed.stdout)


def normalize_events(payload: dict, observed_at: str) -> list[dict]:
    events: dict[str, dict] = {}
    for category in ("new_creation", "completed"):
        for row in payload.get(category, []):
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
                "launchpad_platform": row.get("launchpad_platform"),
                "launched_at": launched,
                "graduated_at": complete or current.get("graduated_at"),
                "source": "gmgn",
                "source_coverage": "bounded_sample",
                "observed_at": observed_at,
            }
    return list(events.values())


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

    def upsert_partial_observation(self, observed_at: str) -> None:
        row = {
            "observed_on": observed_at[:10],
            "long_term_dev_count": self.status_count("long_term"),
            "recent_dev_count": self.status_count("recent"),
            "daily_launch_count": None,
            "graduated_count": None,
            "dex_volume_usd": None,
            "calculation_status": "partial_data",
            "component_status": {
                "long_term_dev_count": "bounded_registry",
                "recent_dev_count": "bounded_registry",
                "daily_launch_count": "complete_provider_required",
                "graduated_count": "complete_provider_required",
                "dex_volume_usd": "complete_provider_required",
            },
            "source_status": {
                "gmgn": "bounded_sample",
                "market_totals": "not_configured",
            },
            "observed_at": observed_at,
        }
        self.request(
            "POST",
            "pulse_market_observations?on_conflict=observed_on",
            row,
            "resolution=merge-duplicates,return=minimal",
        )


def main() -> int:
    observed_at = datetime.now(timezone.utc).isoformat()
    payload = run_gmgn()
    events = normalize_events(payload, observed_at)
    database = SupabaseRest()
    database.upsert_events(events)
    database.refresh_wallets(observed_at)
    database.upsert_partial_observation(observed_at)
    print(
        json.dumps(
            {
                "status": "partial_data",
                "source": "gmgn",
                "coverage": "bounded_sample",
                "events_upserted": len(events),
                "observed_at": observed_at,
                "index_published": False,
                "missing_complete_sources": [
                    "daily_launch_count",
                    "graduated_count",
                    "dex_volume_usd",
                ],
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
