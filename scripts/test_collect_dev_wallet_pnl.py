import importlib.util
import unittest
from decimal import Decimal
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("collect-dev-wallet-pnl.py")
SPEC = importlib.util.spec_from_file_location("collect_dev_wallet_pnl", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(MODULE)


class CollectDevWalletPnlTests(unittest.TestCase):
    def test_secret_key_is_not_bearer(self):
        self.assertNotIn("authorization", MODULE.supabase_headers("sb_secret_example"))

    def test_legacy_key_is_bearer(self):
        self.assertEqual(
            MODULE.supabase_headers("legacy-jwt")["authorization"],
            "Bearer legacy-jwt",
        )

    def test_observation_preserves_signed_realized_profit(self):
        row = MODULE.observation(
            {"creator_wallet": "wallet", "tier": "A-Core"},
            "24h",
            {
                "realized_profit": "-12.50",
                "buy": "100",
                "sell": "87.5",
                "last_timestamp": 0,
            },
            "2026-07-29T00:00:00Z",
            1,
        )
        self.assertEqual(row["realized_pnl_usd"], "-12.50")
        self.assertEqual(row["source_period"], "1d")

    def test_snapshot_sums_signed_values_and_tiers(self):
        observations = [
            {"creator_wallet": "a", "realized_pnl_usd": "100"},
            {"creator_wallet": "b", "realized_pnl_usd": "-40"},
            {"creator_wallet": "c", "realized_pnl_usd": "0"},
        ]
        snapshot = MODULE.build_snapshot(
            "7d",
            "2026-07-29T00:00:00Z",
            observations,
            {"a": "A-Core", "b": "B-Primary", "c": "C-Watch"},
            3000,
            1,
        )
        self.assertEqual(Decimal(snapshot["total_realized_pnl_usd"]), Decimal("60"))
        self.assertEqual(snapshot["profitable_wallet_count"], 1)
        self.assertEqual(snapshot["losing_wallet_count"], 1)
        self.assertEqual(snapshot["zero_pnl_wallet_count"], 1)
        self.assertEqual(snapshot["source_status"], "partial")
        self.assertEqual(Decimal(snapshot["data_coverage_pct"]), Decimal("0.1"))

    def test_wallet_selection_counts_all_pages_and_spans_tiers(self):
        class FakeDb:
            def request(self, path, *args, **kwargs):
                if "select=creator_wallet&" in path:
                    if "offset=0" in path:
                        return [{"creator_wallet": f"w{i}"} for i in range(1000)]
                    if "offset=1000" in path:
                        return [{"creator_wallet": f"x{i}"} for i in range(1000)]
                    return [{"creator_wallet": f"y{i}"} for i in range(500)]
                if "tier=eq.A-Core" in path:
                    return [{"creator_wallet": f"a{i}", "tier": "A-Core"} for i in range(4)]
                if "tier=eq.B-Primary" in path:
                    return [{"creator_wallet": f"b{i}", "tier": "B-Primary"} for i in range(3)]
                if "tier=eq.C-Watch" in path:
                    return [{"creator_wallet": f"c{i}", "tier": "C-Watch"} for i in range(3)]
                raise AssertionError(path)

        selected, eligible = MODULE.load_active_wallets(FakeDb(), 10)
        self.assertEqual(eligible, 2500)
        self.assertEqual(len(selected), 10)
        self.assertEqual({row["tier"] for row in selected}, set(MODULE.TIERS))

    def test_rate_limit_wait_uses_provider_reset_hint(self):
        message = "HTTP 429 RATE_LIMIT_BANNED (~41s remaining)"
        self.assertEqual(MODULE.rate_limit_wait_seconds(message), 46)

    def test_rate_limit_wait_has_conservative_fallback(self):
        self.assertEqual(MODULE.rate_limit_wait_seconds("HTTP 429"), 65)
        self.assertIsNone(MODULE.rate_limit_wait_seconds("HTTP 500"))


if __name__ == "__main__":
    unittest.main()
