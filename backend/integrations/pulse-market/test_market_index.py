import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from market_index import calculate_index, percentile_score
from solana_index_worker import cleanup_retained_data, estimate_daily_count
from wallet_sample import WalletCandidate, refresh_wallet_panel, should_sample_signature


def row(value):
    return {
        "launched_tokens_24h": value,
        "graduated_tokens_24h": value,
        "active_wallets_24h": value,
    }


class MarketIndexTests(unittest.TestCase):
    def test_bounded_chain_sample_estimates_daily_rate(self):
        self.assertEqual(estimate_daily_count(10, 60), 14_400)

    @patch("solana_index_worker.supabase")
    def test_cleanup_never_deletes_hourly_observations(self, mocked_supabase):
        cutoff = cleanup_retained_data(
            datetime(2026, 7, 29, tzinfo=timezone.utc), 30
        )
        self.assertEqual(cutoff, "2026-06-29T00:00:00+00:00")
        deleted_paths = [call.args[0] for call in mocked_supabase.call_args_list]
        self.assertTrue(
            any(path.startswith("pulse_pumpfun_chain_events?") for path in deleted_paths)
        )
        self.assertTrue(
            any(path.startswith("pulse_wallet_sample_panel?") for path in deleted_paths)
        )
        self.assertFalse(
            any("pulse_pumpfun_market_observations" in path for path in deleted_paths)
        )

    def test_fewer_than_24_observations_returns_null(self):
        result = calculate_index(row(10), [row(index) for index in range(23)])
        self.assertEqual(result["history_status"], "insufficient")
        self.assertIsNone(result["market_activity_index_raw"])

    def test_warming_up_uses_available_real_history(self):
        result = calculate_index(row(100), [row(index) for index in range(24)])
        self.assertEqual(result["history_status"], "warming_up")
        self.assertEqual(result["market_activity_index_display"], 100)

    def test_duplicate_values_use_mid_rank(self):
        self.assertEqual(str(percentile_score(5, [1, 5, 5, 9])), "50.0")

    def test_weights_and_unrounded_value_are_preserved(self):
        history = [row(index) for index in range(720)]
        current = {
            "launched_tokens_24h": 360,
            "graduated_tokens_24h": 720,
            "active_wallets_24h": 0,
        }
        result = calculate_index(current, history)
        self.assertEqual(result["history_status"], "ready")
        self.assertIsNotNone(result["market_activity_index_raw"])
        self.assertIsInstance(result["market_activity_index_display"], int)
        self.assertEqual(result["baseline_sample_count"], 720)

    def test_missing_current_metric_returns_null(self):
        current = row(100)
        current["active_wallets_24h"] = None
        result = calculate_index(current, [row(index) for index in range(24)])
        self.assertIsNone(result["market_activity_index_raw"])


class WalletSampleTests(unittest.TestCase):
    def test_signature_sampling_is_deterministic(self):
        self.assertEqual(
            should_sample_signature("signature-a", 200),
            should_sample_signature("signature-a", 200),
        )

    def test_panel_replacement_is_capped_and_fixed_size(self):
        now = datetime(2026, 7, 29, tzinfo=timezone.utc)
        current = [
            WalletCandidate(f"old-{index}", now - timedelta(days=30))
            for index in range(100)
        ]
        candidates = [
            WalletCandidate(f"new-{index}", now - timedelta(hours=1))
            for index in range(100)
        ]
        panel, audit = refresh_wallet_panel(
            current, candidates, now=now, target_size=100, max_daily_replacement_rate=0.05
        )
        self.assertEqual(len(panel), 100)
        self.assertEqual(audit["removed_count"], 5)
        self.assertEqual(audit["added_count"], 5)

    def test_existing_wallet_activity_refreshes_before_inactivity_filter(self):
        now = datetime(2026, 7, 29, tzinfo=timezone.utc)
        address = "returning-wallet"
        panel, audit = refresh_wallet_panel(
            [WalletCandidate(address, now - timedelta(days=30))],
            [WalletCandidate(address, now - timedelta(minutes=5))],
            now=now,
            target_size=1,
            inactive_days=14,
        )
        self.assertEqual(panel, [WalletCandidate(address, now - timedelta(minutes=5))])
        self.assertEqual(audit["removed_count"], 0)

    def test_daily_replacement_budget_is_shared_across_runs(self):
        now = datetime(2026, 7, 29, tzinfo=timezone.utc)
        current = [
            WalletCandidate(f"old-{index}", now - timedelta(days=30))
            for index in range(100)
        ]
        candidates = [
            WalletCandidate(f"new-{index}", now - timedelta(hours=1))
            for index in range(100)
        ]
        panel, audit = refresh_wallet_panel(
            current,
            candidates,
            now=now,
            target_size=100,
            max_daily_replacement_rate=0.05,
            replacements_already_today=4,
        )
        self.assertEqual(len(panel), 100)
        self.assertEqual(audit["removed_count"], 1)
        self.assertEqual(audit["daily_replacements_after_run"], 5)

        panel, audit = refresh_wallet_panel(
            current,
            candidates,
            now=now,
            target_size=100,
            max_daily_replacement_rate=0.05,
            replacements_already_today=5,
        )
        self.assertEqual(len(panel), 100)
        self.assertEqual(audit["removed_count"], 0)
        self.assertEqual(audit["replacement_cap"], 0)


if __name__ == "__main__":
    unittest.main()
