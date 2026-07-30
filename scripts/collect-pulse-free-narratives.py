#!/usr/bin/env python3
"""Collect the credential-free Pulse source pool into an auditable JSONL file."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
INTEGRATION_DIR = PROJECT_ROOT / "backend" / "integrations" / "pulse-narratives"
sys.path.insert(0, str(INTEGRATION_DIR))

from free_source_collectors import collect_free_sources  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("config", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    if not isinstance(config, list):
        raise ValueError("free source config must be a JSON array")

    collected_at = datetime.now(timezone.utc)
    items, statuses = collect_free_sources(config, now=collected_at)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "source-items.jsonl").write_text(
        "".join(
            json.dumps(item.__dict__, ensure_ascii=False) + "\n" for item in items
        ),
        encoding="utf-8",
    )
    status = {
        "collected_at": collected_at.isoformat().replace("+00:00", "Z"),
        "item_count": len(items),
        "sources": statuses,
    }
    (args.output_dir / "run-status.json").write_text(
        json.dumps(status, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(status, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
