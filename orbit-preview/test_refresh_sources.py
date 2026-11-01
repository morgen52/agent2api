import unittest
from refresh_sources import extract, merge

RSS = b"""<?xml version="1.0" encoding="utf-8"?>
<rss><channel>
<item><title>Harness Evolution for Agentic RL</title>
<link>https://arxiv.org/abs/2610.12345</link>
<description>We study harness design and agentic reinforcement learning.</description></item>
<item><title>Unrelated physics paper</title>
<link>https://arxiv.org/abs/2610.12346</link>
<description>Particle collision.</description></item>
<item><title>Harness but untrusted URL</title>
<link>https://evil.example/abs/2610.12347</link>
<description>harness</description></item>
</channel></rss>"""

class RadarTests(unittest.TestCase):
    def test_extract_only_relevant_official_arxiv_links(self):
        found = extract(RSS)
        self.assertEqual([x["id"] for x in found], ["2610.12345"])
        self.assertEqual(found[0]["evidence_level"], "unreviewed_metadata")

    def test_merge_deduplicates_and_preserves_existing(self):
        new = extract(RSS)
        prev = [dict(new[0], title="old"), dict(new[0], id="2610.99999")]
        out = merge(new, prev)
        self.assertEqual(len(out), 2)
        self.assertEqual(next(x for x in out if x["id"]=="2610.12345")["title"], new[0]["title"])

if __name__ == "__main__":
    unittest.main()
