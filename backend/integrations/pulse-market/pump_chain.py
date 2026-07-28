"""Decode the Pump program instructions needed by the Pulse market index."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable


PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
INSTRUCTIONS = {
    bytes([24, 30, 200, 40, 5, 28, 7, 119]): ("create", 0, 7),
    bytes([155, 234, 231, 146, 236, 158, 162, 30]): ("migrate", 2, 5),
    bytes([102, 6, 61, 18, 1, 218, 235, 234]): ("buy", 2, 6),
    bytes([51, 230, 133, 164, 1, 127, 131, 173]): ("sell", 2, 6),
    bytes([184, 23, 238, 97, 103, 197, 211, 61]): ("buy", 1, 13),
    bytes([194, 171, 28, 70, 104, 77, 91, 47]): ("buy", 1, 13),
    bytes([93, 246, 130, 60, 231, 233, 64, 178]): ("sell", 1, 13),
}


def b58decode(value: str) -> bytes:
    number = 0
    for character in value:
        number = number * 58 + ALPHABET.index(character)
    decoded = number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b""
    return b"\0" * (len(value) - len(value.lstrip("1"))) + decoded


def b58encode(value: bytes) -> str:
    number = int.from_bytes(value, "big")
    encoded = ""
    while number:
        number, remainder = divmod(number, 58)
        encoded = ALPHABET[remainder] + encoded
    return "1" * (len(value) - len(value.lstrip(b"\0"))) + (encoded or "")


def create_creator(data: bytes) -> str | None:
    offset = 8
    try:
        for _ in range(3):
            length = int.from_bytes(data[offset : offset + 4], "little")
            offset += 4 + length
        creator = data[offset : offset + 32]
        return b58encode(creator) if len(creator) == 32 else None
    except (IndexError, ValueError):
        return None


@dataclass(frozen=True)
class PumpEvent:
    signature: str
    instruction_path: str
    slot: int
    block_time: datetime
    event_type: str
    mint: str
    user_address: str
    creator_address: str | None


def account_key(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return str(value.get("pubkey") or "")
    return ""


def transaction_keys(result: dict) -> list[str]:
    message = result.get("transaction", {}).get("message", {})
    keys = [account_key(value) for value in message.get("accountKeys", [])]
    loaded = result.get("meta", {}).get("loadedAddresses", {})
    keys.extend(str(value) for value in loaded.get("writable", []))
    keys.extend(str(value) for value in loaded.get("readonly", []))
    return keys


def instruction_program(instruction: dict, keys: list[str]) -> str:
    if instruction.get("programId"):
        return account_key(instruction["programId"])
    index = instruction.get("programIdIndex")
    return keys[index] if isinstance(index, int) and index < len(keys) else ""


def instruction_accounts(instruction: dict, keys: list[str]) -> list[str]:
    values = instruction.get("accounts", [])
    return [
        keys[value] if isinstance(value, int) and value < len(keys) else account_key(value)
        for value in values
    ]


def iter_instructions(result: dict) -> Iterable[tuple[str, dict]]:
    message = result.get("transaction", {}).get("message", {})
    for index, instruction in enumerate(message.get("instructions", [])):
        yield str(index), instruction
    for group in result.get("meta", {}).get("innerInstructions", []) or []:
        outer = group.get("index", 0)
        for inner, instruction in enumerate(group.get("instructions", [])):
            yield f"{outer}.{inner}", instruction


def parse_pump_events(entry: dict) -> list[PumpEvent]:
    result = entry.get("transactionResult") or entry
    if result.get("meta", {}).get("err") is not None:
        return []
    signature = (
        entry.get("signature")
        or result.get("transaction", {}).get("signatures", [""])[0]
    )
    slot = int(entry.get("slot") or result.get("slot") or 0)
    raw_time = entry.get("blockTime") or result.get("blockTime")
    if not signature or raw_time is None:
        return []
    keys = transaction_keys(result)
    events: list[PumpEvent] = []
    for path, instruction in iter_instructions(result):
        if instruction_program(instruction, keys) != PUMP_PROGRAM_ID:
            continue
        try:
            data = b58decode(str(instruction.get("data") or ""))
        except ValueError:
            continue
        contract = INSTRUCTIONS.get(data[:8])
        if not contract:
            continue
        event_type, mint_index, user_index = contract
        accounts = instruction_accounts(instruction, keys)
        if max(mint_index, user_index) >= len(accounts):
            continue
        events.append(
            PumpEvent(
                signature=signature,
                instruction_path=path,
                slot=slot,
                block_time=datetime.fromtimestamp(int(raw_time), timezone.utc),
                event_type=event_type,
                mint=accounts[mint_index],
                user_address=accounts[user_index],
                creator_address=create_creator(data) if event_type == "create" else None,
            )
        )
    return events
