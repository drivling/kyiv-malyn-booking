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

import json
import re

from lunch.golden_eval import load_golden, run_cases, summarize
from lunch.golden_from_dzhura import build_draft
from lunch.golden_from_history import convert
from lunch.parse_order import looks_like_order, parse_order

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
# 23 дні з меню, 26.08–02.10.2026: замовлення з історії + повідомлення групи з «Джури», перевірені вручну
BIG = GOLDEN_DIR / "2026-08-26_2026-10-02.jsonl"
# Відомі промахи, з якими миримось: людина побачить «не розпізнав» і уточнить (хибної страви немає)
KNOWN_MISSES = {
    "2026-09-30#o529",  # «Салат і а пуста огірки» — автозаміна «капуста»
}


def test_2026_10_02_all_orders_exact():
    """9 замовлень за 2026-10-02 (перевірені вручну, точне меню на 35 позицій) мають розпізнаватись без помилок."""
    menus, cases = load_golden(GOLDEN_DIR / "2026-10-02.jsonl")
    assert len(cases) == 9 and all(c.gold for c in cases)
    verdicts = run_cases(menus, cases, parse_order)
    bad = [(v.case.id, v.case.text, v.wrong, v.missed, v.unmatched) for v in verdicts if not v.exact]
    assert not bad, bad
    assert summarize(verdicts)["exact"] == 9


def test_big_golden_set_no_wrong_dish_no_false_order():
    """Повний шлях слухача (looks_like_order → parse_order) на ~200 перевірених кейсах з поточними синонімами:
    жодної хибної страви, жоден чат/оголошення не стає замовленням, точно все, крім відомих промахів."""
    menus, cases = load_golden(BIG)
    assert len(cases) >= 200 and len(menus) >= 20
    verdicts = run_cases(menus, cases, parse_order, gate=looks_like_order)
    stats = summarize(verdicts)
    wrong = [(v.case.id, v.case.text, v.wrong) for v in verdicts if v.wrong]
    assert not wrong, wrong
    assert stats["negatives"] >= 30 and stats["false_orders"] == 0
    misses = {v.case.id for v in verdicts if not v.exact}
    assert misses <= KNOWN_MISSES, sorted(misses - KNOWN_MISSES)


def test_big_golden_set_without_synonyms_never_invents_a_dish():
    """Без жодного синоніма матчер може чогось не знайти, але не має підставляти чужу страву."""
    menus, cases = load_golden(BIG, synonyms=False)
    verdicts = run_cases(menus, cases, parse_order, gate=looks_like_order)
    wrong = [(v.case.id, v.case.text, v.wrong) for v in verdicts if v.wrong]
    assert not wrong, wrong
    assert summarize(verdicts)["false_orders"] == 0
    assert summarize(verdicts)["exact_pct"] >= 95


def test_big_golden_set_is_consistent_and_anonymous():
    rows = [json.loads(ln) for ln in BIG.read_text(encoding="utf-8").splitlines() if ln.strip()]
    menus = {r["key"]: {it["name"] for it in r["items"]} for r in rows if r["type"] == "menu"}
    cases = [r for r in rows if r["type"] == "case"]
    assert len({c["id"] for c in cases}) == len(cases)
    for c in cases:
        assert c["menu"] in menus, c["id"]
        assert set(c["expected"]) <= menus[c["menu"]], (c["id"], set(c["expected"]) - menus[c["menu"]])
        assert c["source"] in {"admin", "review", "corrected"}, c["id"]
        if c["source"] == "corrected" and c["expected"]:
            assert c.get("note"), f"{c['id']}: виправлене очікування без пояснення"
        # знеособлено: без чеків, номерів карток і @нікнеймів (лише заглушки)
        assert not re.search(r"monobank\.ua/p/(?!X+\b)", c["text"]), c["id"]
        assert not re.search(r"\d{12,}", c["text"]), c["id"]
        assert not re.search(r"@(?!operator\b)\w", c["text"]), c["id"]


def test_dzhura_draft_joins_messages_bot_replies_and_orders():
    history = {"days": [{
        "date": "2026-09-24",
        "menu": [{"dishId": 10, "name": "Голубці ліниві", "priceUah": 90, "trayRole": "second", "synonyms": []},
                 {"dishId": 3, "name": "Хліб", "priceUah": 3, "trayRole": "second", "synonyms": []}],
        "orders": [
            {"id": 504, "rawText": "Голубці ліниві 2 порції", "unmatchedText": None, "trayCountManual": False,
             "touchedAfterCreate": True, "lines": [{"name": "Голубці ліниві", "qty": 2, "unavailable": False}]},
        ],
    }]}
    msg = lambda mid, t, text, **kw: {"tgMessageId": mid, "sentAt": t, "text": text, "isOutgoing": False,  # noqa: E731
                                      "replyToTgMessageId": None, "editedAt": None, "deletedAt": None, **kw}
    export = {"messages": [
        msg("1", "2026-09-24T06:50:00.000Z", "Голубці ліниві 2 порції\nhttps://check.monobank.ua/p/abc", editedAt="x"),
        msg("2", "2026-09-24T06:50:05.000Z", "Імʼя, заказ:\n• ×2 Голубці ліниві — 180 грн (90/шт)\nРазом: 185 грн",
            isOutgoing=True, replyToTgMessageId="1"),
        msg("3", "2026-09-24T07:00:00.000Z", "Хліб"),                       # загублене замовлення
        msg("4", "2026-09-24T07:10:00.000Z", "Иду в столовую, кидайте деньги"),  # чат
        msg("5", "2026-09-24T07:11:00.000Z", "оплатив 185"),               # оплата — не кейс
        msg("6", "2026-09-25T07:00:00.000Z", "Хліб"),                       # дня без меню немає в історії
    ]}
    rows = build_draft(history, export)
    assert [r["type"] for r in rows].count("menu") == 1
    cases = {r["id"]: r for r in rows if r["type"] == "case"}
    assert set(cases) == {"2026-09-24#m1", "2026-09-24#m3", "2026-09-24#m4", "2026-09-24#o504"}
    # бот відповів, але текст після редагування не збігся з БД: очікування — з відповіді бота
    assert cases["2026-09-24#m1"]["expected"] == ["Голубці ліниві", "Голубці ліниві"]
    assert cases["2026-09-24#m1"]["source"] == "bot-reply"
    # текст з БД (до редагування) окремим кейсом, з рядками замовлення
    assert cases["2026-09-24#o504"]["source"] == "history-touched"
    assert cases["2026-09-24#m3"]["expected"] == ["Хліб"] and cases["2026-09-24#m3"]["source"] == "unrecorded"
    assert cases["2026-09-24#m4"]["expected"] == [] and cases["2026-09-24#m4"]["review"]
    assert all(c["gold"] is False for c in cases.values())


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
    tests = [
        test_2026_10_02_all_orders_exact,
        test_big_golden_set_no_wrong_dish_no_false_order,
        test_big_golden_set_without_synonyms_never_invents_a_dish,
        test_big_golden_set_is_consistent_and_anonymous,
        test_dzhura_draft_joins_messages_bot_replies_and_orders,
        test_history_converter_keeps_only_trustworthy_cases,
    ]
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
