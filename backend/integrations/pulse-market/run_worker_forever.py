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
        time.sleep(max(0, interval_seconds - elapsed))


if __name__ == "__main__":
    run_forever()
