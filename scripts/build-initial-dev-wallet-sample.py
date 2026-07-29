"""Build the deterministic NarraOps V1 Dev-wallet sample from raw rug counts."""

from __future__ import annotations

import argparse
import csv
import math
from bisect import bisect_left, bisect_right
from pathlib import Path


Z_95 = 1.959963984540054
MIN_TOKENS = 30
SAMPLE_SIZE = 3_000
QUALITY_WEIGHT = 0.70
ACTIVITY_WEIGHT = 0.30
TIER_LIMITS = (
    (300, "A-Core"),
    (1_500, "B-Primary"),
    (3_000, "C-Watch"),
)


def quality_wilson_lower(total_tokens: int, rugged_tokens: int) -> float:
    """95% Wilson lower bound for the non-rug success proportion."""
    if total_tokens <= 0 or not 0 <= rugged_tokens <= total_tokens:
        raise ValueError("invalid token counts")
    successes = total_tokens - rugged_tokens
    proportion = successes / total_tokens
    z_squared = Z_95**2
    denominator = 1 + z_squared / total_tokens
    centre = proportion + z_squared / (2 * total_tokens)
    margin = Z_95 * math.sqrt(
        (
            proportion * (1 - proportion)
            + z_squared / (4 * total_tokens)
        )
        / total_tokens
    )
    return (centre - margin) / denominator * 100


def midrank_percentile(value: int, ordered_values: list[int]) -> float:
    if len(ordered_values) <= 1:
        return 50.0
    lower = bisect_left(ordered_values, value)
    upper = bisect_right(ordered_values, value)
    average_zero_based_rank = lower + (upper - lower - 1) / 2
    return average_zero_based_rank / (len(ordered_values) - 1) * 100


def tier_for_rank(rank: int) -> str:
    for limit, tier in TIER_LIMITS:
        if rank <= limit:
            return tier
    raise ValueError("rank exceeds configured sample size")


def build(input_path: Path, output_path: Path) -> dict:
    candidates: list[dict] = []
    seen: set[str] = set()
    with input_path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        required = {
            "creator_wallet",
            "total_tokens",
            "rugged_tokens",
            "rug_percentage",
        }
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(f"missing fields: {sorted(required - set(reader.fieldnames or []))}")
        for line_number, row in enumerate(reader, start=2):
            wallet = row["creator_wallet"].strip()
            if not wallet or wallet in seen:
                raise ValueError(f"missing or duplicate wallet at line {line_number}")
            seen.add(wallet)
            total = int(row["total_tokens"])
            rugged = int(row["rugged_tokens"])
            if total < MIN_TOKENS:
                continue
            wilson = quality_wilson_lower(total, rugged)
            candidates.append(
                {
                    "creator_wallet": wallet,
                    "total_tokens": total,
                    "rugged_tokens": rugged,
                    "rug_percentage": rugged / total * 100,
                    "wilson_lower_pct": wilson,
                }
            )
    if len(candidates) < SAMPLE_SIZE:
        raise ValueError(
            f"only {len(candidates)} eligible wallets; {SAMPLE_SIZE} required"
        )

    ordered_activity = sorted(row["total_tokens"] for row in candidates)
    for row in candidates:
        activity = midrank_percentile(row["total_tokens"], ordered_activity)
        row["sample_score"] = (
            row["wilson_lower_pct"] * QUALITY_WEIGHT
            + activity * ACTIVITY_WEIGHT
        )

    candidates.sort(
        key=lambda row: (
            -row["sample_score"],
            -row["wilson_lower_pct"],
            -row["total_tokens"],
            row["creator_wallet"],
        )
    )
    selected = candidates[:SAMPLE_SIZE]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "creator_wallet",
        "total_tokens",
        "rugged_tokens",
        "rug_percentage",
        "wilson_lower_pct",
        "sample_score",
        "tier",
        "sample_status",
    ]
    counts: dict[str, int] = {}
    with output_path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=fieldnames)
        writer.writeheader()
        for rank, row in enumerate(selected, start=1):
            tier = tier_for_rank(rank)
            counts[tier] = counts.get(tier, 0) + 1
            writer.writerow(
                {
                    **row,
                    "rug_percentage": f"{row['rug_percentage']:.4f}",
                    "wilson_lower_pct": f"{row['wilson_lower_pct']:.4f}",
                    "sample_score": f"{row['sample_score']:.4f}",
                    "tier": tier,
                    "sample_status": "active",
                }
            )
    return {
        "source_wallets": len(seen),
        "eligible_wallets": len(candidates),
        "selected_wallets": len(selected),
        "tiers": counts,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(build(args.input, args.output))


if __name__ == "__main__":
    main()
