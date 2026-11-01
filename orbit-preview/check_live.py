#!/usr/bin/env python3
"""Black-box check of the publicly served ORBIT learning preview.

No authentication, cookies, private data or tokens are sent.
"""
import sys
import time
import urllib.error
import urllib.request

URL = "https://orbit-learning-preview-2026.onrender.com/?orbit_smoke=" + str(int(time.time()))
EXPECTED = (
    "<title>ORBIT · Learning Preview</title>",
    "Harness-Zero",
    "Harness Scaling",
    "ORBIT_TRANSFER",
    "data-transfer-id",
)

def main():
    last = ""
    for attempt in range(6):
        try:
            req = urllib.request.Request(
                URL, headers={"User-Agent": "ORBIT-public-smoke/1.0", "Cache-Control": "no-cache"}
            )
            with urllib.request.urlopen(req, timeout=25) as response:
                body = response.read(250000).decode("utf-8", errors="replace")
                status = response.status
                ctype = response.headers.get("Content-Type", "")
            missing = [token for token in EXPECTED if token not in body]
            if status == 200 and "text/html" in ctype and not missing:
                print(f"PASS: HTTP {status}; {len(body)} chars; all {len(EXPECTED)} markers present")
                return 0
            last = f"status={status} content-type={ctype} missing={missing}"
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last = f"{type(exc).__name__}: {exc}"
        print(f"Attempt {attempt + 1}/6 failed: {last}", flush=True)
        if attempt < 5:
            time.sleep(10)
    print("FAIL: live URL does not serve expected current version: " + last, file=sys.stderr)
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
