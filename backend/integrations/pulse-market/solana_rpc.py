"""Bounded Alchemy/Solana RPC client with opaque pagination support."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from pump_chain import PUMP_PROGRAM_ID


class SolanaRpcError(RuntimeError):
    pass


def rpc_request(
    method: str,
    params: list,
    *,
    timeout_seconds: int = 30,
    max_attempts: int = 5,
) -> object:
    endpoint = os.environ["SOLANA_RPC_URL"]
    request = urllib.request.Request(
        endpoint,
        data=json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        ).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    payload = None
    for attempt in range(max_attempts):
        try:
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                payload = json.loads(response.read())
            break
        except urllib.error.HTTPError as error:
            retryable = error.code == 429 or 500 <= error.code < 600
            if not retryable or attempt == max_attempts - 1:
                raise
            retry_after = error.headers.get("Retry-After") if error.headers else None
            delay = float(retry_after) if retry_after and retry_after.isdigit() else min(8, 2**attempt)
            time.sleep(delay)
    if payload is None:
        raise SolanaRpcError("Solana RPC returned no payload")
    if payload.get("error"):
        error = payload["error"]
        raise SolanaRpcError(str(error.get("message") or error))
    return payload.get("result")


def fetch_pump_transactions(
    *,
    pagination_token: str | None = None,
    limit: int = 100,
    timeout_seconds: int = 30,
) -> tuple[list[dict], str | None]:
    config: dict = {
        "transactionDetails": "full",
        "sortOrder": "desc",
        "limit": min(max(limit, 1), 100),
        "commitment": "finalized",
        "encoding": "json",
        "maxSupportedTransactionVersion": 0,
        "filters": {"status": "succeeded"},
    }
    if pagination_token:
        config["paginationToken"] = pagination_token
    result = rpc_request(
        "getTransactionsForAddress",
        [PUMP_PROGRAM_ID, config],
        timeout_seconds=timeout_seconds,
    )
    if not isinstance(result, dict):
        raise SolanaRpcError("Unexpected getTransactionsForAddress response")
    transactions = result.get("transactions") or result.get("data") or []
    if not isinstance(transactions, list):
        raise SolanaRpcError("Transaction result is not a list")
    return transactions, result.get("paginationToken")
