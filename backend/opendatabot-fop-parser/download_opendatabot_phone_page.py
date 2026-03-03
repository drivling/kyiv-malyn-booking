from __future__ import annotations

import pathlib
import sys
from typing import Final

import requests


BASE_URL: Final[str] = "https://opendatabot.ua/t"


def build_phone_url(phone: str) -> str:
    """
    Будує URL для сторінки пошуку за телефоном.

    Вхід: телефон без плюса, наприклад "380938901865".
    """
    phone = phone.strip()
    return f"{BASE_URL}/{phone}"


def download_phone_page(phone: str, output_dir: str | pathlib.Path | None = None) -> pathlib.Path:
    """
    Завантажує HTML-сторінку для телефону і зберігає у файл <phone>.html.

    Повертає шлях до збереженого файлу.
    """
    url = build_phone_url(phone)

    if output_dir is None:
        output_path = pathlib.Path(f"{phone}.html")
    else:
        output_path = pathlib.Path(output_dir) / f"{phone}.html"

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; MalynRoutesBot/1.0; +https://example.com)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    response = requests.get(url, headers=headers, timeout=15)
    response.raise_for_status()

    # Зберігаємо як UTF-8 HTML
    output_path.write_text(response.text, encoding=response.encoding or "utf-8")
    return output_path


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description=(
            "Завантажити HTML-сторінку Opendatabot для телефону у форматі 380XXXXXXXXX "
            "та зберегти її локально як <phone>.html."
        )
    )
    parser.add_argument(
        "phone",
        help='Номер телефону без "+", наприклад: 380938901865',
    )
    parser.add_argument(
        "--out-dir",
        help="Каталог для збереження файлу (за замовчуванням — поточна директорія).",
        default=None,
    )

    args = parser.parse_args()

    try:
        path = download_phone_page(args.phone, args.out_dir)
    except requests.HTTPError as http_err:
        print(f"HTTP помилка при завантаженні сторінки: {http_err}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"Помилка при завантаженні або збереженні файлу: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"HTML збережено до файлу: {path}")


if __name__ == "__main__":
    main()

