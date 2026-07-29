#!/usr/bin/env python3
"""Validate and idempotently import the initial Dev-wallet sample to Supabase."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path

ALLOWED_TIERS = {"A-Core", "B-Primary", "C-Watch"}
REQUIRED_COLUMNS = {
    "creator_wallet",
    "total_tokens",
    "rugged_tokens",
    "rug_percentage",
    "wilson_lower_pct",
    "sample_score",
    "tier",
    "sample_status",
}


def load_rows(path: Path, imported_at: str) -> tuple[list[dict], Counter]:
    rows: list[dict] = []
    seen: set[str] = set()
    tiers: Counter = Counter()

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or ())
        if missing:
            raise ValueError(f"missing columns: {', '.join(sorted(missing))}")

        for line_number, raw in enumerate(reader, start=2):
            wallet = raw["creator_wallet"].strip()
            if not wallet:
                raise ValueError(f"line {line_number}: creator_wallet is empty")
            if wallet in seen:
                raise ValueError(f"line {line_number}: duplicate creator_wallet {wallet}")
            seen.add(wallet)

            tier = raw["tier"].strip()
            if tier not in ALLOWED_TIERS:
                raise ValueError(f"line {line_number}: unsupported tier {tier}")

            try:
                total = int(raw["total_tokens"])
                rugged = int(raw["rugged_tokens"])
                rug_pct = Decimal(raw["rug_percentage"])
                wilson = Decimal(raw["wilson_lower_pct"])
                score = Decimal(raw["sample_score"])
            except (ValueError, InvalidOperation) as error:
                raise ValueError(f"line {line_number}: invalid numeric value") from error

            if total < 0 or rugged < 0 or rugged > total:
                raise ValueError(f"line {line_number}: invalid token counts")
            if not (Decimal("0") <= rug_pct <= Decimal("100")):
                raise ValueError(f"line {line_number}: rug_percentage out of range")
            if not (Decimal("0") <= wilson <= Decimal("100")):
                raise ValueError(f"line {line_number}: wilson_lower_pct out of range")

            rows.append(
                {
                    "creator_wallet": wallet,
                    "total_tokens": total,
                    "rugged_tokens": rugged,
                    "rug_percentage": str(rug_pct),
                    "wilson_lower_pct": str(wilson),
                    "sample_score": str(score),
                    "tier": tier,
                    "sample_status": raw["sample_status"].strip() or "active",
                    "first_seen_at": imported_at,
                    "last_seen_at": imported_at,
                    "status": "active",
                }
            )
            tiers[tier] += 1

    return rows, tiers


def supabase_headers(secret: str) -> dict[str, str]:
    headers = {
        "apikey": secret,
        "content-type": "application/json",
        "prefer": "resolution=merge-duplicates,return=minimal",
    }
    # New sb_secret keys are not JWTs and Supabase rejects them in a Bearer
    # header. Legacy service_role JWTs still require Authorization.
    if not secret.startswith("sb_secret_"):
        headers["authorization"] = f"Bearer {secret}"
    return headers


def supabase_upsert(rows: list[dict], batch_size: int) -> None:
    base_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SECRET_KEY", "")
    if not base_url or not secret:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")

    endpoint = f"{base_url}/rest/v1/pulse_dev_wallet_sample?on_conflict=creator_wallet"
    for offset in range(0, len(rows), batch_size):
        payload = json.dumps(rows[offset : offset + batch_size]).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=payload,
            method="POST",
            headers=supabase_headers(secret),
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                if response.status not in (200, 201, 204):
                    raise RuntimeError(f"unexpected Supabase response {response.status}")
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase import failed ({error.code}): {detail}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path("data/dev-wallets/initial-dev-wallet-sample.csv"),
    )
    parser.add_argument("--batch-size", type=int, default=250)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write to Supabase. Without this flag the command only validates.",
    )
    args = parser.parse_args()

    if args.batch_size <= 0 or args.batch_size > 1000:
        parser.error("--batch-size must be between 1 and 1000")

    imported_at = datetime.now(timezone.utc).isoformat()
    try:
        rows, tiers = load_rows(args.csv, imported_at)
        if args.apply:
            supabase_upsert(rows, args.batch_size)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    result = {
        "mode": "apply" if args.apply else "validate",
        "unique_wallets": len(rows),
        "tier_counts": {tier: tiers[tier] for tier in sorted(ALLOWED_TIERS)},
        "status": "active",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
