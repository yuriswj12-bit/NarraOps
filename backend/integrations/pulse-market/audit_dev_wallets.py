"""Cross-check sampled Pulse Dev wallets against GMGN created-token records."""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SAMPLE_SIZE = max(1, min(50, int(os.getenv("PULSE_AUDIT_SAMPLE_SIZE", "20"))))
OUTPUT_PATH = Path(os.getenv("PULSE_AUDIT_OUTPUT", "pulse-wallet-audit.csv"))


@dataclass
class AuditResult:
    wallet_address: str
    lifecycle_status: str
    database_launch_count: int
    gmgn_total_created: int | None
    database_tokens_checked: int
    matching_tokens: int
    verdict: str
    note: str


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def supabase_get(path: str) -> list[dict[str, Any]]:
    base_url = required_env("SUPABASE_URL").rstrip("/")
    secret = required_env("SUPABASE_SECRET_KEY")
    request = urllib.request.Request(
        f"{base_url}/rest/v1/{path}",
        headers={
            "apikey": secret,
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if not isinstance(payload, list):
        raise RuntimeError("Supabase returned an unexpected response")
    return payload


def sample_wallets() -> list[dict[str, Any]]:
    fields = (
        "wallet_address,lifecycle_status,total_launch_count,"
        "first_launch_at,last_launch_at"
    )
    return supabase_get(
        "pulse_dev_wallets"
        f"?select={fields}"
        "&order=total_launch_count.desc,wallet_address.asc"
        f"&limit={SAMPLE_SIZE}"
    )


def database_tokens(wallets: list[str]) -> dict[str, set[str]]:
    if not wallets:
        return {}
    encoded_wallets = ",".join(wallets)
    query = urllib.parse.urlencode(
        {
            "select": "creator_address,token_address",
            "creator_address": f"in.({encoded_wallets})",
        },
        safe=",().",
    )
    rows = supabase_get(f"pulse_launch_events?{query}")
    result = {wallet: set() for wallet in wallets}
    for row in rows:
        creator = str(row.get("creator_address") or "")
        token = str(row.get("token_address") or "")
        if creator in result and token:
            result[creator].add(token)
    return result


def gmgn_created_tokens(wallet: str) -> dict[str, Any]:
    command = [
        "gmgn-cli",
        "portfolio",
        "created-tokens",
        "--chain",
        "sol",
        "--wallet",
        wallet,
        "--raw",
    ]
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )
    if completed.returncode:
        message = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(message[:300] or f"gmgn-cli exited {completed.returncode}")
    payload = json.loads(completed.stdout)
    data = payload.get("data", payload)
    if not isinstance(data, dict):
        raise RuntimeError("GMGN returned an unexpected response")
    return data


def audit_wallet(
    wallet_row: dict[str, Any],
    observed_tokens: set[str],
) -> AuditResult:
    wallet = str(wallet_row["wallet_address"])
    database_count = int(wallet_row.get("total_launch_count") or 0)
    try:
        gmgn = gmgn_created_tokens(wallet)
        inner_count = int(gmgn.get("inner_count") or 0)
        open_count = int(gmgn.get("open_count") or 0)
        total_created = inner_count + open_count
        tokens = gmgn.get("tokens") if isinstance(gmgn.get("tokens"), list) else []
        gmgn_addresses = {
            str(token.get("token_address"))
            for token in tokens
            if isinstance(token, dict) and token.get("token_address")
        }
        matches = len(observed_tokens & gmgn_addresses)

        if not observed_tokens:
            verdict = "inconclusive"
            note = "No database token events were available for this wallet."
        elif matches:
            verdict = "confirmed"
            note = "At least one observed token is present in GMGN creator records."
        elif total_created > len(tokens):
            verdict = "inconclusive"
            note = "GMGN token list is truncated; observed tokens may be outside the page."
        else:
            verdict = "mismatch"
            note = "No observed token was found in the complete GMGN token list."
        return AuditResult(
            wallet,
            str(wallet_row.get("lifecycle_status") or "unknown"),
            database_count,
            total_created,
            len(observed_tokens),
            matches,
            verdict,
            note,
        )
    except Exception as error:
        return AuditResult(
            wallet,
            str(wallet_row.get("lifecycle_status") or "unknown"),
            database_count,
            None,
            len(observed_tokens),
            0,
            "error",
            f"{type(error).__name__}: {error}"[:350],
        )


def write_csv(results: list[AuditResult]) -> None:
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as output:
        writer = csv.writer(output)
        writer.writerow(AuditResult.__dataclass_fields__.keys())
        for result in results:
            writer.writerow(result.__dict__.values())


def write_summary(results: list[AuditResult]) -> None:
    counts = {
        verdict: sum(result.verdict == verdict for result in results)
        for verdict in ("confirmed", "mismatch", "inconclusive", "error")
    }
    decisive = counts["confirmed"] + counts["mismatch"]
    match_rate = (counts["confirmed"] / decisive * 100) if decisive else 0
    lines = [
        "# Pulse Dev wallet cross-check",
        "",
        f"- Sample size: **{len(results)}**",
        f"- Confirmed: **{counts['confirmed']}**",
        f"- Mismatch: **{counts['mismatch']}**",
        f"- Inconclusive: **{counts['inconclusive']}**",
        f"- Errors: **{counts['error']}**",
        f"- Decisive match rate: **{match_rate:.1f}%**",
        "",
        "| Wallet | DB launches | GMGN created | Checked | Matches | Verdict |",
        "|---|---:|---:|---:|---:|---|",
    ]
    for result in results:
        gmgn_total = "n/a" if result.gmgn_total_created is None else result.gmgn_total_created
        lines.append(
            f"| `{result.wallet_address}` | {result.database_launch_count} | "
            f"{gmgn_total} | {result.database_tokens_checked} | "
            f"{result.matching_tokens} | {result.verdict} |"
        )
    summary = "\n".join(lines) + "\n"
    print(summary)
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as output:
            output.write(summary)


def main() -> int:
    wallets = sample_wallets()
    if not wallets:
        print("No Pulse Dev wallets are available to audit.", file=sys.stderr)
        return 2
    addresses = [str(wallet["wallet_address"]) for wallet in wallets]
    token_map = database_tokens(addresses)
    results: list[AuditResult] = []
    for index, wallet in enumerate(wallets):
        result = audit_wallet(wallet, token_map.get(str(wallet["wallet_address"]), set()))
        results.append(result)
        if index + 1 < len(wallets):
            time.sleep(0.2)
    write_csv(results)
    write_summary(results)
    return 1 if any(result.verdict == "mismatch" for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
