#!/usr/bin/env python3
"""Collect public arXiv metadata for ORBIT's explicitly unreviewed research radar.

Never treats a paper title/abstract as verified experimental evidence.
No credentials, personal profiles, private documents or model calls.
"""
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

OUT = Path(__file__).with_name("research.json")
FEEDS = ("https://rss.arxiv.org/rss/cs.AI", "https://rss.arxiv.org/rss/cs.LG")
WEIGHTS = (
    ("harness", 10), ("scaffold", 8), ("agentic reinforcement learning", 9),
    ("agentic rl", 9), ("tool use", 5), ("tool-use", 5), ("tool calling", 5),
    ("self-improvement", 7), ("self-evolution", 7), ("meta-reasoning", 7),
    ("computer use", 7), ("web agent", 7), ("browser agent", 7),
    ("in-browser", 7), ("webgpu", 6), ("llm serving", 7),
    ("inference scheduling", 6), ("continual reinforcement", 6),
    ("test-time learning", 7), ("model merging", 6),
    ("reverse engineering", 6), ("tool generation", 7),
    ("reinforcement learning", 3), ("agent", 2), ("reasoning", 1),
)
ARXIV_ID = re.compile(r"^https?://(?:www\.)?arxiv\.org/abs/(\d{4}\.\d{4,5})(?:v\d+)?/?$")
TAG = re.compile(r"<[^>]*>")
SPACE = re.compile(r"\s+")

def clean(value):
    return SPACE.sub(" ", html.unescape(TAG.sub(" ", value or ""))).strip()

def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": "ORBITResearchRadar/0.1 (public arXiv RSS metadata; no bulk downloads)",
        "Accept": "application/rss+xml, application/xml, text/xml",
    })
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=35) as response:
                data = response.read(5_000_000)
                if response.status != 200:
                    raise RuntimeError(f"HTTP {response.status}")
                return data
        except Exception:
            if i == 2:
                raise
            time.sleep(2 ** i)

def extract(xml):
    root = ET.fromstring(xml)
    found = []
    for item in root.findall(".//item"):
        title = clean(item.findtext("title"))
        link = clean(item.findtext("link"))
        abstract = clean(item.findtext("description"))
        match = ARXIV_ID.fullmatch(link)
        if not match or not title:
            continue
        lowered = (title + " " + abstract[:900]).lower()
        hits = [(word, points) for word, points in WEIGHTS if word in lowered]
        score = sum(points for _, points in hits)
        if score < 7:
            continue
        # Only title/abstract metadata is inspected, not paper methodology or results.
        found.append({
            "id": match.group(1),
            "title": title[:240],
            "url": "https://arxiv.org/abs/" + match.group(1),
            "abstract_excerpt": abstract[:260],
            "relevance_terms": [word for word, _ in sorted(hits, key=lambda x: -x[1])[:3]],
            "score": score,
            "evidence_level": "unreviewed_metadata",
        })
    return found

def merge(current, previous):
    merged = {row["id"]: row for row in previous if isinstance(row, dict)
              and re.fullmatch(r"\d{4}\.\d{4,5}", str(row.get("id", "")))}
    for row in current:
        merged[row["id"]] = row
    return sorted(merged.values(), key=lambda r: (-r.get("score", 0), r["id"]), reverse=False)[:16]

def main():
    previous = []
    if OUT.exists():
        try:
            previous = json.loads(OUT.read_text(encoding="utf-8")).get("papers", [])
        except (ValueError, OSError):
            pass
    new = []
    for feed in FEEDS:
        payload = fetch(feed)
        new.extend(extract(payload))
        print(f"Fetched {feed}; relevant metadata items so far: {len(new)}")
    papers = merge(new, previous)
    if not papers:
        raise RuntimeError("No matching arXiv metadata found; retaining prior file")
    output = {
        "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "origin": "arXiv official cs.AI/cs.LG RSS",
        "disclaimer": "自动关键词筛选，仅是论文线索；未精读、未核验方法和实验，不代表研究结论。",
        "papers": papers,
    }
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else None
    if old and old.get("papers") == papers:
        print("No content change; keeping existing checked_at to avoid unnecessary commits")
        return
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {OUT} with {len(papers)} papers")

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}; existing feed preserved", file=sys.stderr)
        raise
