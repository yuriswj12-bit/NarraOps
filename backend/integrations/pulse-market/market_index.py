"""Pulse Pump.fun Meme Market Activity Index calculation."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Iterable, Mapping


WEIGHTS = {
    "daily_tokens_created": Decimal("0.15"),
    "tokens_launched_24h": Decimal("0.20"),
    "graduated_tokens_24h": Decimal("0.30"),
    "daily_active_wallets": Decimal("0.20"),
    "daily_revenue_usd": Decimal("0.15"),
}

MAX_BASELINE_DAYS = 90
NEUTRAL_BETA_SCORE = Decimal("50")


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
        elif not baseline:
            score = NEUTRAL_BETA_SCORE
            contribution = (score * weight).quantize(Decimal("0.01"))
            total += contribution
            result = ComponentResult(
                str(raw),
                str(score),
                str(weight),
                str(contribution),
                "beta_neutral",
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

    has_beta_component = any(
        item.status == "beta_neutral" for item in components.values()
    )
    status = "partial_data" if not complete else ("beta" if has_beta_component else "ready")
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
