import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import json

import narrative_feed as feed


NOW = datetime(2026, 7, 30, 4, 0, tzinfo=timezone.utc)


def source(published_at: datetime = NOW - timedelta(minutes=10)) -> feed.SourceItem:
    return feed.SourceItem.from_dict(
        {
            "source_id": "123",
            "platform": "x",
            "source_type": "monitored_account",
            "author_id": "42",
            "author_name": "source",
            "original_text": "Original post content",
            "source_url": "https://x.com/source/status/123",
            "media_type": "image",
            "media_urls": ["https://pbs.twimg.com/media/example.jpg"],
            "video_thumbnail_url": None,
            "published_at": feed.iso(published_at),
            "collected_at": feed.iso(NOW),
        }
    )


class NarrativeFeedTests(unittest.TestCase):
    def test_card_contains_only_source_content_and_lifecycle_fields(self):
        card = source().to_card("events", NOW)
        self.assertEqual(card["original_text"], "Original post content")
        self.assertNotIn("summary", card)
        self.assertNotIn("score", card)
        self.assertNotIn("risk_flags", card)
        self.assertNotIn("ai_explanation", card)

    def test_card_expires_after_30_minutes_when_source_is_fresh(self):
        card = source(NOW - timedelta(minutes=5)).to_card("events", NOW)
        self.assertEqual(
            feed.parse_timestamp(card["expires_at"]),
            NOW + timedelta(minutes=30),
        )

    def test_old_source_expires_at_one_hour_age(self):
        card = source(NOW - timedelta(minutes=50)).to_card("events", NOW)
        self.assertEqual(
            feed.parse_timestamp(card["expires_at"]),
            NOW + timedelta(minutes=10),
        )

    def test_source_older_than_one_hour_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "one-hour"):
            source(NOW - timedelta(hours=1)).to_card("events", NOW)

    def test_tiktok_is_not_a_supported_v1_platform(self):
        value = dict(source().__dict__)
        value["platform"] = "tiktok"
        with self.assertRaisesRegex(ValueError, "unsupported platform"):
            feed.SourceItem.from_dict(value)

    def test_exact_dedupe_keeps_one_source_item(self):
        item = source()
        self.assertEqual(len(feed.exact_dedupe([item, item])), 1)

    def test_registry_rejects_duplicate_handles(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "sources.json"
            path.write_text(
                json.dumps(
                    [
                        {
                            "platform": "x",
                            "source_type": "monitored_account",
                            "handle": "@Example",
                        },
                        {
                            "platform": "x",
                            "source_type": "monitored_account",
                            "handle": "example",
                        },
                    ]
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "duplicate"):
                feed.load_source_registry(path)


if __name__ == "__main__":
    unittest.main()
