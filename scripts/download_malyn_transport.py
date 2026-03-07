#!/usr/bin/env python3
"""
Завантаження набору даних "Розклад руху громадського транспорту міста Малина"
з порталу data.gov.ua

Dataset ID: f28ed264-8576-457d-a518-2b637a3c8d36
Джерело: https://data.gov.ua/dataset/f28ed264-8576-457d-a518-2b637a3c8d36
"""

import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Потрібно встановити requests: pip install requests")
    sys.exit(1)

DATASET_ID = "f28ed264-8576-457d-a518-2b637a3c8d36"
API_URL = "https://data.gov.ua/api/3/action/package_show"
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "data" / "malyn-transport"
TIMEOUT = 30

HEADERS = {
    "User-Agent": "kyiv-malyn-booking/1.0 (data download script)",
    "Accept": "application/json",
}


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print("Отримання метаданих набору даних з data.gov.ua...")
    try:
        r = requests.get(
            API_URL,
            params={"id": DATASET_ID},
            headers=HEADERS,
            timeout=TIMEOUT,
        )
        r.raise_for_status()
    except requests.RequestException as e:
        print(f"Помилка запиту: {e}")
        print("\nРучне завантаження:")
        print(f"  1. Відкрийте: https://data.gov.ua/dataset/{DATASET_ID}")
        print("  2. У розділі 'Дані та ресурси' натисніть 'Завантажити'")
        print(f"  3. Збережіть файл у: {OUTPUT_DIR}")
        sys.exit(1)

    data = r.json()
    if not data.get("success"):
        print("API повернув помилку:", data)
        sys.exit(1)

    resources = data.get("result", {}).get("resources", [])
    if not resources:
        print("Набір даних не містить ресурсів для завантаження")
        sys.exit(1)

    # Беремо останній (найновіший) ресурс
    resource = resources[-1]
    url = resource.get("url")
    name = resource.get("name", "resource")
    fmt = resource.get("format", "").upper()

    if not url:
        print("Ресурс не містить URL")
        sys.exit(1)

    # Визначаємо ім'я файлу
    filename = resource.get("url", "").split("/")[-1]
    if not filename or "?" in filename:
        ext = "xlsx" if "XLS" in fmt or "EXCEL" in fmt else "csv" if "CSV" in fmt else "json"
        filename = f"{name}.{ext}".replace(" ", "_")

    output_path = OUTPUT_DIR / filename
    print(f"Завантаження: {url}")
    print(f"Збереження у: {output_path}")

    try:
        r = requests.get(url, headers=HEADERS, timeout=TIMEOUT, stream=True)
        r.raise_for_status()
        with open(output_path, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
    except requests.RequestException as e:
        print(f"Помилка завантаження: {e}")
        sys.exit(1)

    # Зберігаємо метадані
    meta_path = OUTPUT_DIR / "metadata.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "dataset_id": DATASET_ID,
                "title": data.get("result", {}).get("title", ""),
                "resources": [
                    {"name": r.get("name"), "format": r.get("format"), "url": r.get("url")}
                    for r in resources
                ],
                "downloaded_file": filename,
            },
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(f"\nГотово! Завантажено: {output_path}")
    print(f"Розмір: {output_path.stat().st_size} байт")


if __name__ == "__main__":
    main()
