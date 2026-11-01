#!/usr/bin/env python3
"""Black-box proof that Render serves the exact checked-out ORBIT HTML.

This deliberately compares bytes, not just old feature markers: a stale Render
deploy must fail when the source changes. No credentials or private data.
"""
import hashlib
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

URL = "https://orbit-learning-preview-2026.onrender.com/?orbit_smoke=" + str(int(time.time()))
SOURCE = Path(__file__).with_name("index.html")
EXPECTED = (
    "<title>ORBIT · Learning Preview</title>",
    "Harness-Zero",
    "Harness Scaling",
    "ORBIT_TRANSFER",
    "data-transfer-id",
    "ORBIT_RADAR_URL",
)

def digest(payload):
    return hashlib.sha256(payload).hexdigest()

def verify_response(status, content_type, body, source):
    if status != 200:
        return False, f"HTTP {status}"
    if "text/html" not in content_type.lower():
        return False, f"unexpected content type: {content_type}"
    try:
        decoded = body.decode("utf-8")
    except UnicodeDecodeError:
        return False, "response is not UTF-8"
    missing = [marker for marker in EXPECTED if marker not in decoded]
    if missing:
        return False, f"missing expected features: {missing}"
    if body != source:
        return False, (
            "STALE_OR_MODIFIED_DEPLOY: source sha256=" + digest(source) +
            ", live sha256=" + digest(body)
        )
    return True, f"exact source verified, sha256={digest(body)}, bytes={len(body)}"

def main():
    expected_bytes = SOURCE.read_bytes()
    last = ""
    for attempt in range(6):
        try:
            req = urllib.request.Request(
                URL, headers={"User-Agent": "ORBIT-public-smoke/2.0", "Cache-Control": "no-cache"}
            )
            with urllib.request.urlopen(req, timeout=25) as response:
                body = response.read(500_001)
                ok, last = verify_response(
                    response.status, response.headers.get("Content-Type", ""), body, expected_bytes
                )
            if ok:
                print("PASS: HTTP 200; " + last)
                return 0
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        print(f"Attempt {attempt + 1}/6 failed: {last}", flush=True)
        if attempt < 5:
            time.sleep(10)
    print("FAIL: live endpoint does not match checked-out source: " + last, file=sys.stderr)
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
