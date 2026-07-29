import unittest
from datetime import timezone

from pump_chain import (
    INSTRUCTIONS,
    PUMP_PROGRAM_ID,
    b58encode,
    parse_pump_events,
)


def encoded_instruction(discriminator, accounts):
    return {"programId": PUMP_PROGRAM_ID, "accounts": accounts, "data": b58encode(discriminator)}


class PumpChainTests(unittest.TestCase):
    def test_parses_successful_migrate(self):
        migrate = next(key for key, value in INSTRUCTIONS.items() if value[0] == "migrate")
        accounts = ["global", "authority", "mint-a", "curve", "ata", "wallet-a"]
        entry = {
            "signature": "sig-a",
            "slot": 123,
            "blockTime": 1_700_000_000,
            "transactionResult": {
                "meta": {"err": None, "innerInstructions": [], "loadedAddresses": {}},
                "transaction": {
                    "message": {
                        "accountKeys": accounts,
                        "instructions": [encoded_instruction(migrate, list(range(6)))],
                    },
                    "signatures": ["sig-a"],
                },
            },
        }
        events = parse_pump_events(entry)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, "migrate")
        self.assertEqual(events[0].mint, "mint-a")
        self.assertEqual(events[0].user_address, "wallet-a")
        self.assertEqual(events[0].block_time.tzinfo, timezone.utc)

    def test_ignores_failed_transaction(self):
        entry = {
            "signature": "sig-failed",
            "slot": 1,
            "blockTime": 1_700_000_000,
            "transactionResult": {
                "meta": {"err": {"InstructionError": [0, "Failed"]}},
                "transaction": {"message": {"accountKeys": [], "instructions": []}},
            },
        }
        self.assertEqual(parse_pump_events(entry), [])


if __name__ == "__main__":
    unittest.main()
