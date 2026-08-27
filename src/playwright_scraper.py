"""Rendered-page scraper used by the Node source adapters.

The process reads one JSON request from stdin and writes one JSON response to
stdout.  Keeping the browser implementation here makes Python Playwright's
synchronous API the single acquisition layer while the application can retain
its existing JavaScript normalization and matching code.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
import json
import os
import sys
from urllib.parse import urldefrag, urljoin, urlparse

from playwright.sync_api import Page, sync_playwright


def _extract(page: Page) -> dict:
    """Capture rendered content and common semantic data structures."""
    return page.evaluate(
        """() => {
          const visible = element => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return style.visibility !== 'hidden' && style.display !== 'none' && box.width > 0 && box.height > 0;
          };
          const rows = root => [...root.querySelectorAll('tr')].map(row =>
            [...row.querySelectorAll('th,td')].map(cell => cell.innerText.trim()).filter(Boolean)
          ).filter(row => row.length);
          const grids = [...document.querySelectorAll('[role="grid"], [role="table"]')].map(grid => ({
            label: grid.getAttribute('aria-label') || '',
            rows: [...grid.querySelectorAll('[role="row"]')].map(row =>
              [...row.querySelectorAll('[role="columnheader"], [role="rowheader"], [role="gridcell"], [role="cell"]')]
                .map(cell => cell.innerText.trim()).filter(Boolean)
            ).filter(row => row.length)
          }));
          return {
            html: document.documentElement.outerHTML,
            text: document.body ? document.body.innerText.trim() : '',
            headings: [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
              .filter(visible).map(node => ({level: Number(node.tagName.slice(1)), text: node.innerText.trim()})).filter(item => item.text),
            links: [...document.querySelectorAll('a[href]')]
              .filter(visible).map(node => ({text: node.innerText.trim(), url: node.href})),
            tables: [...document.querySelectorAll('table')].filter(visible).map(table => ({
              caption: table.caption ? table.caption.innerText.trim() : '', rows: rows(table)
            })),
            grids
          };
        }"""
    )


def _settle(page: Page) -> None:
    page.wait_for_load_state("domcontentloaded")
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except Exception:
        # Long-polling pages may never become idle; the rendered DOM is still usable.
        page.wait_for_timeout(1_000)


def scrape(request: dict) -> dict:
    start_url = request["url"]
    origin = urlparse(start_url)
    limit = max(1, min(int(request.get("maxPages", 1)), 50))
    queue = deque([start_url])
    seen: set[str] = set()
    captures = []

    with sync_playwright() as playwright:
        launch_options = {"headless": True}
        executable = request.get("executablePath") or os.getenv("CHROMIUM_EXECUTABLE_PATH")
        if executable:
            launch_options["executable_path"] = executable
        browser = playwright.chromium.launch(**launch_options)
        context = browser.new_context()
        page = context.new_page()
        try:
            while queue and len(captures) < limit:
                url = urldefrag(queue.popleft())[0]
                if url in seen:
                    continue
                seen.add(url)
                response = page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                if response and response.status in (401, 403, 429):
                    raise RuntimeError(f"Access stopped (HTTP {response.status}); confirm the approved access method.")

                if not captures and request.get("location"):
                    selector = request.get("locationSelector", "#filter-location-input")
                    field = page.locator(selector)
                    field.wait_for(state="visible", timeout=15_000)
                    field.fill(request["location"])
                    field.press("Enter")
                _settle(page)
                capture = _extract(page)
                capture.update(url=page.url, capturedAt=datetime.now(timezone.utc).isoformat())
                captures.append(capture)

                for link in capture["links"]:
                    candidate = urldefrag(urljoin(page.url, link["url"]))[0]
                    parsed = urlparse(candidate)
                    if parsed.scheme in ("http", "https") and (parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc) and candidate not in seen:
                        queue.append(candidate)
        finally:
            context.close()
            browser.close()
    return {"pages": captures}


if __name__ == "__main__":
    try:
        print(json.dumps(scrape(json.load(sys.stdin))))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
