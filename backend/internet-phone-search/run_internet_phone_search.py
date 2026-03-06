#!/usr/bin/env python3
"""
За номером: завантажує сторінки пошуку OLX/AUTO.RIA/DOM.RIA,
витягує посилання на оголошення, з кожного оголошення витягує «хто» (ім'я/підпис продавця).
Відповідь — хто це людина, а не що він продає.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

from download_internet_phone_search import build_search_urls, download_all
from fetch_who_from_listing import fetch_who
from parse_listing_urls import get_listing_urls_from_dir


def normalize_phone(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    if digits.startswith("38") and len(digits) == 12:
        return digits
    if len(digits) == 10:
        return "38" + digits
    return digits


def main() -> int:
    parser = argparse.ArgumentParser(description="Пошук за номером: хто (ім'я/підпис), не що продає")
    parser.add_argument("phone", help="Номер телефону (наприклад 380679551952)")
    parser.add_argument("--json", action="store_true", help="Вивести повний JSON")
    parser.add_argument("--max-listings", type=int, default=5, help="Макс. оголошень з кожного сайту для перегляду (default 5)")
    args = parser.parse_args()

    phone = normalize_phone(args.phone)
    if len(phone) < 10:
        print("Некоректний номер", file=sys.stderr)
        return 1

    search_urls = build_search_urls(phone)
    with tempfile.TemporaryDirectory() as tmp:
        out_dir = Path(tmp)
        downloaded = download_all(phone, out_dir)
        listing_pairs = get_listing_urls_from_dir(out_dir)

    # Обмежуємо кількість переглядів оголошень з кожного джерела
    per_source: dict[str, int] = {}
    limited: list[tuple[str, str]] = []
    for source, url in listing_pairs:
        n = per_source.get(source, 0)
        if n >= args.max_listings:
            continue
        per_source[source] = n + 1
        limited.append((source, url))

    results: list[dict] = []
    seen_who: set[str] = set()
    for source, url in limited:
        who = fetch_who(url, source)
        who_clean = (who or "").strip()
        if who_clean and who_clean not in seen_who:
            seen_who.add(who_clean)
            results.append({"source": source, "who": who_clean, "url": url})
        elif url and not who_clean:
            results.append({"source": source, "who": None, "url": url})

    has_data = len(results) > 0
    payload = {
        "phone": phone,
        "searchUrls": search_urls,
        "hasData": has_data,
        "results": results,
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        for r in results:
            who = r.get("who")
            if who:
                print(who)
            else:
                print(r.get("url", ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
