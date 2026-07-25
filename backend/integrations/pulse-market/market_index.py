"""Pulse Meme Market Activity Index calculation.

Raw metrics are never treated as scores. Each component is percentile-ranked
against a 30-90 day baseline before the configured weights are applied.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Iterable, Mapping


WEIGHTS = {
    "long_term_dev_count": Decimal("0.25"),
    "recent_dev_count": Decimal("0.20"),
    "daily_launch_count": Decimal("0.10"),
    "graduated_count": Decimal("0.30"),
    "dex_volume_usd": Decimal("0.15"),
}

MIN_BASELINE_DAYS = 30
MAX_BASELINE_DAYS = 90


@dataclass(frozen=True)
class ComponentResult:
    raw_value: str | None
    score: str | None
    weight: str
    contribution: str | None
    status: str


def decimal_value(value: object) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() and parsed >= 0 else None


def percentile_score(current: Decimal, history: Iterable[Decimal]) -> Decimal:
    values = sorted(history)
    if not values:
        raise ValueError("history is required")
    below = sum(1 for value in values if value < current)
    equal = sum(1 for value in values if value == current)
    percentile = (Decimal(below) + Decimal(equal) / Decimal(2)) / Decimal(len(values))
    return (percentile * Decimal(100)).quantize(Decimal("0.01"))


def calculate_index(
    current: Mapping[str, object],
    history: Iterable[Mapping[str, object]],
) -> dict:
    baseline_rows = list(history)[-MAX_BASELINE_DAYS:]
    components: dict[str, ComponentResult] = {}
    total = Decimal(0)
    complete = True

    for name, weight in WEIGHTS.items():
        raw = decimal_value(current.get(name))
        baseline = [
            parsed
            for row in baseline_rows
            if (parsed := decimal_value(row.get(name))) is not None
        ]
        if raw is None:
            complete = False
            result = ComponentResult(None, None, str(weight), None, "missing")
        elif len(baseline) < MIN_BASELINE_DAYS:
            complete = False
            result = ComponentResult(
                str(raw),
                None,
                str(weight),
                None,
                "insufficient_history",
            )
        else:
            score = percentile_score(raw, baseline)
            contribution = (score * weight).quantize(Decimal("0.01"))
            total += contribution
            result = ComponentResult(
                str(raw),
                str(score),
                str(weight),
                str(contribution),
                "ready",
            )
        components[name] = result

    status = "ready" if complete else (
        "partial_data"
        if any(item.status == "missing" for item in components.values())
        else "insufficient_history"
    )
    return {
        "status": status,
        "value": str(total.quantize(Decimal("0.01"))) if complete else None,
        "components": {
            name: {
                "raw_value": item.raw_value,
                "score": item.score,
                "weight": item.weight,
                "contribution": item.contribution,
                "status": item.status,
            }
            for name, item in components.items()
        },
        "baseline_days": min(len(baseline_rows), MAX_BASELINE_DAYS),
    }

