"""Probe GMGN period stats with a small, anonymized cross-tier wallet sample."""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import time
from pathlib import Path


PERIODS = ("1d", "7d", "30d")
SAMPLE_INDEXES = {
    "A-Core": (0, 150),
    "B-Primary": (0, 600),
    "C-Watch": (750,),
}
PUBLIC_FIELDS = (
    "realized_profit",
    "realized_profit_pnl",
    "bought_cost",
    "sold_income",
    "buy",
    "sell",
    "total_cost",
    "last_timestamp",
)


def sample_wallets(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))
    by_tier = {
        tier: [row for row in rows if row["tier"] == tier]
        for tier in SAMPLE_INDEXES
    }
    selected = []
    for tier, indexes in SAMPLE_INDEXES.items():
        for index in indexes:
            selected.append(by_tier[tier][index])
    return selected


def invoke(cli: str, wallet: str, period: str) -> tuple[dict, float]:
    started = time.perf_counter()
    process = subprocess.run(
        [
            cli,
            "portfolio",
            "stats",
            "--chain",
            "sol",
            "--wallet",
            wallet,
            "--period",
            period,
            "--raw",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    elapsed = time.perf_counter() - started
    if process.returncode:
        message = " ".join((process.stderr or process.stdout).split())[:500]
        raise RuntimeError(message or f"gmgn-cli exited {process.returncode}")
    payload = json.loads(process.stdout)
    return {field: payload.get(field) for field in PUBLIC_FIELDS}, elapsed


def run(sample_path: Path) -> dict:
    cli = shutil.which("gmgn-cli.cmd") or shutil.which("gmgn-cli")
    if not cli:
        raise RuntimeError("gmgn-cli is not installed")
    report = {
        "wallet_count": 0,
        "periods": list(PERIODS),
        "calls": 0,
        "failures": 0,
        "elapsed_seconds": 0.0,
        "wallets": [],
    }
    for index, row in enumerate(sample_wallets(sample_path), start=1):
        wallet_report = {
            "alias": f"W{index:02d}",
            "tier": row["tier"],
            "periods": {},
        }
        for period in PERIODS:
            report["calls"] += 1
            try:
                fields, elapsed = invoke(cli, row["creator_wallet"], period)
                wallet_report["periods"][period] = {
                    "status": "success",
                    "elapsed_seconds": round(elapsed, 3),
                    **fields,
                }
                report["elapsed_seconds"] += elapsed
            except Exception as error:
                report["failures"] += 1
                wallet_report["periods"][period] = {
                    "status": "failed",
                    "error": str(error),
                }
        report["wallets"].append(wallet_report)
    report["wallet_count"] = len(report["wallets"])
    report["elapsed_seconds"] = round(report["elapsed_seconds"], 3)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sample",
        type=Path,
        default=Path("data/dev-wallets/initial-dev-wallet-sample.csv"),
    )
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run(args.sample)
    serialized = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized + "\n", encoding="utf-8")
    print(serialized)


if __name__ == "__main__":
    main()
