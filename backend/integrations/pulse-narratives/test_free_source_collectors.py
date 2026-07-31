import unittest
from datetime import datetime, timedelta, timezone

import free_source_collectors as collectors


NOW = datetime(2026, 7, 30, 9, 0, tzinfo=timezone.utc)


class FreeSourceCollectorTests(unittest.TestCase):
    def test_opennews_normalizes_x_and_news_without_ai_fields(self):
        payload = {
            "success": True,
            "news": {
                "items": [
                    {
                        "id": 1,
                        "link": "https://x.com/story/status/1",
                        "published_at": (NOW - timedelta(minutes=10)).isoformat(),
                        "source": "twitter",
                        "title": "Original X post",
                    },
                    {
                        "id": 2,
                        "link": "https://example.com/story",
                        "published_at": (NOW - timedelta(minutes=20)).isoformat(),
                        "source": "Example",
                        "title": "Original news headline",
                    },
                ]
            },
            "tweets": {"items": []},
        }
        rows = collectors.parse_opennews_payload(payload, NOW)
        self.assertEqual([row.platform for row in rows], ["x", "news"])
        card = rows[0].to_card("events", NOW)
        self.assertEqual(card["original_text"], "Original X post")
        self.assertNotIn("score", card)
        self.assertNotIn("summary", card)

    def test_opennews_discards_sources_older_than_one_hour(self):
        payload = {
            "success": True,
            "news": {
                "items": [
                    {
                        "id": 1,
                        "link": "https://example.com/old",
                        "published_at": (NOW - timedelta(hours=1)).isoformat(),
                        "source": "Example",
                        "title": "Old item",
                    }
                ]
            },
        }
        self.assertEqual(collectors.parse_opennews_payload(payload, NOW), [])

    def test_opennews_deduplicates_same_original_url(self):
        published = (NOW - timedelta(minutes=10)).isoformat()
        payload = {
            "success": True,
            "news": {
                "items": [
                    {
                        "id": 1,
                        "link": "https://example.com/story",
                        "published_at": published,
                        "source": "Example",
                        "title": "Original headline",
                    },
                    {
                        "id": 2,
                        "link": "https://example.com/story",
                        "published_at": published,
                        "source": "Aggregator",
                        "title": "Original headline",
                    },
                ]
            },
        }
        self.assertEqual(len(collectors.parse_opennews_payload(payload, NOW)), 1)

    def test_rss_preserves_original_content_and_media(self):
        published = (NOW - timedelta(minutes=5)).strftime(
            "%a, %d %b %Y %H:%M:%S +0000"
        )
        xml = f"""<?xml version="1.0"?>
        <rss xmlns:media="http://search.yahoo.com/mrss/">
          <channel><item>
            <guid>story-1</guid>
            <title>Headline</title>
            <description><![CDATA[<p>Original body</p>]]></description>
            <link>https://example.com/story</link>
            <pubDate>{published}</pubDate>
            <media:content url="https://example.com/image.jpg" type="image/jpeg" />
          </item></channel>
        </rss>""".encode()
        rows = collectors.parse_feed_payload(
            xml,
            {"name": "Example RSS", "url": "https://example.com/feed"},
            NOW,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].original_text, "Original body")
        self.assertEqual(rows[0].media_urls, ("https://example.com/image.jpg",))

    def test_rss_requires_real_published_timestamp(self):
        xml = b"""<rss><channel><item>
          <title>Headline</title><description>Body</description>
          <link>https://example.com/story</link>
        </item></channel></rss>"""
        rows = collectors.parse_feed_payload(
            xml,
            {"name": "Example RSS", "url": "https://example.com/feed"},
            NOW,
        )
        self.assertEqual(rows, [])

    def test_collector_failure_does_not_generate_placeholder_items(self):
        items, statuses = collectors.collect_free_sources(
            [{"id": "bad", "type": "unsupported"}],
            now=NOW,
        )
        self.assertEqual(items, [])
        self.assertEqual(statuses[0]["status"], "unavailable")

    def test_remote_disconnect_is_treated_as_source_unavailable(self):
        class Boom(Exception):
            pass

        def boom(*_args, **_kwargs):
            raise ConnectionResetError("Remote end closed connection without response")

        original = collectors.fetch_rss
        collectors.fetch_rss = boom
        try:
            items, statuses = collectors.collect_free_sources(
                [{
                    "id": "flaky",
                    "type": "rss",
                    "name": "Flaky",
                    "url": "https://example.com/feed",
                    "enabled": True,
                }],
                now=NOW,
            )
        finally:
            collectors.fetch_rss = original
        self.assertEqual(items, [])
        self.assertEqual(statuses[0]["status"], "unavailable")
        self.assertEqual(statuses[0]["error_type"], "ConnectionResetError")


if __name__ == "__main__":
    unittest.main()
