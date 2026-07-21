#!/usr/bin/env python3
"""Join blind reviews to hidden outcomes and produce cohort diagnostics."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


def load(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("reviews", type=Path)
    parser.add_argument("labels", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    labels = {row["sample_id"]: row["outcome_label"] for row in load(args.labels)}
    groups = defaultdict(list)
    for row in load(args.reviews):
        groups[labels[row["sample_id"]]].append(row)

    lines = ["# Pulse 50-sample blind baseline evaluation", ""]
    lines += ["This is a diagnostic baseline, not a trained profitability model.", ""]
    lines += ["| Cohort | N | Mean baseline score | Dispositions | Mean confidence |", "|---|---:|---:|---|---:|"]
    for cohort in sorted(groups):
        rows = groups[cohort]
        dispositions = Counter(row["prelaunch_disposition"] for row in rows)
        lines.append(
            f"| {cohort} | {len(rows)} | {mean(row['baseline_score'] for row in rows):.1f} | "
            f"{', '.join(f'{key}:{value}' for key, value in sorted(dispositions.items()))} | "
            f"{mean(row['review_confidence'] for row in rows):.1f} |"
        )

    ordinal = {"none": 0, "weak": 1, "medium": 2, "strong": 3}
    feature_names = [
        "story_clarity", "source_traceability", "subject_distinctiveness", "visual_hook",
        "emotional_hook", "retellability", "remixability", "identity_potential",
        "cultural_grounding", "originality", "extension_potential",
    ]
    lines += ["", "## Mean feature strength by cohort", ""]
    lines.append("| Feature | " + " | ".join(sorted(groups)) + " |")
    lines.append("|---|" + "---:|" * len(groups))
    for feature in feature_names:
        values = []
        for cohort in sorted(groups):
            nums = [ordinal[r["prelaunch_features"][feature]] for r in groups[cohort] if r["prelaunch_features"][feature] in ordinal]
            values.append(f"{mean(nums):.2f}" if nums else "n/a")
        lines.append(f"| {feature} | " + " | ".join(values) + " |")

    lines += [
        "", "## Interpretation constraints", "",
        "- The 50 samples are cohort-balanced and evidence-tier-balanced, but still small.",
        "- Human annotations and surviving webpages may contain post-launch knowledge.",
        "- The heuristic reviewer is intentionally explainable; it is a baseline to falsify, not the final Pulse model.",
        "- Features should enter production only after original-source timestamps prove they were observable before launch.",
    ]
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"cohorts": {key: len(value) for key, value in groups.items()}}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
