import csv
import importlib.util
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("import-dev-wallet-sample.py")
SPEC = importlib.util.spec_from_file_location("import_dev_wallet_sample", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class ImportDevWalletSampleTests(unittest.TestCase):
    def write_csv(self, rows):
        handle = tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="", suffix=".csv", delete=False
        )
        with handle:
            writer = csv.DictWriter(handle, fieldnames=sorted(MODULE.REQUIRED_COLUMNS))
            writer.writeheader()
            writer.writerows(rows)
        return Path(handle.name)

    @staticmethod
    def row(wallet="wallet-1", tier="A-Core"):
        return {
            "creator_wallet": wallet,
            "total_tokens": "10",
            "rugged_tokens": "1",
            "rug_percentage": "10",
            "wilson_lower_pct": "59.57",
            "sample_score": "70.5",
            "tier": tier,
            "sample_status": "active",
        }

    def test_loads_valid_rows_and_preserves_scores(self):
        path = self.write_csv([self.row()])
        rows, tiers = MODULE.load_rows(path, "2026-07-29T00:00:00+00:00")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["sample_score"], "70.5")
        self.assertEqual(rows[0]["status"], "active")
        self.assertEqual(tiers["A-Core"], 1)

    def test_rejects_duplicate_wallets(self):
        path = self.write_csv([self.row(), self.row()])
        with self.assertRaisesRegex(ValueError, "duplicate creator_wallet"):
            MODULE.load_rows(path, "2026-07-29T00:00:00+00:00")

    def test_rejects_unknown_tier(self):
        path = self.write_csv([self.row(tier="D-Unknown")])
        with self.assertRaisesRegex(ValueError, "unsupported tier"):
            MODULE.load_rows(path, "2026-07-29T00:00:00+00:00")

    def test_new_secret_key_is_not_sent_as_bearer_token(self):
        headers = MODULE.supabase_headers("sb_secret_example")
        self.assertEqual(headers["apikey"], "sb_secret_example")
        self.assertNotIn("authorization", headers)

    def test_legacy_service_role_is_sent_as_bearer_token(self):
        headers = MODULE.supabase_headers("legacy-jwt")
        self.assertEqual(headers["authorization"], "Bearer legacy-jwt")


if __name__ == "__main__":
    unittest.main()
