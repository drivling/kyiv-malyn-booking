from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

from download_opendatabot_phone_page import download_phone_page
from parse_opendatabot_phone_page import parse_opendatabot_phone_page_file


def run_lookup(phone: str, out_dir: str | Path | None = None) -> Dict[str, Any]:
    """
    Повний цикл:
    1. Завантажити HTML-сторінку Opendatabot для телефону.
    2. Розпарсити локальний HTML і повернути результат.
    """
    html_path = download_phone_page(phone, out_dir)
    data = parse_opendatabot_phone_page_file(html_path)
    return {
        "phone": phone,
        "html_file": str(html_path),
        "result": data,
    }


def format_first_fop_short(result: Dict[str, Any]) -> Optional[str]:
    """
    Беремо перший ФОП з result["entries"] і повертаємо скорочене ім'я:

    - "ФОП Меренкова Тетяна Миколаївна" -> "Меренкова Тетяна"
    - "ФОП Боженко Яна Володимирівна"  -> "Боженко Яна"
    """
    entries = result.get("entries") or []
    if not entries:
        return None

    first = entries[0]
    full_name = first.get("name") or ""
    full_name = full_name.strip()

    # Прибираємо префікс "ФОП "
    if full_name.startswith("ФОП "):
        full_name = full_name[4:].strip()

    parts = full_name.split()
    if len(parts) >= 2:
        # Прізвище + ім'я, без по батькові
        return " ".join(parts[:2])

    return full_name or None


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description=(
            "Повний флоу: завантажити сторінку Opendatabot для телефону 380XXXXXXXXX "
            "та одразу її розпарсити (ФОП за телефоном). "
            "За замовчуванням виводить скорочене ім'я першого ФОП."
        )
    )
    parser.add_argument(
        "phone",
        help='Номер телефону без "+", наприклад: 380938901865',
    )
    parser.add_argument(
        "--out-dir",
        help="Каталог для збереження HTML-файлу (за замовчуванням — поточна директорія).",
        default=None,
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Замість тексту вивести повний JSON результату.",
    )
    parser.add_argument(
        "--pretty-json",
        action="store_true",
        help="Якщо разом з --json, форматувати JSON з відступами.",
    )

    args = parser.parse_args()

    try:
        payload = run_lookup(args.phone, args.out_dir)
    except Exception as exc:  # noqa: BLE001
        print(f"Помилка під час завантаження або парсингу: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        if args.pretty_json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(json.dumps(payload, ensure_ascii=False))
        return

    # Режим за замовчуванням: короткий текст першого ФОП
    short_name = format_first_fop_short(payload.get("result", {}))
    if short_name:
        print(short_name)
    else:
        print("ФОП не знайдено")


if __name__ == "__main__":
    main()

