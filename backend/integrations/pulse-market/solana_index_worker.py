"""Collect bounded Pump.fun chain observations and write an hourly Pulse snapshot."""

from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from market_index import calculate_index
from pump_chain import parse_pump_events
from solana_rpc import fetch_pump_transactions
from wallet_sample import WalletCandidate, refresh_wallet_panel, should_sample_signature


def supabase(path: str, method: str = "GET", body: object | None = None):
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
            "Prefer": "return=representation,resolution=merge-duplicates",
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
        newest = newest or rows[0].get("signature")
        for row in rows:
            if cursor and row.get("signature") == cursor:
                return collected, newest, True
            collected.append(row)
        if not token:
            break
    return collected, newest, reached_cursor


def run() -> dict:
    now = datetime.now(timezone.utc)
    rate_bps = int(os.getenv("PULSE_SIGNATURE_SAMPLE_BPS", "200"))
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
    coverage_status = (
        "initializing" if cursor is None else ("complete" if reached_cursor else "gap")
    )
    event_rows = []
    candidates: dict[str, datetime] = {}
    for transaction in transactions:
        signature = str(transaction.get("signature") or "")
        sampled = should_sample_signature(signature, rate_bps)
        for event in parse_pump_events(transaction):
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
            if sampled and event.user_address:
                candidates[event.user_address] = max(
                    candidates.get(event.user_address, event.block_time), event.block_time
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
        if row["status"] in {"candidate", "included"}
    }
    for address, seen in candidates.items():
        existing = available_by_address.get(address)
        if not existing or seen > existing.last_seen_at:
            available_by_address[address] = WalletCandidate(address, seen)
    available = list(available_by_address.values())
    panel, panel_audit = refresh_wallet_panel(
        current,
        available,
        now=now,
        target_size=int(os.getenv("PULSE_WALLET_PANEL_SIZE", "5000")),
        inactive_days=int(os.getenv("PULSE_WALLET_INACTIVE_DAYS", "14")),
        max_daily_replacement_rate=float(
            os.getenv("PULSE_WALLET_MAX_DAILY_REPLACEMENT_RATE", "0.05")
        ),
    )
    included = {item.address for item in panel}
    panel_payload = []
    for item in available:
        existing = existing_by_address.get(item.address)
        is_included = item.address in included
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
                    else (now.isoformat() if is_included else None)
                ),
                "removed_at": None,
                "panel_version": panel_audit["panel_version"],
                "status": "included" if is_included else "candidate",
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

    cutoff = (now - timedelta(hours=24)).isoformat()
    recent = query_all(
        "pulse_pumpfun_chain_events",
        select="event_type,mint,user_address,sampled",
        block_time=f"gte.{cutoff}",
        max_rows=100_000,
    )
    current_metrics = {
        "launched_tokens_24h": len(
            {row["mint"] for row in recent if row["event_type"] == "create"}
        ),
        "graduated_tokens_24h": len(
            {row["mint"] for row in recent if row["event_type"] == "migrate"}
        ),
        "active_wallets_24h": len(
            {
                row["user_address"]
                for row in recent
                if row.get("sampled") and row["user_address"] in included
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
        },
        "source_status": {
            "provider": "solana_rpc",
            "status": coverage_status,
        },
    }
    # Never publish a snapshot from a run with a detected pagination gap.
    # The initial run establishes the cursor; the next complete run starts
    # truthful rolling history.
    if coverage_status == "complete":
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
            "latest_signature": (
                newest if coverage_status in {"initializing", "complete"} else cursor
            ),
            "latest_slot": (
                max((int(row.get("slot") or 0) for row in transactions), default=None)
                if coverage_status != "gap"
                else (state[0].get("latest_slot") if state else None)
            ),
            "last_success_at": (
                now.isoformat()
                if coverage_status != "gap"
                else (state[0].get("last_success_at") if state else None)
            ),
            "sampling_rate_bps": rate_bps,
            "parser_version": "pump-idl-2026-07",
            "coverage_status": coverage_status,
            "updated_at": now.isoformat(),
        },
    )
    return {**observation, "snapshot_written": coverage_status == "complete"}


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
