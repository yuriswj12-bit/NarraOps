import unittest

from dune_pumpfun import extract_metric


class DunePumpfunTests(unittest.TestCase):
    def test_extracts_metric_from_json_result_rows(self):
        payload = {"result": {"rows": [{"tokens_launched": "26,426"}]}}
        metric = extract_metric("tokens_launched_24h", payload)
        self.assertEqual(str(metric.value), "26426")
        self.assertEqual(metric.query_id, 3979030)

    def test_rejects_unknown_query_shape_without_guessing(self):
        with self.assertRaisesRegex(ValueError, "columns="):
            extract_metric("graduated_tokens_24h", {"result": {"rows": [{"x": 1}]}})

    def test_active_wallets_adds_new_and_recurring_users(self):
        payload = {
            "result": {
                "rows": [
                    {"day": "2026-07-25", "new_users": 10, "recurring_users": 20},
                    {"day": "2026-07-26", "new_users": 30, "recurring_users": 40},
                ]
            }
        }
        metric = extract_metric("daily_active_wallets", payload)
        self.assertEqual(str(metric.value), "70")


if __name__ == "__main__":
    unittest.main()
