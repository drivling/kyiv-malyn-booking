"""
Завантажує сторінки пошуку за номером телефону з OLX, AUTO.RIA, DOM.RIA.
Google не запитуємо автоматично (обмеження ToS / блокування).
"""
from __future__ import annotations

import pathlib
import re
import sys
from typing import Dict, Optional
from urllib.parse import quote_plus

import requests

USER_AGENT = "Mozilla/5.0 (compatible; MalynRoutesBot/1.0; +https://malin.kiev.ua)"
TIMEOUT = 15


def build_search_urls(phone: str) -> Dict[str, str]:
    """Повертає словник { джерело: url } для ручного/автоматичного пошуку."""
    p = phone.strip().replace("+", "").replace(" ", "")
    q = quote_plus(p)
    return {
        "google": f"https://www.google.com/search?q={q}",
        "olx": f"https://www.olx.ua/uk/list/q-{p}/",
        "auto_ria": f"https://auto.ria.ua/uk/search/?q={q}",
        "dom_ria": f"https://dom.ria.ua/uk/search/?query={q}",
    }


def download_page(url: str) -> Optional[str]:
    """Завантажує одну сторінку, повертає HTML або None при помилці."""
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


def download_all(phone: str, output_dir: pathlib.Path | None = None) -> Dict[str, pathlib.Path]:
    """
    Завантажує сторінки пошуку (olx, auto_ria, dom_ria), зберігає у файли.
    Повертає { source: path } для успішно завантажених.
    """
    urls = build_search_urls(phone)
    out = output_dir or pathlib.Path(".")
    result: Dict[str, pathlib.Path] = {}

    for source in ("olx", "auto_ria", "dom_ria"):
        url = urls.get(source)
        if not url:
            continue
        html = download_page(url)
        if html:
            path = out / f"{source}.html"
            path.write_text(html, encoding="utf-8")
            result[source] = path

    return result


def main() -> None:
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Завантажити сторінки пошуку за номером (OLX, AUTO.RIA, DOM.RIA).")
    parser.add_argument("phone", help='Номер без "+", наприклад 380678341332')
    parser.add_argument("--out-dir", default=None, help="Каталог для HTML-файлів")
    args = parser.parse_args()

    out = pathlib.Path(args.out_dir) if args.out_dir else pathlib.Path(f"internet_search_{args.phone.strip()}")
    out.mkdir(parents=True, exist_ok=True)

    try:
        paths = download_all(args.phone.strip(), out)
        urls = build_search_urls(args.phone.strip())
        print(json.dumps({"phone": args.phone.strip(), "searchUrls": urls, "downloaded": list(paths.keys())}, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
