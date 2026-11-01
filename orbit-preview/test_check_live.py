"""Regression checks: feature markers alone must never pass a stale deployment."""
import unittest
from check_live import EXPECTED, verify_response

class ExactDeployTests(unittest.TestCase):
    def setUp(self):
        self.source = ("\n".join(EXPECTED)).encode("utf-8")

    def test_exact_live_bytes_pass(self):
        ok, message = verify_response(200, "text/html; charset=utf-8", self.source, self.source)
        self.assertTrue(ok, message)

    def test_stale_page_with_all_feature_markers_fails(self):
        stale = self.source + b"<!-- old build -->"
        ok, message = verify_response(200, "text/html", stale, self.source)
        self.assertFalse(ok)
        self.assertIn("STALE_OR_MODIFIED_DEPLOY", message)

    def test_missing_feature_fails(self):
        ok, message = verify_response(200, "text/html", b"<html></html>", self.source)
        self.assertFalse(ok)
        self.assertIn("missing expected features", message)

    def test_http_error_fails(self):
        self.assertFalse(verify_response(503, "text/html", self.source, self.source)[0])

    def test_non_html_fails(self):
        self.assertFalse(verify_response(200, "application/json", self.source, self.source)[0])

if __name__ == "__main__":
    unittest.main()
