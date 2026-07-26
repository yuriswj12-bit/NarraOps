import unittest
from datetime import datetime, timedelta, timezone

from dev_lifecycle import DevThresholds, classify_dev
from market_index import calculate_index


class MarketIndexTests(unittest.TestCase):
    def test_requires_complete_thirty_day_baseline(self):
        current = {
            "daily_tokens_created": 100,
            "tokens_launched_24h": 50,
            "graduated_tokens_24h": 20,
            "daily_active_wallets": 5000,
            "daily_revenue_usd": "100000000",
        }
        result = calculate_index(current, [])
        self.assertEqual(result["status"], "beta")
        self.assertEqual(result["value"], "50.00")

    def test_weighted_percentiles_total_one_hundred(self):
        history = [
            {
                "daily_tokens_created": index,
                "tokens_launched_24h": index,
                "graduated_tokens_24h": index,
                "daily_active_wallets": index,
                "daily_revenue_usd": index,
            }
            for index in range(30)
        ]
        current = {
            "daily_tokens_created": 100,
            "tokens_launched_24h": 100,
            "graduated_tokens_24h": 100,
            "daily_active_wallets": 100,
            "daily_revenue_usd": 100,
        }
        result = calculate_index(current, history)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["value"], "100.00")

    def test_missing_component_prevents_public_index(self):
        history = [
            {
                "daily_tokens_created": index,
                "tokens_launched_24h": index,
                "graduated_tokens_24h": index,
                "daily_active_wallets": index,
                "daily_revenue_usd": index,
            }
            for index in range(30)
        ]
        current = dict(history[-1])
        current["daily_revenue_usd"] = None
        result = calculate_index(current, history)
        self.assertEqual(result["status"], "partial_data")
        self.assertIsNone(result["value"])


class DevLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 7, 26, tzinfo=timezone.utc)
        self.thresholds = DevThresholds()

    def test_recent_dev(self):
        status = classify_dev(
            first_launch_at=self.now - timedelta(days=3),
            last_launch_at=self.now - timedelta(hours=1),
            launches_in_long_term_window=1,
            now=self.now,
            thresholds=self.thresholds,
        )
        self.assertEqual(status, "recent")

    def test_recent_becomes_inactive_after_ten_days_idle(self):
        status = classify_dev(
            first_launch_at=self.now - timedelta(days=20),
            last_launch_at=self.now - timedelta(days=10),
            launches_in_long_term_window=1,
            now=self.now,
            thresholds=self.thresholds,
        )
        self.assertEqual(status, "inactive")

    def test_long_term_requires_age_and_frequency(self):
        status = classify_dev(
            first_launch_at=self.now - timedelta(days=90),
            last_launch_at=self.now - timedelta(hours=1),
            launches_in_long_term_window=300,
            now=self.now,
            thresholds=self.thresholds,
        )
        self.assertEqual(status, "long_term")


if __name__ == "__main__":
    unittest.main()
