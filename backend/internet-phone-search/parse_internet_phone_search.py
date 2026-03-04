"""
Парсить збережені HTML сторінки пошуку (OLX, AUTO.RIA, DOM.RIA) і витягує посилання/заголовки.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

from bs4 import BeautifulSoup


def parse_html_file(path: Path, source: str) -> List[Dict[str, str]]:
    """
    Витягує з HTML список { title, url, snippet }.
    source: olx | auto_ria | dom_ria
    """
    try:
        html = path.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return []

    soup = BeautifulSoup(html, "lxml")
    results: List[Dict[str, str]] = []

    if source == "olx":
        # OLX: посилання на оголошення часто містять /uk/obyavlenie/
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "/obyavlenie/" in href or "/uk/obyavlenie/" in href:
                title = (a.get_text() or "").strip()
                if len(title) > 2 and len(title) < 300:
                    if not href.startswith("http"):
                        href = "https://www.olx.ua" + href.split("#")[0]
                    results.append({"title": title[:200], "url": href.split("?")[0], "snippet": ""})
        # дедуплікація по url
        seen = set()
        unique = []
        for r in results:
            if r["url"] not in seen:
                seen.add(r["url"])
                unique.append(r)
        results = unique[:30]

    elif source == "auto_ria":
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "/uk/cars/" in href or "/auto/" in href:
                title = (a.get_text() or "").strip()
                if len(title) > 2 and len(title) < 300:
                    if not href.startswith("http"):
                        href = "https://auto.ria.ua" + href.split("#")[0]
                    results.append({"title": title[:200], "url": href.split("?")[0], "snippet": ""})
        seen = set()
        unique = []
        for r in results:
            if r["url"] not in seen:
                seen.add(r["url"])
                unique.append(r)
        results = unique[:30]

    elif source == "dom_ria":
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "/uk/" in href and ("nedvizhimost" in href or "real-estate" in href or "/d-" in href):
                title = (a.get_text() or "").strip()
                if len(title) > 2 and len(title) < 300:
                    if not href.startswith("http"):
                        href = "https://dom.ria.ua" + href.split("#")[0]
                    results.append({"title": title[:200], "url": href.split("?")[0], "snippet": ""})
        seen = set()
        unique = []
        for r in results:
            if r["url"] not in seen:
                seen.add(r["url"])
                unique.append(r)
        results = unique[:30]

    return results


def parse_directory(dir_path: Path) -> Dict[str, Any]:
    """
    Сканує каталог на наявність olx.html, auto_ria.html, dom_ria.html,
    парсить їх і повертає { source: [ { title, url, snippet } ] }.
    """
    out: Dict[str, List[Dict[str, str]]] = {}
    for name in ("olx", "auto_ria", "dom_ria"):
        f = dir_path / f"{name}.html"
        if f.exists():
            out[name] = parse_html_file(f, name)
    return out
