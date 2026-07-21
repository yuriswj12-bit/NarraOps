import unittest

import pulse_discovery as pulse


RSS = b"""<?xml version="1.0"?><rss><channel>
<item><title>Hero dog rescues family</title><link>https://example.com/dog</link><description>A dog saved a family and became viral.</description><pubDate>today</pubDate></item>
<item><title>Hero dog rescues family</title><link>https://other.example/dog</link><description>The heroic dog is now an internet community icon.</description><pubDate>today</pubDate></item>
</channel></rss>"""


class PulseDiscoveryTests(unittest.TestCase):
    def test_parse_and_exact_dedupe(self):
        source = {"name": "fixture", "platform": "rss", "url": "https://example.com/feed"}
        rows = pulse.parse_feed(RSS, source)
        self.assertEqual(len(rows), 2)
        self.assertEqual(len(pulse.exact_dedupe(rows + [rows[0]])), 2)

    def test_related_items_cluster_and_pass_gates(self):
        one = pulse.parse_feed(RSS, {"name": "one", "url": "https://example.com/feed"})[0]
        two = pulse.parse_feed(RSS, {"name": "two", "url": "https://other.example/feed"})[1]
        clusters = pulse.cluster_candidates([one, two], threshold=0.2)
        self.assertEqual(len(clusters), 1)
        card = pulse.analyze_cluster(clusters[0])
        self.assertEqual(card["state"], "high_priority")
        self.assertEqual(card["relationship"], "not_yet_token_linked")

    def test_token_promotion_is_rejected(self):
        candidate = {
            "candidate_id": "cand_test",
            "title": "Buy this token now",
            "content": "Contract address CA: abc and buy now on pump.fun",
            "source_name": "promo",
            "source_url": "https://example.com/promo",
            "platform": "rss",
            "published_at": None,
        }
        self.assertEqual(pulse.analyze_cluster([candidate])["state"], "reject")

    def test_short_hook_does_not_match_inside_another_word(self):
        self.assertFalse(pulse.contains_any("an enterprise agent catalog", {"cat"}))

    def test_distinctive_entity_clusters_related_headlines(self):
        rows = [
            {"candidate_id": "a", "title": "Jimothy raccoon inspires mural", "content": "Seattle story", "source_url": "https://a.test", "source_name": "a"},
            {"candidate_id": "b", "title": "Veterinarian examines Jimothy", "content": "Rare spine condition", "source_url": "https://b.test", "source_name": "b"},
        ]
        self.assertEqual(len(pulse.cluster_candidates(rows)), 1)


if __name__ == "__main__":
    unittest.main()
