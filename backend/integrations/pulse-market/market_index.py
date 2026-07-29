"""Auditable rolling-percentile Market Activity Index."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Iterable, Mapping


WEIGHTS = {
    "launched_tokens_24h": Decimal("0.15"),
    "graduated_tokens_24h": Decimal("0.55"),
    "active_wallets_24h": Decimal("0.30"),
}
MAX_BASELINE_HOURS = 720


def decimal_value(value: object) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() and parsed >= 0 else None


def clamp_score(value: Decimal) -> Decimal:
    return max(Decimal(0), min(Decimal(100), value))


def percentile_score(current: Decimal, history: Iterable[Decimal]) -> Decimal:
    """Empirical mid-rank percentile against earlier observations only."""
    values = list(history)
    if not values:
        raise ValueError("history is required")
    below = sum(value < current for value in values)
    equal = sum(value == current for value in values)
    result = (
        (Decimal(below) + Decimal(equal) / Decimal(2))
        / Decimal(len(values))
        * Decimal(100)
    )
    return clamp_score(result)


def history_status(sample_count: int) -> str:
    if sample_count < 24:
        return "insufficient"
    if sample_count < 168:
        return "warming_up"
    if sample_count < 720:
        return "partial"
    return "ready"


def calculate_index(
    current: Mapping[str, object],
    history: Iterable[Mapping[str, object]],
) -> dict:
    rows = list(history)[-MAX_BASELINE_HOURS:]
    component_results: dict[str, dict] = {}
    component_counts: list[int] = []
    weighted_total = Decimal(0)
    complete = True

    for name, weight in WEIGHTS.items():
        raw = decimal_value(current.get(name))
        baseline = [
            parsed
            for row in rows
            if (parsed := decimal_value(row.get(name))) is not None
        ]
        component_counts.append(len(baseline))
        if raw is None or not baseline:
            complete = False
            score = None
            contribution = None
        else:
            score = percentile_score(raw, baseline)
            contribution = score * weight
            weighted_total += contribution
        component_results[name] = {
            "raw_value": str(raw) if raw is not None else None,
            "score": str(score.quantize(Decimal("0.0001"))) if score is not None else None,
            "weight": str(weight),
            "contribution": (
                str(contribution.quantize(Decimal("0.0001")))
                if contribution is not None
                else None
            ),
            "baseline_sample_count": len(baseline),
        }

    baseline_sample_count = min(component_counts, default=0)
    status = history_status(baseline_sample_count)
    raw_index = clamp_score(weighted_total) if complete and baseline_sample_count >= 24 else None
    display_index = (
        int(raw_index.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
        if raw_index is not None
        else None
    )
    expected = min(MAX_BASELINE_HOURS, max(len(rows), 24))
    coverage = (
        Decimal(baseline_sample_count) / Decimal(expected)
        if expected
        else Decimal(0)
    )
    return {
        "history_status": status,
        "market_activity_index_raw": (
            str(raw_index.quantize(Decimal("0.0001"))) if raw_index is not None else None
        ),
        "market_activity_index_display": display_index,
        "components": component_results,
        "baseline_sample_count": baseline_sample_count,
        "history_coverage": str(min(Decimal(1), coverage).quantize(Decimal("0.0001"))),
    }
