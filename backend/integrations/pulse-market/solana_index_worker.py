"""Collect bounded Pump.fun chain observations and write an hourly Pulse snapshot."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from market_index import calculate_index
from pump_chain import parse_pump_events, transaction_signature
from solana_rpc import fetch_pump_transactions
from wallet_sample import WalletCandidate, refresh_wallet_panel, should_sample_signature


def supabase(
    path: str,
    method: str = "GET",
    body: object | None = None,
    *,
    prefer: str = "return=representation,resolution=merge-duplicates",
):
    base = os.environ["SUPABASE_URL"].rstrip("/")
    secret = os.environ["SUPABASE_SECRET_KEY"]
    request = urllib.request.Request(
        f"{base}/rest/v1/{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Prefer": prefer,
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = response.read()
        return json.loads(payload) if payload else None


def query(table: str, **params) -> list[dict]:
    encoded = urllib.parse.urlencode(params, safe=",.*()")
    return supabase(f"{table}?{encoded}") or []


def query_all(
    table: str, *, page_size: int = 1_000, max_rows: int = 100_000, **params
) -> list[dict]:
    rows: list[dict] = []
    while len(rows) < max_rows:
        page = query(
            table,
            **params,
            limit=str(min(page_size, max_rows - len(rows))),
            offset=str(len(rows)),
        )
        rows.extend(page)
        if len(page) < page_size:
            break
    return rows


def collect_transactions(
    cursor: str | None, max_pages: int
) -> tuple[list[dict], str | None, bool]:
    collected: list[dict] = []
    token = None
    newest = None
    reached_cursor = cursor is None
    for _ in range(max_pages):
        rows, token = fetch_pump_transactions(pagination_token=token)
        if not rows:
            break
        newest = newest or transaction_signature(rows[0])
        for row in rows:
            if cursor and transaction_signature(row) == cursor:
                reached_cursor = True
            collected.append(row)
        if not token:
            break
    return collected, newest, reached_cursor


def estimate_daily_count(event_count: int, observed_seconds: int) -> int:
    if event_count < 0 or observed_seconds <= 0:
        raise ValueError("sample counts and duration must be positive")
    return round(event_count * 86_400 / observed_seconds)


def cleanup_retained_data(now: datetime, retention_days: int) -> str:
    if retention_days <= 0:
        raise ValueError("retention_days must be positive")
    cutoff = (now - timedelta(days=retention_days)).isoformat()
    encoded_cutoff = urllib.parse.quote(cutoff, safe=":-")
    supabase(
        f"pulse_pumpfun_chain_events?block_time=lt.{encoded_cutoff}",
        "DELETE",
        prefer="return=minimal",
    )
    # Candidate rows are no longer persisted: each run discovers fresh
    # candidates directly from the bounded chain sample.
    supabase(
        "pulse_wallet_sample_panel?status=eq.candidate",
        "DELETE",
        prefer="return=minimal",
    )
    supabase(
        "pulse_wallet_sample_panel"
        f"?status=eq.removed&removed_at=lt.{encoded_cutoff}",
        "DELETE",
        prefer="return=minimal",
    )
    return cutoff


def run() -> dict:
    now = datetime.now(timezone.utc)
    rate_bps = int(os.getenv("PULSE_SIGNATURE_SAMPLE_BPS", "200"))
    retention_cutoff = cleanup_retained_data(
        now, int(os.getenv("PULSE_RAW_RETENTION_DAYS", "30"))
    )
    state = query(
        "pulse_chain_collection_state",
        select="*",
        collector_id="eq.pump-mainnet",
        limit="1",
    )
    cursor = state[0].get("latest_signature") if state else None
    transactions, newest, reached_cursor = collect_transactions(
        cursor, int(os.getenv("PULSE_MAX_PAGES_PER_RUN", "20"))
    )
    coverage_status = "sampled"
    event_rows = []
    candidates: dict[str, datetime] = {}
    sample_events = []
    for transaction in transactions:
        signature = transaction_signature(transaction)
        sampled = should_sample_signature(signature, rate_bps)
        for event in parse_pump_events(transaction):
            sample_events.append(event)
            if event.user_address:
                candidates[event.user_address] = max(
                    candidates.get(event.user_address, event.block_time), event.block_time
                )
            if event.event_type in {"buy", "sell"} and not sampled:
                continue
            event_rows.append(
                {
                    "signature": event.signature,
                    "instruction_path": event.instruction_path,
                    "event_type": event.event_type,
                    "slot": event.slot,
                    "block_time": event.block_time.isoformat(),
                    "mint": event.mint,
                    "user_address": event.user_address,
                    "creator_address": event.creator_address,
                    "sampled": sampled,
                }
            )
    if event_rows:
        supabase(
            "pulse_pumpfun_chain_events?on_conflict=signature,instruction_path,event_type",
            "POST",
            event_rows,
        )

    panel_rows = query_all(
        "pulse_wallet_sample_panel", select="*", max_rows=20_000
    )
    existing_by_address = {row["address"]: row for row in panel_rows}
    current = [
        WalletCandidate(row["address"], datetime.fromisoformat(row["last_seen_at"]))
        for row in panel_rows
        if row["status"] == "included"
    ]
    available_by_address = {
        row["address"]: WalletCandidate(
            row["address"], datetime.fromisoformat(row["last_seen_at"])
        )
        for row in panel_rows
        if row["status"] == "included"
    }
    for address, seen in candidates.items():
        existing = available_by_address.get(address)
        if not existing or seen > existing.last_seen_at:
            available_by_address[address] = WalletCandidate(address, seen)
    available = list(available_by_address.values())
    replacements_already_today = sum(
        1
        for row in panel_rows
        if row["status"] == "removed"
        and row.get("removed_at")
        and datetime.fromisoformat(row["removed_at"]).astimezone(timezone.utc).date()
        == now.date()
    )
    panel, panel_audit = refresh_wallet_panel(
        current,
        available,
        now=now,
        target_size=int(os.getenv("PULSE_WALLET_PANEL_SIZE", "5000")),
        inactive_days=int(os.getenv("PULSE_WALLET_INACTIVE_DAYS", "14")),
        max_daily_replacement_rate=float(
            os.getenv("PULSE_WALLET_MAX_DAILY_REPLACEMENT_RATE", "0.05")
        ),
        replacements_already_today=replacements_already_today,
    )
    included = {item.address for item in panel}
    panel_payload = []
    for item in panel:
        existing = existing_by_address.get(item.address)
        panel_payload.append(
            {
                "address": item.address,
                "first_seen_at": (
                    existing["first_seen_at"]
                    if existing
                    else item.last_seen_at.isoformat()
                ),
                "last_seen_at": item.last_seen_at.isoformat(),
                "included_at": (
                    existing.get("included_at")
                    if existing and existing.get("included_at")
                    else now.isoformat()
                ),
                "removed_at": None,
                "panel_version": panel_audit["panel_version"],
                "status": "included",
                "updated_at": now.isoformat(),
            }
        )
    removed_addresses = {
        row["address"]
        for row in panel_rows
        if row["status"] == "included" and row["address"] not in included
    }
    for address in removed_addresses:
        existing = existing_by_address[address]
        panel_payload.append(
            {
                **existing,
                "status": "removed",
                "removed_at": now.isoformat(),
                "panel_version": panel_audit["panel_version"],
                "updated_at": now.isoformat(),
            }
        )
    if panel_payload:
        supabase("pulse_wallet_sample_panel?on_conflict=address", "POST", panel_payload)

    cutoff_time = now - timedelta(hours=24)
    sample_times = [
        datetime.fromtimestamp(int(row["blockTime"]), timezone.utc)
        for row in transactions
        if row.get("blockTime") is not None
    ]
    observed_seconds = (
        max(1, round((max(sample_times) - min(sample_times)).total_seconds()))
        if sample_times
        else 0
    )
    sample_launches = len(
        {event.mint for event in sample_events if event.event_type == "create"}
    )
    sample_graduations = len(
        {event.mint for event in sample_events if event.event_type == "migrate"}
    )
    current_metrics = {
        "launched_tokens_24h": (
            estimate_daily_count(sample_launches, observed_seconds)
            if observed_seconds
            else None
        ),
        "graduated_tokens_24h": (
            estimate_daily_count(sample_graduations, observed_seconds)
            if observed_seconds
            else None
        ),
        "active_wallets_24h": len(
            {
                item.address
                for item in panel
                if item.last_seen_at >= cutoff_time
            }
        ),
    }
    bucket = now.replace(minute=0, second=0, microsecond=0)
    history = list(
        reversed(
            query_all(
                "pulse_pumpfun_market_observations",
                select="launched_tokens_24h,graduated_tokens_24h,active_wallets_24h,observed_at",
                observation_bucket=f"lt.{bucket.isoformat()}",
                order="observed_at.desc",
                max_rows=720,
            )
        )
    )
    calculated = calculate_index(current_metrics, history)
    observation = {
        "observation_bucket": bucket.isoformat(),
        "observed_at": now.isoformat(),
        **current_metrics,
        "launch_score": calculated["components"]["launched_tokens_24h"]["score"],
        "graduation_score": calculated["components"]["graduated_tokens_24h"]["score"],
        "active_wallet_score": calculated["components"]["active_wallets_24h"]["score"],
        "market_activity_index_raw": calculated["market_activity_index_raw"],
        "market_activity_index_display": calculated["market_activity_index_display"],
        "baseline_sample_count": calculated["baseline_sample_count"],
        "history_coverage": calculated["history_coverage"],
        "history_status": calculated["history_status"],
        "sampling_audit": {
            **panel_audit,
            "sampling_rate_bps": rate_bps,
            "candidate_transaction_count": len(transactions),
            "stored_event_count": len(event_rows),
            "observed_window_seconds": observed_seconds,
            "sample_launch_count": sample_launches,
            "sample_graduation_count": sample_graduations,
            "daily_estimator": "event_count / observed_seconds * 86400",
            "cursor_reached": reached_cursor,
            "raw_retention_cutoff": retention_cutoff,
            "hourly_observations_retained": True,
        },
        "source_status": {
            "provider": "solana_rpc",
            "status": coverage_status,
        },
    }
    # Every snapshot is a bounded estimate from a real, fixed-size transaction
    # sample. The audit payload preserves the observed duration and counts.
    if transactions and observed_seconds:
        supabase(
            "pulse_pumpfun_market_observations?on_conflict=observation_bucket",
            "POST",
            observation,
        )
    supabase(
        "pulse_chain_collection_state?on_conflict=collector_id",
        "POST",
        {
            "collector_id": "pump-mainnet",
            "provider": "solana_rpc",
            "latest_signature": newest or cursor,
            "latest_slot": max(
                (int(row.get("slot") or 0) for row in transactions), default=None
            ),
            "last_success_at": now.isoformat(),
            "sampling_rate_bps": rate_bps,
            "parser_version": "pump-idl-2026-07",
            "coverage_status": coverage_status,
            "updated_at": now.isoformat(),
        },
    )
    return {
        **observation,
        "snapshot_written": bool(transactions and observed_seconds),
    }


if __name__ == "__main__":
    result = run()
    print(
        json.dumps(
            {
                "history_status": result["history_status"],
                "market_activity_index": result["market_activity_index_display"],
                "observed_at": result["observed_at"],
            }
        )
    )
