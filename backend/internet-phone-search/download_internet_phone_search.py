"""
Завантажує сторінки пошуку за номером (OLX, AUTO.RIA, DOM.RIA).
"""
from __future__ import annotations

import pathlib
from typing import Dict, Optional
from urllib.parse import quote_plus

import requests

USER_AGENT = "Mozilla/5.0 (compatible; MalynRoutesBot/1.0; +https://malin.kiev.ua)"
TIMEOUT = 15


def build_search_urls(phone: str) -> Dict[str, str]:
    p = phone.strip().replace("+", "").replace(" ", "")
    q = quote_plus(p)
    return {
        "google": f"https://www.google.com/search?q={q}",
        "olx": f"https://www.olx.ua/uk/list/q-{p}/",
        "auto_ria": f"https://auto.ria.ua/uk/search/?q={q}",
        "dom_ria": f"https://dom.ria.ua/uk/search/?query={q}",
    }


def download_page(url: str) -> Optional[str]:
    try:
        r = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.text
    except Exception:
        return None


def download_all(phone: str, output_dir: pathlib.Path) -> Dict[str, pathlib.Path]:
    urls = build_search_urls(phone)
    result: Dict[str, pathlib.Path] = {}
    for source in ("olx", "auto_ria", "dom_ria"):
        url = urls.get(source)
        if not url:
            continue
        html = download_page(url)
        if html:
            path = output_dir / f"{source}.html"
            path.write_text(html, encoding="utf-8")
            result[source] = path
    return result
