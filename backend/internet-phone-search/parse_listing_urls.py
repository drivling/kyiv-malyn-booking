"""
Парсить HTML сторінки пошуку і витягує тільки посилання на оголошення (для подальшого витягування "хто").
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Tuple

from bs4 import BeautifulSoup


def extract_listing_urls(html: str, source: str) -> List[str]:
    """
    Повертає список URL оголошень з сторінки пошуку.
    source: olx | auto_ria | dom_ria
    """
    soup = BeautifulSoup(html, "lxml")
    urls: List[str] = []
    base_olx = "https://www.olx.ua"
    base_auto = "https://auto.ria.ua"
    base_dom = "https://dom.ria.ua"

    if source == "olx":
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "/obyavlenie/" in href or "/d/uk/obyavlenie/" in href:
                if not href.startswith("http"):
                    href = base_olx + href.split("#")[0]
                else:
                    href = href.split("#")[0]
                if href not in urls:
                    urls.append(href)
    elif source == "auto_ria":
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "/uk/cars/" in href or "/auto/" in href:
                if not href.startswith("http"):
                    href = base_auto + href.split("#")[0]
                else:
                    href = href.split("#")[0]
                if href not in urls:
                    urls.append(href)
    elif source == "dom_ria":
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "/uk/" in href and ("nedvizhimost" in href or "real-estate" in href or "/d-" in href):
                if not href.startswith("http"):
                    href = base_dom + href.split("#")[0]
                else:
                    href = href.split("#")[0]
                if href not in urls:
                    urls.append(href)
    return urls[:15]


def get_listing_urls_from_dir(dir_path: Path) -> List[Tuple[str, str]]:
    """
    Повертає [(source, url), ...] з усіх збережених search HTML у каталозі.
    """
    out: List[Tuple[str, str]] = []
    for name in ("olx", "auto_ria", "dom_ria"):
        f = dir_path / f"{name}.html"
        if not f.exists():
            continue
        html = f.read_text(encoding="utf-8", errors="replace")
        for url in extract_listing_urls(html, name):
            out.append((name, url))
    return out
