from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup


def parse_opendatabot_phone_page_html(html: str) -> Dict[str, Any]:
    """
    Парсит HTML-сторінку opendatabot.ua/t/... з локального файлу.

    Повертає словник:
    {
        "found_count_declared": <int | None>,
        "entries": [
            {"type": "ФОП", "name": "ФОП Боженко Яна Володимирівна"},
            ...
        ]
    }
    """
    soup = BeautifulSoup(html, "lxml")

    results: List[Dict[str, str]] = []

    # Шукаємо заголовки, в яких є "ФОП ..."
    heading_tags = ["h1", "h2", "h3", "h4", "h5", "h6"]

    for tag_name in heading_tags:
        for tag in soup.find_all(tag_name):
            text = tag.get_text(strip=True)
            if text.startswith("ФОП "):
                results.append(
                    {
                        "type": "ФОП",
                        "name": text,
                    }
                )

    # Опційно: парсимо рядок "Знайдено: N", якщо він є
    found_count: Optional[int] = None
    for node in soup.find_all(string=re.compile(r"Знайдено:\s*\d+")):
        match = re.search(r"Знайдено:\s*(\d+)", node)
        if match:
            try:
                found_count = int(match.group(1))
            except ValueError:
                found_count = None
            break

    return {
        "found_count_declared": found_count,
        "entries": results,
    }


def parse_opendatabot_phone_page_file(path: str | Path) -> Dict[str, Any]:
    """
    Читає локальний HTML-файл і повертає результат parse_opendatabot_phone_page_html.
    """
    file_path = Path(path)
    html = file_path.read_text(encoding="utf-8")
    return parse_opendatabot_phone_page_html(html)


def main() -> None:
    import argparse
    import json
    import sys

    parser = argparse.ArgumentParser(
        description=(
            "Парсер локальних HTML-сторінок Opendatabot з пошуком ФОП за телефоном. "
            "HTML потрібно попередньо зберегти з браузера вручну."
        )
    )
    parser.add_argument(
        "html_file",
        help="Шлях до локального HTML-файлу, збереженого з opendatabot.ua/t/...",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Форматувати JSON з відступами для читабельності.",
    )

    args = parser.parse_args()

    try:
        data = parse_opendatabot_phone_page_file(args.html_file)
    except FileNotFoundError:
        print(f"Файл не знайдено: {args.html_file}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"Помилка під час парсингу: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.pretty:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(data, ensure_ascii=False))


if __name__ == "__main__":
    main()

