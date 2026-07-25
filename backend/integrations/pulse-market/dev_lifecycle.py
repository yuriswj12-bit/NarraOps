"""Dynamic Dev-wallet lifecycle classification for Pulse."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone


@dataclass(frozen=True)
class DevThresholds:
    long_term_age_days: int = 60
    long_term_window_days: int = 15
    long_term_average_launches_per_day: int = 20
    recent_age_days: int = 10
    inactive_days: int = 10


def classify_dev(
    *,
    first_launch_at: datetime,
    last_launch_at: datetime,
    launches_in_long_term_window: int,
    now: datetime | None = None,
    thresholds: DevThresholds = DevThresholds(),
) -> str:
    current = now or datetime.now(timezone.utc)
    first = _utc(first_launch_at)
    last = _utc(last_launch_at)
    age = current - first
    idle = current - last

    if idle >= timedelta(days=thresholds.inactive_days):
        return "inactive"

    required_launches = (
        thresholds.long_term_window_days
        * thresholds.long_term_average_launches_per_day
    )
    if (
        age >= timedelta(days=thresholds.long_term_age_days)
        and launches_in_long_term_window >= required_launches
    ):
        return "long_term"

    if age <= timedelta(days=thresholds.recent_age_days):
        return "recent"

    return "observed"


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

