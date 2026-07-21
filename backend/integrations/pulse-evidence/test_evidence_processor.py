import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock

import evidence_processor as ep


class EvidenceProcessorTests(unittest.TestCase):
    def test_relevant_excerpt_prefers_distinctive_name(self):
        body = "navigation " * 200 + "Jimothy is a viral raccoon from Seattle."
        excerpt = ep._relevant_excerpt(body, {"name": "Official Jimothy Coin", "symbol": "JIMOTHY"})
        self.assertIn("viral raccoon", excerpt)

    def test_rejects_non_http_and_private_targets(self):
        with self.assertRaises(ValueError):
            ep.validate_url("file:///etc/passwd")
        with self.assertRaises(ValueError):
            ep.validate_url("http://127.0.0.1/admin")

    def test_dynamic_social_is_not_faked(self):
        detail = ep.fetch_source(
            {"source_field": "twitter_url", "value": "https://x.com/example/status/1"},
            {"token_address": "abc", "name": "Example", "symbol": "EX"},
            1,
            Mock(),
        )
        self.assertEqual(detail["fetch_status"], "dynamic_render_required")

    def test_shared_sources_are_written_back(self):
        source = {"source_field": "website", "value": "https://example.com/story"}
        rows = [
            {"token_address": "a", "name": "A", "symbol": "AAA", "provided_sources": [source]},
            {"token_address": "b", "name": "B", "symbol": "BBB", "provided_sources": [source]},
        ]
        original = ep.fetch_source
        try:
            ep.fetch_source = lambda src, token, timeout, session: ep.result_shell(
                src["value"], src["source_field"]
            )
            output = ep.process_rows(rows)
        finally:
            ep.fetch_source = original
        first = output[0]["evidence_details"][0]
        self.assertTrue(first["shared_source"])
        self.assertEqual(first["shared_with"], ["b"])

    def test_jsonl_round_trip(self):
        with TemporaryDirectory() as temp:
            path = Path(temp) / "rows.jsonl"
            rows = [{"token_address": "abc", "provided_sources": []}]
            ep.write_jsonl(path, rows)
            self.assertEqual(ep.load_jsonl(path), rows)


if __name__ == "__main__":
    unittest.main()
