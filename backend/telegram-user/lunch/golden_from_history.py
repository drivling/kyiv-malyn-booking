"""Перетворює відповідь GET /admin/lunch/history на золоті кейси для `lunch.golden_eval`.

  curl -H "Authorization: admin-authenticated" "$API/admin/lunch/history?from=2026-09-01&to=2026-10-02" > history.json
  python3 -m lunch.golden_from_history history.json lunch/golden/history.jsonl
  python3 -m lunch.golden_eval lunch/golden/history.jsonl --baseline e73f2c5

Що вважаємо золотом, а що ні (історія — це підсумкові рядки замовлень, не істина сама по собі):
  * `gold` — замовлення міняли вже після створення (ручна правка адміна, ручні лотки): рядки перевірила людина;
  * решта — «срібло»: автоматичний результат, який ніхто не виправляв. У ньому можуть бути старі помилки
    розпізнавання, тож розбіжності з ним — це список для перегляду, а не автоматичний вирок.
Пропускаємо замовлення з нерозпізнаним текстом або стравами, яких не було в меню (рядки неповні).
Дні без меню пропускаємо: без точного меню оцінка недостовірна.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def convert(history: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for day in history.get("days", []):
        menu = day.get("menu") or []
        if not menu:
            continue
        key = day["date"]
        out.append(
            {
                "type": "menu",
                "key": key,
                "items": [
                    {
                        "dish_id": m["dishId"],
                        "name": m["name"],
                        "price": m.get("priceUah", 0),
                        "role": m.get("trayRole", "second"),
                        "synonyms": m.get("synonyms", []),
                    }
                    for m in menu
                ],
            }
        )
        for o in day.get("orders", []):
            text = (o.get("rawText") or "").strip()
            lines = o.get("lines") or []
            if not text or not lines or o.get("unmatchedText") or any(l.get("unavailable") for l in lines):
                continue
            expected: list[str] = []
            for l in lines:
                expected.extend([l["name"]] * int(l.get("qty") or 1))
            gold = bool(o.get("touchedAfterCreate") or o.get("trayCountManual"))
            out.append(
                {
                    "type": "case",
                    "id": f"{key}#{o['id']}",
                    "menu": key,
                    "text": text,
                    "expected": expected,
                    "gold": gold,
                    "source": "history-touched" if gold else "history-auto",
                }
            )
    return out


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 2:
        print(__doc__)
        return 2
    history = json.loads(Path(args[0]).read_text(encoding="utf-8"))
    rows = convert(history)
    Path(args[1]).write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    cases = [r for r in rows if r["type"] == "case"]
    print(f"днів з меню: {sum(r['type'] == 'menu' for r in rows)}, кейсів: {len(cases)}, з них gold: {sum(c['gold'] for c in cases)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
