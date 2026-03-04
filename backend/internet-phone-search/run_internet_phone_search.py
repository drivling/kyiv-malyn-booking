"""
Повний цикл: завантажити сторінки пошуку за номером (OLX, AUTO.RIA, DOM.RIA),
розпарсити їх і вивести JSON з посиланнями та заголовками.
"""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List

from download_internet_phone_search import build_search_urls, download_all
from parse_internet_phone_search import parse_directory


def run_lookup(phone: str, out_dir: Path | None = None) -> Dict[str, Any]:
    """
    Завантажує сторінки, парсить, повертає словник:
    - phone, searchUrls, hasData, results: [ { source, title, url, snippet } ]
    """
    phone = phone.strip().replace("+", "")
    if not phone:
        return {"phone": phone, "searchUrls": {}, "hasData": False, "results": []}

    search_urls = build_search_urls(phone)

    if out_dir is None:
        out_dir = Path(tempfile.mkdtemp(prefix="internet_search_"))

    downloaded = download_all(phone, out_dir)
    parsed = parse_directory(out_dir)

    results: List[Dict[str, str]] = []
    for source, items in parsed.items():
        for item in items:
            results.append({
                "source": source,
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "snippet": item.get("snippet", ""),
            })

    return {
        "phone": phone,
        "searchUrls": search_urls,
        "hasData": len(results) > 0,
        "results": results,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: run_internet_phone_search.py 380XXXXXXXXX", file=sys.stderr)
        sys.exit(1)

    phone = sys.argv[1].strip()
    try:
        data = run_lookup(phone)
    except Exception as e:
        print(json.dumps({"phone": phone, "error": str(e), "hasData": False, "results": []}, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()
