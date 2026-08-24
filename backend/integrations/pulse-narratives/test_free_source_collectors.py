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
        self.assertEqual([row.platform for row in rows], ["x"])
        self.assertEqual(rows[0].author_name, "story")
        card = rows[0].to_card("events", NOW)
        self.assertEqual(card["original_text"], "Original X post")
        self.assertNotIn("score", card)
        self.assertNotIn("summary", card)

    def test_opennews_discards_sources_older_than_four_hours(self):
        payload = {
            "success": True,
            "news": {
                "items": [
                    {
                        "id": 1,
                        "link": "https://example.com/old",
                        "published_at": (NOW - timedelta(hours=4)).isoformat(),
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
                        "link": "https://x.com/Example/status/1",
                        "published_at": published,
                        "source": "Example",
                        "title": "Original headline",
                    },
                    {
                        "id": 2,
                        "link": "https://x.com/Example/status/1",
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
        self.assertEqual(rows, [])

    def test_opennews_keeps_x_posts_and_drops_news_and_junk(self):
        published = (NOW - timedelta(minutes=10)).isoformat()
        payload = {
            "success": True,
            "news": {
                "items": [
                    {
                        "id": 1,
                        "link": "https://x.com/coolish/status/1",
                        "published_at": published,
                        "source": "Twitter",
                        "title": "A raccoon in a tiny hat just went viral",
                    },
                    {
                        "id": 2,
                        "link": "https://www.bbc.com/news/world",
                        "published_at": published,
                        "source": "BBC News",
                        "title": "Rain to return this week with thunderstorms",
                    },
                    {
                        "id": 3,
                        "link": "https://x.com/spam/status/3",
                        "published_at": published,
                        "source": "twitter",
                        "title": "Missed SHIB and FLOKI Early? Next 100x meme",
                    },
                ]
            },
            "tweets": {"items": []},
        }
        rows = collectors.parse_opennews_payload(payload, NOW)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].author_name, "coolish")
        self.assertEqual(rows[0].platform, "x")

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
        self.assertEqual(items, [])
        self.assertEqual(statuses[0]["status"], "skipped")
        self.assertEqual(statuses[0]["reason"], "x_posts_only")


if __name__ == "__main__":
    unittest.main()
