#!/usr/bin/env python3
"""Build a deterministic, evidence-balanced sample for pre-launch feature review."""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


FEATURE_FIELDS = {
    "story_clarity": "unknown",
    "source_traceability": "unknown",
    "subject_distinctiveness": "unknown",
    "visual_hook": "unknown",
    "emotional_hook": "unknown",
    "retellability": "unknown",
    "remixability": "unknown",
    "identity_potential": "unknown",
    "cultural_grounding": "unknown",
    "timing_type": "unknown",
    "originality": "unknown",
    "tokenization_crowding": "unknown",
    "association_authenticity": "unknown",
    "extension_potential": "unknown",
}


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def evidence_tier(row: dict[str, Any]) -> str:
    successful = [item for item in row.get("evidence_details", []) if item.get("fetch_status") == "success"]
    if any(item.get("signals", {}).get("contract_address_match") for item in successful):
        return "direct_contract"
    if any(item.get("signals", {}).get("token_name_match") for item in successful):
        return "name_match"
    if successful:
        return "context_only"
    return "no_static_evidence"


def stable_order(row: dict[str, Any]) -> str:
    return hashlib.sha256(str(row["token_address"]).encode()).hexdigest()


def select_balanced(rows: list[dict[str, Any]], per_cohort: int) -> list[dict[str, Any]]:
    cohorts: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        cohorts[row["ath_cohort"]].append(row)

    output: list[dict[str, Any]] = []
    tier_order = ["direct_contract", "name_match", "context_only", "no_static_evidence"]
    for cohort in sorted(cohorts):
        buckets = {tier: [] for tier in tier_order}
        for row in cohorts[cohort]:
            buckets[evidence_tier(row)].append(row)
        for bucket in buckets.values():
            bucket.sort(key=stable_order)

        picked: list[dict[str, Any]] = []
        while len(picked) < min(per_cohort, len(cohorts[cohort])):
            made_progress = False
            for tier in tier_order:
                if buckets[tier] and len(picked) < per_cohort:
                    picked.append(buckets[tier].pop(0))
                    made_progress = True
            if not made_progress:
                break
        output.extend(picked)
    return sorted(output, key=stable_order)


def review_record(row: dict[str, Any]) -> dict[str, Any]:
    sources = []
    for item in row.get("evidence_details", []):
        sources.append(
            {
                "url": item.get("url"),
                "fetch_status": item.get("fetch_status"),
                "page_title": item.get("page_title"),
                "relevant_excerpt": item.get("relevant_excerpt"),
                "signals": item.get("signals", {}),
            }
        )
    return {
        "sample_id": row["token_address"],
        "token_address": row["token_address"],
        "symbol": row.get("symbol"),
        "name": row.get("name"),
        "evidence_tier": evidence_tier(row),
        "human_annotation": row.get("human_annotation", ""),
        "source_evidence": sources,
        "prelaunch_features": dict(FEATURE_FIELDS),
        "observed_facts": [],
        "agent_inferences": [],
        "missing_evidence": [],
        "one_sentence_narrative": None,
        "prelaunch_disposition": "unreviewed",
        "review_confidence": 0,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--labels-output", type=Path)
    parser.add_argument("--per-cohort", type=int, default=10)
    args = parser.parse_args()
    selected = select_balanced(load_jsonl(args.input), args.per_cohort)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        "".join(json.dumps(review_record(row), ensure_ascii=False) + "\n" for row in selected),
        encoding="utf-8",
    )
    labels_output = args.labels_output or args.output.with_name(args.output.stem + "-labels.jsonl")
    labels_output.write_text(
        "".join(
            json.dumps(
                {"sample_id": row["token_address"], "outcome_label": row.get("ath_cohort")},
                ensure_ascii=False,
            )
            + "\n"
            for row in selected
        ),
        encoding="utf-8",
    )
    counts: dict[str, int] = defaultdict(int)
    tiers: dict[str, int] = defaultdict(int)
    for row in selected:
        counts[row["ath_cohort"]] += 1
        tiers[evidence_tier(row)] += 1
    print(json.dumps({"rows": len(selected), "cohorts": counts, "evidence_tiers": tiers}, default=dict))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
