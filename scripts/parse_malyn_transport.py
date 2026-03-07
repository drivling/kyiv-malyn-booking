#!/usr/bin/env python3
"""
Парсинг розкладу громадського транспорту Малина з XLSX.
Створює спільний JSON-файл для подальшого аналізу.
"""

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Optional

NS = {
    "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def get_shared_strings(zip_file: zipfile.ZipFile) -> list[str]:
    """Витягти shared strings з xlsx."""
    try:
        data = zip_file.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(data)
    strings = []
    for si in root.findall("main:si", NS):
        t = si.find("main:t", NS)
        if t is not None and t.text is not None:
            strings.append(t.text)
        else:
            parts = []
            for r in si.findall("main:r", NS):
                pt = r.find("main:t", NS)
                parts.append(pt.text if pt is not None and pt.text else "")
            strings.append("".join(parts))
    return strings


def col_index_to_letter(col: int) -> str:
    """Конвертувати індекс колонки в букву (0->A, 25->Z, 26->AA)."""
    result = ""
    while col >= 0:
        result = chr(col % 26 + 65) + result
        col = col // 26 - 1
    return result


def parse_cell_ref(ref: str) -> tuple[int, int]:
    """Парсинг посилання клітинки, напр. A1 -> (0, 0)."""
    m = re.match(r"^([A-Z]+)(\d+)$", ref)
    if not m:
        return 0, 0
    col_str, row_str = m.groups()
    col = 0
    for c in col_str:
        col = col * 26 + (ord(c) - 64)
    return col - 1, int(row_str) - 1


def _get_cell_value(cell_elem, strings: list[str]) -> Any:
    """Отримати значення клітинки (v може бути в атрибуті або дочірньому елементі)."""
    v_elem = cell_elem.find("main:v", NS)
    v = cell_elem.get("v") or (v_elem.text if v_elem is not None else None)
    t = cell_elem.get("t")
    if t == "s" and v is not None:
        idx = int(v)
        return strings[idx] if idx < len(strings) else v
    if v is not None:
        try:
            return float(v) if "." in str(v) else int(v)
        except (ValueError, TypeError):
            return v
    return ""


def parse_sheet(zip_file: zipfile.ZipFile, strings: list[str]) -> list[list[Any]]:
    """Парсинг аркуша в двовимірний масив."""
    data = zip_file.read("xl/worksheets/sheet1.xml")
    root = ET.fromstring(data)
    if root.find(".//main:sheetData", NS) is None:
        return []

    # Збираємо клітинки за координатами
    cells: dict[tuple[int, int], Any] = {}
    for row in root.findall(".//main:row", NS):
        r = int(row.get("r", 0))
        for c in row.findall("main:c", NS):
            ref = c.get("r", "")
            col, row_idx = parse_cell_ref(ref) if ref else (0, r)
            cells[(col, row_idx)] = _get_cell_value(c, strings)

    if not cells:
        return []

    max_row = max(r for _, r in cells.keys())
    max_col = max(c for c, _ in cells.keys())
    result = []
    for r in range(max_row + 1):
        row = []
        for c in range(max_col + 1):
            row.append(cells.get((c, r), ""))
        result.append(row)
    return result


def normalize_value(v: Any) -> Any:
    """Нормалізація значення для JSON."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v if v == int(v) else round(v, 2)
    return str(v).strip() if v else None


def infer_headers(rows: list[list]) -> tuple[list[str], list[list], Optional[dict[str, str]]]:
    """Визначити заголовки. Повертає (headers, data_rows, uk_headers)."""
    if not rows:
        return [], [], None
    # Рядок 0 — англійські GTFS-подібні заголовки
    headers = [str(h).strip() or f"col_{i}" for i, h in enumerate(rows[0])]
    # Рядок 1 — українські назви (опційно)
    uk_headers = None
    if len(rows) > 1 and any(rows[1]):
        uk_headers = {headers[i]: str(rows[1][i]).strip() for i in range(min(len(headers), len(rows[1]))) if rows[1][i]}
    data_rows = rows[2:]  # Дані з рядка 2
    return headers, data_rows, uk_headers


def rows_to_dicts(headers: list[str], rows: list[list]) -> list[dict]:
    """Конвертувати рядки в список словників."""
    result = []
    for row in rows:
        if not any(v for v in row):
            continue
        d = {}
        for i, h in enumerate(headers):
            if i < len(row):
                v = normalize_value(row[i])
                if v is not None:
                    d[h] = v
        if d:
            result.append(d)
    return result


def main():
    base = Path(__file__).resolve().parent.parent
    xlsx_path = base / "data" / "malyn-transport" / "perelik-reisiv-24.xlsx"
    out_dir = base / "data" / "malyn-transport"

    if not xlsx_path.exists():
        print(f"Файл не знайдено: {xlsx_path}")
        return 1

    print("Парсинг XLSX...")
    with zipfile.ZipFile(xlsx_path, "r") as z:
        strings = get_shared_strings(z)
        rows = parse_sheet(z, strings)

    print(f"Прочитано {len(rows)} рядків, {len(rows[0]) if rows else 0} колонок")

    # Очистити порожні рядки в кінці
    while rows and not any(rows[-1]):
        rows.pop()

    headers, data_rows, uk_headers = infer_headers(rows)
    print(f"Заголовки: {headers}")

    records = rows_to_dicts(headers, data_rows)
    print(f"Записано {len(records)} записів")

    # Підсумок для аналізу
    route_ids = sorted(set(r.get("route_id") for r in records if r.get("route_id")))
    trips_by_route = {}
    for r in records:
        rid = r.get("route_id")
        if rid:
            trips_by_route[rid] = trips_by_route.get(rid, 0) + 1
    headsigns = sorted(set(r.get("trip_headsign") for r in records if r.get("trip_headsign")))

    # Доповнення з malyn.media
    supplement_path = out_dir / "malyn_media_supplement.json"
    supplement = {}
    if supplement_path.exists():
        with open(supplement_path, "r", encoding="utf-8") as f:
            supplement = json.load(f)

    output = {
        "source": "data.gov.ua",
        "dataset": "Розклад руху громадського транспорту міста Малина",
        "file": "perelik-reisiv-24.xlsx",
        "headers": headers,
        "headers_uk": uk_headers,
        "records": records,
        "supplement": supplement,
        "stats": {
            "total_rows": len(records),
            "columns": len(headers),
            "routes_count": len(route_ids),
            "route_ids": route_ids,
            "trips_per_route": trips_by_route,
            "headsigns": headsigns,
        },
    }

    out_path = out_dir / "malyn_transport_unified.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Збережено: {out_path}")

    # Копіювати в frontend/public для сторінки /localtransport
    frontend_data = base / "frontend" / "public" / "data"
    frontend_data.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy(out_path, frontend_data / "malyn_transport.json")
    print(f"Оновлено frontend: {frontend_data / 'malyn_transport.json'}")

    # Додатково CSV для зручного аналізу (utf-8-sig = BOM для Excel)
    csv_path = out_dir / "malyn_transport_unified.csv"
    if records and headers:
        import csv
        with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(records)
        print(f"CSV: {csv_path}")

    return 0


if __name__ == "__main__":
    exit(main())
