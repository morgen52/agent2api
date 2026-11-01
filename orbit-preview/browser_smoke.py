#!/usr/bin/env python3
"""Mobile-browser end-to-end check: Render page -> public GitHub source feed."""
from playwright.sync_api import sync_playwright

URL = "https://orbit-learning-preview-2026.onrender.com/?browser_smoke=1"

def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True, args=["--no-sandbox"])
        page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page.on("pageerror", lambda e: errors.append(str(e)))
        response = page.goto(URL, wait_until="domcontentloaded", timeout=45000)
        assert response and response.status == 200, f"Page status: {response.status if response else 'none'}"
        page.locator("#bottom [data-page='radar']").click(timeout=10000)
        page.wait_for_selector('section.paper a[href^="https://arxiv.org/abs/"]', timeout=25000)
        count = page.locator('section.paper a[href^="https://arxiv.org/abs/"]').count()
        assert count >= 1, "No live source items rendered"
        assert page.locator("#main").is_visible(), "Main content hidden"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2"), "Horizontal overflow on phone"
        assert not errors, f"JavaScript errors: {errors}"
        print(f"PASS: mobile 390px; HTTP 200; {count} source links; no page errors or overflow")
        browser.close()

if __name__ == "__main__":
    main()
