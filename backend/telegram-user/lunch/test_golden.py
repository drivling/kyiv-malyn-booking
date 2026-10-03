#!/usr/bin/env python3
"""Регресійні тести на золотих даних (без мережі й БД).

  cd backend/telegram-user && python3 -m lunch.test_golden
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.golden_eval import load_golden, run_cases, summarize
from lunch.golden_from_history import convert
from lunch.parse_order import parse_order

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"


def test_2026_10_02_all_orders_exact():
    """9 замовлень за 2026-10-02 (перевірені вручну, точне меню на 35 позицій) мають розпізнаватись без помилок."""
    menus, cases = load_golden(GOLDEN_DIR / "2026-10-02.jsonl")
    assert len(cases) == 9 and all(c.gold for c in cases)
    verdicts = run_cases(menus, cases, parse_order)
    bad = [(v.case.id, v.case.text, v.wrong, v.missed, v.unmatched) for v in verdicts if not v.exact]
    assert not bad, bad
    assert summarize(verdicts)["exact"] == 9


def test_history_converter_keeps_only_trustworthy_cases():
    history = {
        "days": [
            {"date": "2026-09-30", "menu": [], "orders": [{"id": 1, "rawText": "пюре", "lines": [{"name": "Пюре", "qty": 1}]}]},
            {
                "date": "2026-10-01",
                "menu": [{"dishId": 36, "name": "Пюре", "priceUah": 45, "trayRole": "second", "synonyms": ["картопляне пюре"]}],
                "orders": [
                    {"id": 10, "rawText": "пюре", "unmatchedText": None, "trayCountManual": False, "touchedAfterCreate": False,
                     "lines": [{"name": "Пюре", "qty": 1, "unavailable": False}]},
                    {"id": 11, "rawText": "пюре ×2", "unmatchedText": None, "trayCountManual": True, "touchedAfterCreate": False,
                     "lines": [{"name": "Пюре", "qty": 2, "unavailable": False}]},
                    {"id": 12, "rawText": "пюре і щось", "unmatchedText": "щось", "lines": [{"name": "Пюре", "qty": 1}]},
                    {"id": 13, "rawText": "котлети", "unmatchedText": None, "lines": [{"name": "Котлети", "qty": 1, "unavailable": True}]},
                    {"id": 14, "rawText": "   ", "lines": [{"name": "Пюре", "qty": 1}]},
                ],
            },
        ]
    }
    rows = convert(history)
    assert [r["type"] for r in rows] == ["menu", "case", "case"]  # день без меню, неповні й порожні — пропущено
    assert rows[0]["items"][0]["synonyms"] == ["картопляне пюре"]
    auto, touched = rows[1], rows[2]
    assert (auto["id"], auto["gold"], auto["source"]) == ("2026-10-01#10", False, "history-auto")
    assert (touched["gold"], touched["expected"]) == (True, ["Пюре", "Пюре"])


def main():
    tests = [test_2026_10_02_all_orders_exact, test_history_converter_keeps_only_trustworthy_cases]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK  {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
