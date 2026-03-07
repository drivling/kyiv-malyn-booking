#!/usr/bin/env python3
"""
Парсинг збережених HTML-сторінок Facebook MalynCityCouncil.
Запускати після того, як ви збережете сторінки в data/malyn-transport/facebook_saved/

Очікувані файли:
- post_route9_schedule.html
- post_routes_7_8.html
- post_schedule_malyn.html
- post_suburban.html
"""

import json
import re
from pathlib import Path

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Потрібно: pip install beautifulsoup4")
    exit(1)

BASE = Path(__file__).resolve().parent.parent
SAVED_DIR = BASE / "data" / "malyn-transport" / "facebook_saved"
SUPPLEMENT_PATH = BASE / "data" / "malyn-transport" / "malyn_media_supplement.json"


def extract_text_from_html(html_path: Path) -> str:
    """Витягти текст з HTML (Facebook зберігає контент у різних місцях)."""
    with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def parse_facebook_post(html_path: Path) -> dict:
    """Спроба витягти структуровані дані з поста."""
    text = extract_text_from_html(html_path)
    return {
        "file": html_path.name,
        "raw_text_preview": text[:2000] if len(text) > 2000 else text,
        "length": len(text),
    }


def main():
    if not SAVED_DIR.exists():
        print(f"Папка не знайдена: {SAVED_DIR}")
        return 1

    html_files = list(SAVED_DIR.glob("*.html"))
    if not html_files:
        print(f"HTML-файлів не знайдено в {SAVED_DIR}")
        print("Збережіть сторінки Facebook згідно facebook_posts_to_fetch.md")
        return 1

    results = []
    for path in sorted(html_files):
        try:
            data = parse_facebook_post(path)
            results.append(data)
            print(f"  {path.name}: {data['length']} символів")
        except Exception as e:
            print(f"  {path.name}: помилка — {e}")

    # Зберегти результат
    output = {
        "source": "facebook_saved",
        "parsed_at": __import__("datetime").datetime.now().isoformat()[:10],
        "files_parsed": len(results),
        "posts": results,
    }

    out_path = SAVED_DIR / "parsed_facebook.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nЗбережено: {out_path}")

    # Можна додати логіку злиття з malyn_media_supplement.json
    # зараз лише зберігаємо сирий витяг для ручного аналізу

    return 0


if __name__ == "__main__":
    exit(main())
