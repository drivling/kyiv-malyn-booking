from __future__ import annotations

import json
import sys
from http.client import IncompleteRead
from typing import Any, Dict
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BASE_URL = "https://phonecheck.top/phone/"
NOT_FOUND_PHRASE = "Данные не найдены"


def fetch_phone_page(phone: str) -> str:
    """
    Завантажити HTML-сторінку phonecheck.top для конкретного телефону.
    """
    url = f"{BASE_URL}{phone}"
    req = Request(url, headers={"User-Agent": "kyiv-malyn-booking/phonecheck"})
    with urlopen(req, timeout=15) as resp:  # type: ignore[arg-type]
        charset = resp.headers.get_content_charset() or "utf-8"
        try:
            raw = resp.read()
        except IncompleteRead as exc:
            # Використовуємо вже отриману частину HTML — для пошуку "Данные не найдены" цього достатньо.
            raw = exc.partial or b""
        return raw.decode(charset, errors="replace")


def run_lookup(phone: str) -> Dict[str, Any]:
    """
    Повертає JSON-об'єкт з результатом перевірки:
    - phone: номер телефону
    - url: повний URL сторінки
    - has_data: True, якщо відповідь не містить "Данные не найдены"
    - html: повний HTML (тільки якщо has_data=True)
    """
    html = fetch_phone_page(phone)
    has_data = NOT_FOUND_PHRASE not in html
    return {
        "phone": phone,
        "url": f"{BASE_URL}{phone}",
        "has_data": has_data,
        "html": html if has_data else None,
    }


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: run_phonecheck_lookup.py 380XXXXXXXXX", file=sys.stderr)
        sys.exit(1)

    phone = sys.argv[1].strip()
    if not phone:
        print("Phone is required", file=sys.stderr)
        sys.exit(1)

    try:
        payload = run_lookup(phone)
    except (HTTPError, URLError) as exc:
        print(f"HTTP error: {exc}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:  # noqa: BLE001
        print(f"Unexpected error: {exc}", file=sys.stderr)
        sys.exit(1)

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()

