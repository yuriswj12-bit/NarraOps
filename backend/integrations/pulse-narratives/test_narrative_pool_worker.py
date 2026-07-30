import unittest
from datetime import datetime, timedelta, timezone

import narrative_feed as feed
import narrative_pool_worker as worker


NOW = datetime(2026, 7, 30, 9, 0, tzinfo=timezone.utc)


class NarrativePoolWorkerTests(unittest.TestCase):
    def test_category_routing_is_deterministic(self):
        self.assertEqual(feed.route_category("A rescued raccoon goes viral"), "animals_characters")
        self.assertEqual(feed.route_category("President announces election plan"), "politics_satire")
        self.assertEqual(feed.route_category("Unexpected city event"), "events")

    def test_candidate_expiry_never_exceeds_source_hour(self):
        item = feed.SourceItem.from_dict(
            {
                "source_id": "one",
                "platform": "news",
                "source_type": "trend_discovery",
                "author_id": "source",
                "author_name": "source",
                "original_text": "A rescued raccoon becomes viral",
                "source_url": "https://example.com/one",
                "published_at": feed.iso(NOW - timedelta(minutes=50)),
                "collected_at": feed.iso(NOW),
            }
        )
        row = worker.candidate_row(item, NOW)
        self.assertEqual(feed.parse_timestamp(row["expires_at"]), NOW + timedelta(minutes=10))
        self.assertEqual(row["category"], "animals_characters")


if __name__ == "__main__":
    unittest.main()
