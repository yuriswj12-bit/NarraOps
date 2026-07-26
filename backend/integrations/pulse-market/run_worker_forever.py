"""Run the one-shot Pulse collector on a stable cadence."""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone

import pulse_market_worker


def run_forever() -> None:
    interval_seconds = max(
        60,
        int(os.getenv("PULSE_POLL_INTERVAL_SECONDS", "60")),
    )
    max_runtime_seconds = max(
        0,
        int(os.getenv("PULSE_WORKER_MAX_RUNTIME_SECONDS", "0")),
    )
    worker_started = time.monotonic()
    while True:
        started = time.monotonic()
        try:
            exit_code = pulse_market_worker.main()
            if exit_code:
                raise RuntimeError(f"collector exited with status {exit_code}")
        except Exception as error:
            print(
                json.dumps(
                    {
                        "status": "failed",
                        "error": type(error).__name__,
                        "message": str(error),
                        "observed_at": datetime.now(timezone.utc).isoformat(),
                    }
                ),
                flush=True,
            )
        elapsed = time.monotonic() - started
        sleep_seconds = max(0, interval_seconds - elapsed)
        if max_runtime_seconds:
            remaining = max_runtime_seconds - (time.monotonic() - worker_started)
            if remaining <= 0 or remaining < sleep_seconds:
                print(
                    json.dumps(
                        {
                            "status": "completed",
                            "reason": "max_runtime_reached",
                            "observed_at": datetime.now(timezone.utc).isoformat(),
                        }
                    ),
                    flush=True,
                )
                return
            sleep_seconds = min(sleep_seconds, remaining)
        time.sleep(sleep_seconds)


if __name__ == "__main__":
    run_forever()
