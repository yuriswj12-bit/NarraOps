"""Deterministic dynamic wallet panel for sampled Pump.fun activity."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable


def stable_score(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:8], "big")


def should_sample_signature(signature: str, rate_basis_points: int) -> bool:
    if not 0 <= rate_basis_points <= 10_000:
        raise ValueError("rate_basis_points must be between 0 and 10000")
    return stable_score(signature) % 10_000 < rate_basis_points


@dataclass(frozen=True)
class WalletCandidate:
    address: str
    last_seen_at: datetime


def refresh_wallet_panel(
    current: Iterable[WalletCandidate],
    candidates: Iterable[WalletCandidate],
    *,
    now: datetime,
    target_size: int = 5_000,
    inactive_days: int = 14,
    max_daily_replacement_rate: float = 0.05,
) -> tuple[list[WalletCandidate], dict]:
    """Refresh a fixed-size panel without selecting only the most-active wallets."""
    if target_size <= 0:
        raise ValueError("target_size must be positive")
    cutoff = now - timedelta(days=inactive_days)
    current_by_address = {item.address: item for item in current}
    candidate_by_address = {item.address: item for item in candidates}
    inactive = sorted(
        (item for item in current_by_address.values() if item.last_seen_at < cutoff),
        key=lambda item: (item.last_seen_at, stable_score(item.address)),
    )
    replacement_cap = max(1, int(target_size * max_daily_replacement_rate))
    remove_addresses = {item.address for item in inactive[:replacement_cap]}
    retained = [
        item for item in current_by_address.values() if item.address not in remove_addresses
    ]
    available = [
        item
        for address, item in candidate_by_address.items()
        if address not in current_by_address and item.last_seen_at >= cutoff
    ]
    # Deterministic pseudo-random selection prevents "top activity" survivorship bias.
    available.sort(key=lambda item: stable_score(f"{now.date()}:{item.address}"))
    slots = max(0, target_size - len(retained))
    entrants = available[:slots]
    panel = sorted((retained + entrants)[:target_size], key=lambda item: item.address)
    return panel, {
        "target_size": target_size,
        "eligible_size": len(panel),
        "removed_count": len(remove_addresses),
        "added_count": len(entrants),
        "inactive_cutoff": cutoff.isoformat(),
        "replacement_cap": replacement_cap,
        "panel_version": now.date().isoformat(),
    }
