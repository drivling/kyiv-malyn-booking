#!/usr/bin/env python3
"""Прості тести парсерів без Telegram/БД."""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.db import MenuItemRow
from lunch.ocr_menu import parse_menu_items_payload
from lunch.parse_order import looks_like_order, parse_order
from lunch.parse_payment import looks_like_card_number, parse_payment
from lunch.parse_summary import (
    looks_like_day_summary,
    order_signature,
    parse_day_summary,
)
from lunch.util import normalize_dish_name, split_order_parts


EXAMPLE_SUMMARY = """> Диана:
рис з овочами
філе курки з ананасом 
салат молода капуста з огірком

> Дар'я Шулдик:
суп грибний з гречкою

> Marta:
пюре, голубці ліниві

> Evgeniia:
Рис з овочами

> Альона:
Курка відварена, салат грецький

> Valeria:
Суп грибной 
Вареники с картошкой 
Салат капуста с огурцом

> Диана:
рис з овочами
філе курки з ананасом 
салат молода капуста з огірком

> Святослав:
Пюре
Філе курки запечене з ананасом

рис з овочами
філе курки з ананасом 
салат молода капуста з огірком

суп грибний з гречкою

пюре, голубці ліниві

Рис з овочами

Курка відварена, салат грецький

Суп грибной 
Вареники с картошкой 
Салат капуста с огурцом

рис з овочами
філе курки з ананасом 
салат молода капуста з огірком
"""


def _menu():
    dishes = [
        ("Пюре", 40),
        ("Котлети курячі", 75),
        ("Буряк з фета", 45),
        ("Філе курки з ананасом", 95),
        ("Салат капуста з огірком", 35),
        ("Овочі на грилі", 50),
        ("Рис з овочами", 40),
        ("М'ясо тушковане з баклажанами", 90),
        ("Суп грибний", 55),
        ("Биток Киевский", 80),
        ("Салат грецький", 60),
        ("Сирники", 50),
    ]
    rows = []
    for i, (name, price) in enumerate(dishes, start=1):
        rows.append(
            MenuItemRow(
                id=i,
                day_id=1,
                name=name,
                name_norm=normalize_dish_name(name),
                price_uah=price,
            )
        )
    return rows


def test_normalize():
    assert "мясо" in normalize_dish_name("Мʼясо тушковане")
    assert normalize_dish_name("Салат грецький") == normalize_dish_name("салат грецкий")


def test_split():
    parts = split_order_parts("Пюре | Котлети курячі | Буряк з фета")
    assert len(parts) == 3
    parts2 = split_order_parts("пюре, голубці ліниві")
    assert len(parts2) == 2


def test_order_lilia():
    menu = _menu()
    r = parse_order("Пюре | Котлети курячі | Буряк з фета", menu)
    assert r.ok
    assert r.total_uah == 40 + 75 + 45


def test_order_diana():
    menu = _menu()
    r = parse_order(
        "філе курки з ананасом, салат капуста з огірком, овочі на грилі, рис з овочами",
        menu,
    )
    assert len(r.unmatched) == 0
    assert r.total_uah == 95 + 35 + 50 + 40


def test_order_marta():
    menu = _menu()
    r = parse_order("м'ясо тушковане з баклажанами, овочі на грилі", menu)
    assert len(r.lines) >= 1
    assert r.total_uah >= 90


def test_ru_typos_andrey_and_valeria():
    """Реальні кейси: рос. написання + два блюда без коми через подвійний пробіл."""
    dishes = [
        ("Салат «Капуста молода з огірком»", 40),
        ("Овочі на грилі", 50),
        ("Салат «Грецький»", 45),
        ("Биток Київський", 90),
        ("Суп грибний з гречкою", 85),
        ("Біфштекс з яйцем", 85),
        ("Печінкові оладки", 65),
    ]
    menu = [
        MenuItemRow(i, 1, n, normalize_dish_name(n), p)
        for i, (n, p) in enumerate(dishes, 1)
    ]
    andrey = parse_order("Капуста огурец, бифштекс с яйцом  печень оладьи", menu)
    assert andrey.total_uah == 40 + 85 + 65
    assert andrey.unmatched == []

    valeria = parse_order(
        "Салат грецкий \nБиток Киевский \nОвощи на гриле \nСуп грибной",
        menu,
    )
    assert valeria.total_uah == 45 + 90 + 50 + 85
    assert valeria.unmatched == []


def test_chat_noise():
    assert not looks_like_order("Бегом бегом")
    assert not looks_like_order("Даша 😁😁😁")
    assert looks_like_order("Пюре | Котлети курячі")


def test_payment():
    assert parse_payment("оплатив 150").amount_uah == 150
    assert parse_payment("Оплатила 90 грн").amount_uah == 90
    assert parse_payment("Оплата 175").amount_uah == 175
    assert parse_payment("оплата: 175").amount_uah == 175
    assert parse_payment("175 оплата").amount_uah == 175
    assert parse_payment("!pay 200").amount_uah == 200
    assert parse_payment("перевів 120").amount_uah == 120
    assert parse_payment("привіт") is None


def test_card():
    assert looks_like_card_number("4441111159888704") == "4441111159888704"
    assert looks_like_card_number("hello") is None


def test_ocr_payload():
    items = parse_menu_items_payload(
        {"items": [{"name": "Борщ", "price": 50}, {"name": "Хліб", "price": "10"}]}
    )
    assert items == [("Борщ", 50), ("Хліб", 10)]


def test_summary_detect():
    assert looks_like_day_summary(EXAMPLE_SUMMARY)
    assert not looks_like_day_summary("Пюре | Котлети")
    assert not looks_like_order(EXAMPLE_SUMMARY)


def test_summary_parse_sviatoslav():
    p = parse_day_summary(EXAMPLE_SUMMARY)
    assert p.ok
    names = [n.display_name for n in p.named]
    assert "Святослав" in names
    assert "Marta" in names
    assert names.count("Диана") == 2
    sv = [n for n in p.named if n.display_name == "Святослав"][0]
    assert "Пюре" in sv.raw_text
    assert "Філе курки запечене з ананасом" in sv.raw_text
    assert "Вареники" not in sv.raw_text
    assert "суп грибний" not in sv.raw_text.lower()
    assert p.dozazak_raw is None


def test_summary_no_blank_lines_in_last():
    """Дамп без порожніх рядків після замовлення Святослава — не повинен весь потрапити йому."""
    text = """> Marta:
пюре, голубці ліниві

> Диана:
рис з овочами
філе курки з ананасом

> Святослав:
Пюре
Філе курки запечене з ананасом
рис з овочами
філе курки з ананасом
пюре, голубці ліниві
"""
    p = parse_day_summary(text)
    assert p.ok
    sv = [n for n in p.named if n.display_name == "Святослав"][0]
    assert "Вареники" not in sv.raw_text
    sig = order_signature(sv.raw_text)
    assert len(sig) <= 5
    assert "пюре" in sig or any("пюре" in x for x in sig)


def test_summary_dozazak_extra():
    text = """> Marta:
пюре, голубці ліниві

> Святослав:
Пюре
Котлети

борщ
салат грецький
"""
    p = parse_day_summary(text)
    assert p.ok
    sv = [n for n in p.named if n.display_name == "Святослав"][0]
    assert order_signature(sv.raw_text) == order_signature("Пюре\nКотлети")
    assert p.dozazak_raw is not None
    assert "борщ" in p.dozazak_raw.lower() or "салат" in p.dozazak_raw.lower()


def main():
    tests = [
        test_normalize,
        test_split,
        test_order_lilia,
        test_order_diana,
        test_order_marta,
        test_ru_typos_andrey_and_valeria,
        test_chat_noise,
        test_payment,
        test_card,
        test_ocr_payload,
        test_summary_detect,
        test_summary_parse_sviatoslav,
        test_summary_no_blank_lines_in_last,
        test_summary_dozazak_extra,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK  {t.__name__}")
        except Exception as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
