#!/usr/bin/env python3
"""Collect a bounded GMGN Dev-wallet PnL batch and persist auditable snapshots."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

PERIOD_MAP = {"24h": "1d", "7d": "7d", "30d": "30d"}
TIERS = ("A-Core", "B-Primary", "C-Watch")


class ProviderCooldown(RuntimeError):
    def __init__(self, wait_seconds: int, message: str) -> None:
        super().__init__(message)
        self.wait_seconds = wait_seconds


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def supabase_headers(secret: str, prefer: str | None = None) -> dict[str, str]:
    headers = {"apikey": secret, "content-type": "application/json"}
    if not secret.startswith("sb_secret_"):
        headers["authorization"] = f"Bearer {secret}"
    if prefer:
        headers["prefer"] = prefer
    return headers


class Supabase:
    def __init__(self) -> None:
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.secret = os.environ.get("SUPABASE_SECRET_KEY", "")
        if not self.url or not self.secret:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")

    def request(
        self,
        path: str,
        method: str = "GET",
        body: object | None = None,
        prefer: str | None = None,
    ):
        request = urllib.request.Request(
            f"{self.url}/rest/v1/{path}",
            data=None if body is None else json.dumps(body).encode("utf-8"),
            method=method,
            headers=supabase_headers(self.secret, prefer),
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                content = response.read()
                return json.loads(content) if content else None
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path} failed ({error.code}): {detail}") from error


def load_active_wallets(db: Supabase, limit: int) -> tuple[list[dict], int]:
    eligible_count = 0
    offset = 0
    page_size = 1000
    while True:
        query = urllib.parse.urlencode(
            {
                "select": "creator_wallet",
                "status": "eq.active",
                "limit": str(page_size),
                "offset": str(offset),
            }
        )
        page = db.request(f"pulse_dev_wallet_sample?{query}") or []
        eligible_count += len(page)
        if len(page) < page_size:
            break
        offset += page_size

    base_quota, remainder = divmod(limit, len(TIERS))
    selected: list[dict] = []
    for index, tier in enumerate(TIERS):
        quota = base_quota + (1 if index < remainder else 0)
        if not quota:
            continue
        query = urllib.parse.urlencode(
            {
                "select": "creator_wallet,tier,sample_score",
                "status": "eq.active",
                "tier": f"eq.{tier}",
                "or": f"(pnl_next_retry_at.is.null,pnl_next_retry_at.lte.{iso(utc_now())})",
                "order": "pnl_last_collected_at.asc.nullsfirst,sample_score.desc",
                "limit": str(quota),
            }
        )
        selected.extend(db.request(f"pulse_dev_wallet_sample?{query}") or [])
    return selected, eligible_count


def rate_limit_wait_seconds(message: str) -> int | None:
    if "429" not in message and "RATE_LIMIT" not in message:
        return None
    match = re.search(r"~(\d+)s remaining", message)
    if match:
        return int(match.group(1)) + 5
    return 65


def gmgn_stats(
    cli: str,
    wallet: str,
    source_period: str,
    timeout: int,
    max_retries: int,
    max_rate_limit_wait: int,
) -> dict:
    command = [
        cli,
        "portfolio",
        "stats",
        "--chain",
        "sol",
        "--wallet",
        wallet,
        "--period",
        source_period,
        "--raw",
    ]
    for attempt in range(max_retries + 1):
        process = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if not process.returncode:
            return json.loads(process.stdout)
        message = " ".join((process.stderr or process.stdout).split())[:500]
        wait_seconds = rate_limit_wait_seconds(message)
        if wait_seconds is None or attempt == max_retries:
            raise RuntimeError(message or f"gmgn-cli exited {process.returncode}")
        if wait_seconds > max_rate_limit_wait:
            raise ProviderCooldown(wait_seconds, message)
        time.sleep(wait_seconds)
    raise RuntimeError("unreachable GMGN retry state")


def decimal_value(payload: dict, key: str, required: bool = False) -> Decimal | None:
    value = payload.get(key)
    if value in (None, ""):
        if required:
            raise ValueError(f"GMGN response is missing {key}")
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation as error:
        raise ValueError(f"GMGN {key} is not numeric") from error


def observation(wallet: dict, timeframe: str, payload: dict, observed_at: str, run_id: int) -> dict:
    source_period = PERIOD_MAP[timeframe]
    realized = decimal_value(payload, "realized_profit", required=True)
    assert realized is not None
    last_timestamp = payload.get("last_timestamp")
    last_activity = None
    if isinstance(last_timestamp, (int, float)) and last_timestamp > 0:
        last_activity = iso(datetime.fromtimestamp(last_timestamp, timezone.utc))
    return {
        "creator_wallet": wallet["creator_wallet"],
        "timeframe": timeframe,
        "observed_at": observed_at,
        "realized_pnl_usd": str(realized),
        "buy_usd": _decimal_string(payload, "buy"),
        "sell_usd": _decimal_string(payload, "sell"),
        "bought_cost_usd": _decimal_string(payload, "bought_cost"),
        "sold_income_usd": _decimal_string(payload, "sold_income"),
        "last_activity_at": last_activity,
        "source_period": source_period,
        "source_status": "complete",
        "source_payload": {
            "realized_profit_pnl": payload.get("realized_profit_pnl"),
            "total_cost": payload.get("total_cost"),
        },
        "collection_run_id": run_id,
        "updated_at": observed_at,
    }


def _decimal_string(payload: dict, key: str) -> str | None:
    value = decimal_value(payload, key)
    return None if value is None else str(value)


def build_snapshot(
    timeframe: str,
    observed_at: str,
    observations: list[dict],
    tiers_by_wallet: dict[str, str],
    eligible_count: int,
    run_id: int,
) -> dict:
    values = [(row["creator_wallet"], Decimal(row["realized_pnl_usd"])) for row in observations]
    tier_totals = defaultdict(Decimal)
    for wallet, value in values:
        tier_totals[tiers_by_wallet[wallet]] += value
    included = len(values)
    coverage = Decimal(included * 100) / Decimal(eligible_count) if eligible_count else Decimal(0)
    return {
        "snapshot_at": observed_at,
        "timeframe": timeframe,
        "total_realized_pnl_usd": str(sum((value for _, value in values), Decimal(0))),
        "included_wallet_count": included,
        "profitable_wallet_count": sum(value > 0 for _, value in values),
        "losing_wallet_count": sum(value < 0 for _, value in values),
        "zero_pnl_wallet_count": sum(value == 0 for _, value in values),
        "a_core_pnl_usd": str(tier_totals["A-Core"]),
        "b_primary_pnl_usd": str(tier_totals["B-Primary"]),
        "c_watch_pnl_usd": str(tier_totals["C-Watch"]),
        "eligible_wallet_count": eligible_count,
        "data_coverage_pct": str(min(coverage, Decimal(100))),
        "source_status": "ready" if included == eligible_count and eligible_count else "partial",
        "collection_run_id": run_id,
    }


def run(
    limit: int,
    timeout: int,
    delay: float,
    max_retries: int,
    max_rate_limit_wait: int,
) -> dict:
    cli = shutil.which("gmgn-cli.cmd") or shutil.which("gmgn-cli")
    if not cli:
        raise RuntimeError("gmgn-cli is not installed")
    db = Supabase()
    started = utc_now()
    started_at = iso(started)
    run_rows = db.request(
        "pulse_dev_pnl_collection_runs",
        "POST",
        {
            "started_at": started_at,
            "status": "running",
            "requested_timeframes": list(PERIOD_MAP),
        },
        "return=representation",
    )
    run_id = int(run_rows[0]["id"])
    wallets, eligible_count = load_active_wallets(db, limit)
    observations_by_period: dict[str, list[dict]] = defaultdict(list)
    failures: list[dict] = []
    succeeded_wallets = set()
    provider_cooldown_seconds: int | None = None

    for wallet in wallets:
        wallet_ok = True
        wallet_observations: list[dict] = []
        for timeframe, source_period in PERIOD_MAP.items():
            try:
                payload = gmgn_stats(
                    cli,
                    wallet["creator_wallet"],
                    source_period,
                    timeout,
                    max_retries,
                    max_rate_limit_wait,
                )
                row = observation(wallet, timeframe, payload, started_at, run_id)
                observations_by_period[timeframe].append(row)
                wallet_observations.append(row)
            except ProviderCooldown as error:
                wallet_ok = False
                provider_cooldown_seconds = error.wait_seconds
                failures.append(
                    {
                        "wallet_suffix": wallet["creator_wallet"][-6:],
                        "timeframe": timeframe,
                        "error": "provider_rate_limit_cooldown",
                        "retry_after_seconds": error.wait_seconds,
                    }
                )
                break
            except Exception as error:
                wallet_ok = False
                failures.append(
                    {
                        "wallet_suffix": wallet["creator_wallet"][-6:],
                        "timeframe": timeframe,
                        "error": str(error)[:300],
                    }
                )
            if delay:
                time.sleep(delay)
        if wallet_observations:
            db.request(
                "pulse_dev_wallet_period_pnl?on_conflict=creator_wallet,timeframe,observed_at",
                "POST",
                wallet_observations,
                "resolution=merge-duplicates,return=minimal",
            )
        db.request(
            "rpc/mark_pulse_dev_pnl_wallet_collection",
            "POST",
            {
                "p_creator_wallet": wallet["creator_wallet"],
                "p_collected_at": started_at,
                "p_complete": wallet_ok,
            },
            "return=minimal",
        )
        if wallet_ok:
            succeeded_wallets.add(wallet["creator_wallet"])
        if provider_cooldown_seconds is not None:
            break

    observations = [row for rows in observations_by_period.values() for row in rows]
    snapshots = []
    if observations:
        snapshots = db.request(
            "rpc/refresh_pulse_dev_wallet_pnl_snapshots",
            "POST",
            {"p_snapshot_at": started_at, "p_collection_run_id": run_id},
        ) or []
    status = "completed" if not failures else ("partial" if observations else "failed")
    db.request(
        f"pulse_dev_pnl_collection_runs?id=eq.{run_id}",
        "PATCH",
        {
            "completed_at": iso(utc_now()),
            "status": status,
            "wallets_attempted": len(wallets),
            "wallets_succeeded": len(succeeded_wallets),
            "wallets_failed": len(wallets) - len(succeeded_wallets),
            "observations_written": len(observations),
            "snapshots_created": len(snapshots),
            "cursor_wallet": wallets[-1]["creator_wallet"] if wallets else None,
            "error_summary": {"failures": failures[:50]},
        },
        "return=minimal",
    )
    return {
        "run_id": run_id,
        "status": status,
        "eligible_wallets": eligible_count,
        "wallets_attempted": len(wallets),
        "wallets_succeeded": len(succeeded_wallets),
        "observations_written": len(observations),
        "provider_cooldown_seconds": provider_cooldown_seconds,
        "snapshots": [
            {
                "timeframe": row["timeframe"],
                "total_realized_pnl_usd": row["total_realized_pnl_usd"],
                "included_wallet_count": row["included_wallet_count"],
                "data_coverage_pct": row["data_coverage_pct"],
            }
            for row in snapshots
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--delay", type=float, default=2.0)
    parser.add_argument("--max-retries", type=int, default=2)
    parser.add_argument("--max-rate-limit-wait", type=int, default=75)
    args = parser.parse_args()
    if args.limit < 1 or args.limit > 100:
        parser.error("--limit must be between 1 and 100 during Phase 3")
    if args.max_retries < 0 or args.max_retries > 5:
        parser.error("--max-retries must be between 0 and 5")
    if args.max_rate_limit_wait < 0 or args.max_rate_limit_wait > 300:
        parser.error("--max-rate-limit-wait must be between 0 and 300 seconds")
    try:
        result = run(
            args.limit,
            args.timeout,
            args.delay,
            args.max_retries,
            args.max_rate_limit_wait,
        )
    except Exception as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
