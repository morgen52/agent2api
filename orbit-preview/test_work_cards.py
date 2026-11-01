"""ORBIT public work card source/safety contract (no private inputs)."""
import json
import re
import unittest
from pathlib import Path
from urllib.parse import urlsplit

ROOT=Path(__file__).parent
DATA=json.loads((ROOT/"work_cards.json").read_text(encoding="utf-8"))
PINNED=re.compile(r"^https://github\.com/morgen52/agent2api/blob/([0-9a-f]{40})/src/[a-zA-Z0-9_./-]+$")
CI=re.compile(r"^https://github\.com/morgen52/agent2api/actions/runs/[0-9]+$")

def source_ok(url):
    if not isinstance(url,str): return False
    p=urlsplit(url)
    return p.scheme=="https" and p.hostname=="github.com" and p.username is None and p.password is None and not p.query and not p.fragment and bool(PINNED.fullmatch(url) or CI.fullmatch(url))

class PublicWorkManifestTests(unittest.TestCase):
    def test_public_only_and_unique_ids(self):
        self.assertEqual(DATA["schema"],1)
        self.assertEqual(DATA["visibility"],"public-source-only")
        ids=[c["id"] for c in DATA["cards"]]
        self.assertEqual(len(ids),len(set(ids)))
        self.assertTrue(all(re.fullmatch(r"c(1[0-9]|[2-9][0-9])",i) for i in ids))
    def test_pinned_provenance(self):
        for card in DATA["cards"]:
            self.assertRegex(card["sourceUrl"],PINNED)
            self.assertGreaterEqual(len(card["sourceLinks"]),2)
            for link in card["sourceLinks"]:
                self.assertTrue(source_ok(link["url"]),link["url"])
            self.assertIn("用户收益未验证",card["source"])
    def test_mechanism_and_distinct_transfer(self):
        for c in DATA["cards"]:
            self.assertEqual(len(c["draw"]["left"]),3)
            self.assertEqual(len(c["draw"]["right"]),3)
            self.assertEqual(len(c["opts"]),2)
            self.assertEqual(len(c["transfer"]["opts"]),2)
            self.assertNotEqual(c["quiz"],c["transfer"]["q"])
            self.assertIn(c["correct"],(0,1))
            self.assertIn(c["transfer"]["correct"],(0,1))
    def test_reject_unsafe_urls(self):
        for url in ("javascript:alert(1)","http://github.com/morgen52/agent2api/blob/a/src/x","https://evil.test/","https://github.com/morgen52/trace2scaffold/blob/"+"a"*40+"/src/private.ts","https://github.com/morgen52/agent2api/blob/main/src/a.ts","https://github.com/morgen52/agent2api/actions/runs/1?token=secret"):
            self.assertFalse(source_ok(url),url)
    def test_no_private_material_in_public_manifest(self):
        raw=(ROOT/"work_cards.json").read_text(encoding="utf-8")
        for word in ("trace2scaffold","PRIVATE KEY","github_pat_","sk-proj-","/Users/","lmg@"):
            self.assertNotIn(word,raw)

if __name__=="__main__": unittest.main()
