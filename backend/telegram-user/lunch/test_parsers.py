#!/usr/bin/env python3
"""Прості тести парсерів без Telegram/БД."""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.db import MenuItemRow, OrderLineInput
from lunch.ocr_menu import parse_menu_items_payload
from lunch.order_reply import PersonalOrderAction, decide_personal_order_action, ocr_enabled
from lunch.parse_order import looks_like_order, parse_order, parse_order_contextual
from lunch.parse_payment import looks_like_card_number, parse_payment
from lunch.parse_summary import (
    looks_like_day_summary,
    order_signature,
    parse_day_summary,
)
from lunch.util import compute_tray_count, guess_tray_role, normalize_dish_name, split_order_parts


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
    assert {ln.raw_name for ln in andrey.lines} == {
        "Салат «Капуста молода з огірком»",
        "Біфштекс з яйцем",
        "Печінкові оладки",
    }

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


def test_short_single_dish_order_not_dropped_as_noise():
    """Регрес: "Салат оригінальний" (2 слова, без роздільників) раніше
    мовчки ігнорувався looks_like_order (вимагав 3+ слів), навіть при
    reparse — людина лишалася без замовлення без жодного сліду в БД."""
    menu = _menu()
    assert looks_like_order("Салат оригінальний")
    r = parse_order_contextual("Салат оригінальний", menu)
    assert len(r.lines) == 1
    assert looks_like_order("Гречка")


def test_ocr_gate_silent_without_key():
    assert ocr_enabled(None) is False
    assert ocr_enabled("") is False
    assert ocr_enabled("   ") is False
    assert ocr_enabled("sk-test") is True


def test_order_reply_policy_closed_only_when_matched():
    # мем / чат з комами — heuristic looks_like_order може спрацювати,
    # але без matched lines мовчимо навіть якщо день closed
    assert (
        decide_personal_order_action(
            day_status="closed", matched_line_count=0, dish_qty_total=0
        )
        == PersonalOrderAction.IGNORE
    )
    assert (
        decide_personal_order_action(
            day_status="closed", matched_line_count=2, dish_qty_total=2
        )
        == PersonalOrderAction.DAY_CLOSED
    )
    assert (
        decide_personal_order_action(
            day_status="ordering", matched_line_count=2, dish_qty_total=2
        )
        == PersonalOrderAction.ACCEPT
    )
    assert (
        decide_personal_order_action(
            day_status="ordering", matched_line_count=0, dish_qty_total=0
        )
        == PersonalOrderAction.IGNORE
    )
    # mega dump
    assert (
        decide_personal_order_action(
            day_status="ordering", matched_line_count=20, dish_qty_total=20
        )
        == PersonalOrderAction.MEGA
    )


def test_closed_day_real_order_vs_meme_text():
    """Інтеграція parse + policy: реальний заказ → closed; «мем» → ignore."""
    dishes = [
        ("Салат «Капуста молода з огірком»", 40),
        ("Біфштекс з яйцем", 85),
        ("Печінкові оладки", 65),
    ]
    menu = [
        MenuItemRow(i, 1, n, normalize_dish_name(n), p)
        for i, (n, p) in enumerate(dishes, 1)
    ]
    order = parse_order("Капуста огурец, бифштекс с яйцом, печень оладьи", menu)
    assert len(order.lines) == 3
    assert (
        decide_personal_order_action(
            day_status="closed",
            matched_line_count=len(order.lines),
            dish_qty_total=sum(l.qty for l in order.lines),
        )
        == PersonalOrderAction.DAY_CLOSED
    )

    meme = parse_order("А запостіть сюди ще якихось картинок, мемів", menu)
    assert len(meme.lines) == 0
    assert (
        decide_personal_order_action(
            day_status="closed",
            matched_line_count=len(meme.lines),
            dish_qty_total=0,
        )
        == PersonalOrderAction.IGNORE
    )


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


def test_guess_tray_role():
    assert guess_tray_role("Суп грибний") == "soup"
    assert guess_tray_role("Борщ український") == "soup"
    assert guess_tray_role("Салат грецький") == "salad"
    assert guess_tray_role("Пюре") == "second"
    assert guess_tray_role("Котлети курячі") == "second"


def test_tray_count_rules():
    soup = OrderLineInput(1, "Суп", 1, 50, 50, tray_role="soup")
    salad = OrderLineInput(2, "Салат", 1, 40, 40, tray_role="salad")
    potato = OrderLineInput(3, "Пюре", 1, 40, 40, tray_role="second")
    meat = OrderLineInput(4, "Котлета", 1, 70, 70, tray_role="second")
    assert compute_tray_count([potato, meat]) == 1
    assert compute_tray_count([potato]) == 1
    assert compute_tray_count([meat]) == 1
    assert compute_tray_count([soup]) == 1
    assert compute_tray_count([soup, potato, meat]) == 2
    assert compute_tray_count([salad]) == 1  # єдина страва → мін. 1
    assert compute_tray_count([salad, salad]) == 0  # два салати без другого
    soup2 = OrderLineInput(1, "Суп", 2, 50, 100, tray_role="soup")
    assert compute_tray_count([soup2]) == 2


def test_synonym_match():
    menu = [
        MenuItemRow(
            1,
            1,
            "Овочі на грилі",
            normalize_dish_name("Овочі на грилі"),
            50,
            dish_id=1,
            synonym_norms=(normalize_dish_name("овощи на гриле"),),
        )
    ]
    r = parse_order("овощи на гриле", menu)
    assert len(r.lines) == 1
    assert r.lines[0].raw_name == "Овочі на грилі"


def test_fallback_silent_before_today_menu():
    yesterday = [
        MenuItemRow(1, 1, "Пюре", normalize_dish_name("Пюре"), 40, dish_id=10, tray_role="second")
    ]
    r = parse_order_contextual("Пюре", [], yesterday)
    assert len(r.lines) == 1
    assert r.unavailable == []


def test_unavailable_when_today_menu_exists():
    today = [
        MenuItemRow(2, 2, "Салат", normalize_dish_name("Салат"), 35, dish_id=20, tray_role="salad")
    ]
    yesterday = [
        MenuItemRow(1, 1, "Пюре", normalize_dish_name("Пюре"), 40, dish_id=10, tray_role="second")
    ]
    r = parse_order_contextual("Пюре, Салат", today, yesterday)
    assert [ln.raw_name for ln in r.lines] == ["Салат"]
    assert r.unavailable == ["Пюре"]


def test_collect_confirmation_reply_map():
    from lunch.reparse_day import collect_confirmation_reply_map

    class Msg:
        def __init__(self, mid, out, text, reply_to=None):
            self.id = mid
            self.out = out
            self.message = text
            self.text = text
            self.reply_to_msg_id = reply_to

    msgs = [
        Msg(10, False, "суп і салат"),
        Msg(11, True, "Імʼя, заказ: суп", 10),
        Msg(12, True, "Меню на сьогодні:\nсуп"),
        Msg(13, True, "Імʼя, заказ: салат (уточнення)", 10),
        Msg(14, True, "", 10),
    ]
    got = collect_confirmation_reply_map(msgs)
    assert got == {10: 13}


def _row(i, name, price=40, syn=(), role="second"):
    return MenuItemRow(
        i, 1, name, normalize_dish_name(name), price, dish_id=i, tray_role=role,
        synonym_norms=tuple(normalize_dish_name(x) for x in syn),
    )


def _salad_menu():
    return [
        _row(1, "Салат капуста з огірком", 35, role="salad"),
        _row(2, "Салат грецький", 60, role="salad"),
        _row(3, "Салат Цезар", 70, role="salad"),
        _row(4, "Пюре", 40),
    ]


def test_generic_word_salat_is_not_a_match():
    """Регрес 2026-10-02: «салат оливʼє» тихо ставав «Салат грецький» (спільне лише слово «салат»)."""
    menu = _salad_menu()
    for text in ("салат оливьє", "салат з крабовими паличками", "салат огірок помідор"):
        r = parse_order(text, menu)
        assert r.lines == [], (text, [ln.raw_name for ln in r.lines])
        assert r.unmatched == [text]


def test_bare_salat_is_ambiguous_when_several_salads():
    r = parse_order("салат", _salad_menu())
    assert r.lines == []
    assert r.unmatched == ["салат"]
    assert "салат" in r.ambiguous
    assert len(r.ambiguous["салат"]) >= 2


def test_bare_salat_matches_when_only_one_salad_on_menu():
    menu = [_row(2, "Салат грецький", 60, role="salad"), _row(4, "Пюре", 40)]
    r = parse_order("салат", menu)
    assert [ln.raw_name for ln in r.lines] == ["Салат грецький"]


def test_distinctive_word_still_matches_salad():
    menu = _salad_menu()
    assert parse_order("грецький", menu).lines[0].raw_name == "Салат грецький"
    assert parse_order("цезар", menu).lines[0].raw_name == "Салат Цезар"
    assert parse_order("грецкий салат", menu).lines[0].raw_name == "Салат грецький"
    assert parse_order("капуста огірок", menu).lines[0].raw_name == "Салат капуста з огірком"


def test_explicit_synonym_beats_fuzzy_neighbours():
    menu = [_row(1, "Салат капуста з огірком", 35), _row(2, "Салат грецький", 60, syn=("салат",))]
    r = parse_order("салат", menu)
    assert [ln.raw_name for ln in r.lines] == ["Салат грецький"]
    assert r.ambiguous == {}


def test_same_synonym_on_two_dishes_is_ambiguous_not_first_in_menu():
    menu = [
        _row(1, "Салат капуста з огірком", 35, syn=("салат грецький",)),
        _row(2, "Салат грецький шеф", 60, syn=("салат грецький",)),
    ]
    r = parse_order("салат грецький", menu)
    assert r.lines == []
    assert set(r.ambiguous["салат грецький"]) == {"Салат капуста з огірком", "Салат грецький шеф"}


def test_near_duplicate_dishes_flag_ambiguity():
    menu = [_row(1, "Філе курки з ананасом", 95), _row(2, "Філе курки запечене", 90)]
    r = parse_order("філе курки", menu)
    assert r.lines == []
    assert "філе курки" in r.ambiguous
    # а повна назва — однозначна
    assert parse_order("філе курки з ананасом", menu).lines[0].raw_name == "Філе курки з ананасом"


def test_ambiguous_part_is_not_reported_as_unavailable_today():
    today = _salad_menu()
    yesterday = [_row(9, "Салат Олів'є", 50, role="salad")]
    r = parse_order_contextual("салат, пюре", today, yesterday)
    assert [ln.raw_name for ln in r.lines] == ["Пюре"]
    assert r.unavailable == []
    assert r.unmatched == ["салат"]
    assert "салат" in r.ambiguous


def test_word_endings_and_ru_spelling_still_match():
    menu = [_row(1, "Котлети курячі", 75), _row(2, "Вареники з картоплею", 60), _row(3, "Салат капуста з огірком", 35)]
    assert parse_order("котлеты", menu).lines[0].raw_name == "Котлети курячі"
    assert parse_order("вареники с картошкой", menu).lines[0].raw_name == "Вареники з картоплею"
    assert parse_order("салат капуста с огурцом", menu).lines[0].raw_name == "Салат капуста з огірком"


def test_exact_dish_name_beats_synonym_of_other_dish():
    menu = [_row(1, "Салат", 30, role="salad"), _row(2, "Салат грецький", 60, syn=("салат",), role="salad")]
    r = parse_order("салат", menu)
    assert [ln.raw_name for ln in r.lines] == ["Салат"]


def test_synonym_owner_is_newest_row():
    from lunch.db import resolve_synonym_owners

    rows = [(1, 10, "салат оливе"), (2, 20, "салат оливе"), (3, 10, "пюре")]
    assert resolve_synonym_owners(rows) == {"салат оливе": 20, "пюре": 10}
    assert resolve_synonym_owners([]) == {}


def test_exact_word_beats_other_word_form():
    """«курка» — це «Курка відварена», а не «Філе курки з ананасом» (інша форма того ж слова слабша)."""
    menu = [_row(1, "Курка відварена", 70), _row(2, "Філе курки з ананасом", 95), _row(3, "Пюре", 40)]
    assert parse_order("курка", menu).lines[0].raw_name == "Курка відварена"
    assert parse_order("філе курки", menu).lines[0].raw_name == "Філе курки з ананасом"
    assert parse_order("курка відварена", menu).lines[0].raw_name == "Курка відварена"


def test_synonym_owner_prefers_dish_whose_name_matches_over_newer_poison():
    """Прод 2026-10-02: хибні автосиноніми (#371, #342) були НОВІШІ за правильні (#64, #75)."""
    from lunch.db import resolve_synonym_owners

    names = {
        41: normalize_dish_name("Салат «Грецький»"),
        42: normalize_dish_name("Салат «Капуста з огірком»"),
        45: normalize_dish_name("Салат «Овочевий мікс»"),
    }
    rows = [
        (64, 41, normalize_dish_name("салат грецький")),
        (75, 42, normalize_dish_name("салат з капусти")),
        (342, 45, normalize_dish_name("салат з капусти")),
        (371, 45, normalize_dish_name("салат грецький")),
    ]
    owners = resolve_synonym_owners(rows, names)
    assert owners[normalize_dish_name("салат грецький")] == 41
    assert owners[normalize_dish_name("салат з капусти")] == 42
    # без назв поведінка стара: виграє найновіший запис
    assert resolve_synonym_owners(rows)[normalize_dish_name("салат грецький")] == 45


def test_synonym_owner_equally_similar_names_fall_back_to_newest():
    from lunch.db import resolve_synonym_owners

    names = {
        42: normalize_dish_name("Салат «Капуста з огірком»"),
        43: normalize_dish_name("Салат «Капуста молода з огірком»"),
    }
    text = normalize_dish_name("капуста з огірком")
    assert resolve_synonym_owners([(26, 42, text), (183, 43, text)], names)[text] == 43


def test_confirm_text_explains_ambiguity():
    from lunch.formatters import format_order_confirm

    r = parse_order("пюре, салат", _salad_menu())
    text = format_order_confirm("Аліна", r.lines, r.total_uah, r.unmatched, ambiguous=r.ambiguous)
    assert "Не розпізнав: салат" in text
    assert "«салат» — це " in text and " чи " in text


def _canteen_menu():
    """Шматок реального меню (вересень 2026) — для правил, знайдених на золотих даних."""
    return [
        _row(1, "Гречка", 35),
        _row(2, "Пюре", 45),
        _row(3, "Хліб", 3),
        _row(4, "Голубці ліниві", 90),
        _row(5, "Біфштекс з яйцем", 90, syn=("бифштекс",)),
        _row(6, "Філе риби смажене в яйці", 80, syn=("філе",)),  # шкідливий синонім з проду
        _row(7, "Філе курки «Пікантне»", 90),
        _row(8, "Салат «Капуста молода з огірком»", 40, role="salad", syn=("салат капуста огірок",)),
        _row(9, "Печінка смажена з цибулею", 65, syn=("печінка смажена",)),
        _row(10, "Деруни", 50),
        _row(11, "Перець фарширований", 90),
        _row(12, "Салат «Крабово-овочевий»", 50, role="salad"),
        _row(13, "Сирники", 45),
        _row(14, "Вареники з картоплею", 70),
        _row(15, "Котлети курячі", 70),
    ]


def _dishes(r):
    return sorted((ln.raw_name, ln.qty) for ln in r.lines)


def test_quantity_in_text():
    """Золоті дані: «2 хліба», «хліб 2», «Хліб 4 шт», «Голубці ліниві 2 порції», «бифштекс 4 штуки» — раніше ×1."""
    menu = _canteen_menu()
    assert _dishes(parse_order("Солянка, 2 хліба, гречка", menu)) == [("Гречка", 1), ("Хліб", 2)]
    assert _dishes(parse_order("хліб 2", menu)) == [("Хліб", 2)]
    assert _dishes(parse_order("Хліб 4 шт", menu)) == [("Хліб", 4)]
    assert _dishes(parse_order("Голубці ліниві 2 порції", menu)) == [("Голубці ліниві", 2)]
    assert _dishes(parse_order("Голубці  2 порції", menu)) == [("Голубці ліниві", 2)]
    assert _dishes(parse_order("бифштекс  с яйцом 4 штуки", menu)) == [("Біфштекс з яйцем", 4)]
    assert _dishes(parse_order("котлети х2, x2 пюре, сирники ×2", menu)) == [
        ("Котлети курячі", 2), ("Пюре", 2), ("Сирники", 2)]
    r = parse_order("Хліб 4 шт", menu)
    assert r.total_uah == 12 and r.lines[0].line_total_uah == 12
    # номер пункту списку — не кількість
    assert _dishes(parse_order("3.гречка", menu)) == [("Гречка", 1)]


def test_conjunction_splits_only_into_distinct_dishes():
    """«гречка і філе…» губило гречку; але «і»/«та» бувають і всередині назви."""
    menu = _canteen_menu()
    assert _dishes(parse_order("Пюре і перець фарширований", menu)) == [("Перець фарширований", 1), ("Пюре", 1)]
    assert _dishes(parse_order("гречка + котлети", menu)) == [("Гречка", 1), ("Котлети курячі", 1)]
    # «цибулею» — хвіст «Печінка смажена з цибулею», а не друга страва
    assert _dishes(parse_order("Вареники з картоплею і цибулею", menu)) == [("Вареники з картоплею", 1)]
    # випадковий подвійний пробіл усередині однієї назви — одна страва, не дві
    assert _dishes(parse_order("філе  риби смажене в яйці", menu)) == [("Філе риби смажене в яйці", 1)]


def test_text_without_separators_is_segmented_by_menu():
    menu = _canteen_menu()
    r = parse_order("Печінка смажена салат капуста огірок деруни", menu)
    assert _dishes(r) == [("Деруни", 1), ("Печінка смажена з цибулею", 1), ("Салат «Капуста молода з огірком»", 1)]
    assert r.unmatched == []
    # «сирний» ≈ «Сирники» — не привід різати назву салату, якого сьогодні немає
    r = parse_order("салат крабово сирний", menu)
    assert r.lines == [] and r.unmatched == ["салат крабово сирний"]


def test_negated_parts_are_not_orders():
    """Оголошення оператора й заміни: «Дерунов нету» бот записав як замовлення дерунів."""
    menu = _canteen_menu()
    for text in ("Дерунов нету", "Небуде 1 голубців, замініть будь ласка", "Крабовий закінчився замініть будь ласка",
                 "Одного бифштекса не будет, меняйте заказ"):
        assert parse_order(text, menu).lines == [], text
    r = parse_order("Замість пюре , перець фарширований", menu)
    assert _dishes(r) == [("Перець фарширований", 1)]
    r = parse_order("Не розумію\nНемає зеленого борща і вареників з картоплею\nА я замовила пюре і деруни", menu)
    assert _dishes(r) == [("Деруни", 1), ("Пюре", 1)]


def test_payment_link_and_mention_are_not_reported_as_unrecognized():
    menu = _canteen_menu()
    r = parse_order("Голубці ліниві 2 порції\n\nhttps://check.monobank.ua/p/XXXX", menu)
    assert _dishes(r) == [("Голубці ліниві", 2)] and r.unmatched == []
    r = parse_order("@operator\nПюре, деруни", menu)
    assert _dishes(r) == [("Деруни", 1), ("Пюре", 1)] and r.unmatched == []


def test_short_synonym_does_not_swallow_longer_dish():
    """«філе» (синонім риби) ⊂ «філе курки з помідором»; курки з помідором того дня немає — питати, не вгадувати."""
    menu = _canteen_menu()
    r = parse_order("гречка, філе курки з помідором", menu)
    assert _dishes(r) == [("Гречка", 1)]
    assert r.unmatched == ["філе курки з помідором"]
    # інший варіант страви («Пікантне») теж не підставляємо
    assert all(ln.raw_name != "Філе курки «Пікантне»" for ln in r.lines)
    # а «салат крабовий» при єдиному крабовому салаті — збіг
    assert _dishes(parse_order("Салат крабовий", menu)) == [("Салат «Крабово-овочевий»", 1)]


def test_ru_cooking_words():
    menu = [_row(1, "Печінка смажена з цибулею", 65), _row(2, "Картопля тушкована з грибами", 45),
            _row(3, "Салат «Крабово-овочевий»", 50, role="salad"), _row(4, "Курка відварна", 75),
            _row(5, "Голубці ліниві", 90), _row(6, "Салат «Крабово-сирний»", 50, role="salad")]
    assert _dishes(parse_order("печенка жаренная", menu)) == [("Печінка смажена з цибулею", 1)]
    assert _dishes(parse_order("картопля тушенная", menu)) == [("Картопля тушкована з грибами", 1)]
    assert _dishes(parse_order("Салат крабово овощной", menu)) == [("Салат «Крабово-овочевий»", 1)]
    assert _dishes(parse_order("курица варенная", menu)) == [("Курка відварна", 1)]
    assert _dishes(parse_order("голубцы ленивые", menu)) == [("Голубці ліниві", 1)]


def test_mega_counts_distinct_dishes_not_portions():
    assert (
        decide_personal_order_action(day_status="ordering", matched_line_count=3, dish_qty_total=7)
        == PersonalOrderAction.ACCEPT
    )
    assert (
        decide_personal_order_action(day_status="ordering", matched_line_count=6, dish_qty_total=6)
        == PersonalOrderAction.MEGA
    )
    # кілька людей з однаковими стравами — дамп, хоч різних страв мало
    assert (
        decide_personal_order_action(day_status="ordering", matched_line_count=3, dish_qty_total=11)
        == PersonalOrderAction.MEGA
    )


def main():
    tests = [
        test_normalize,
        test_split,
        test_order_lilia,
        test_order_diana,
        test_order_marta,
        test_ru_typos_andrey_and_valeria,
        test_chat_noise,
        test_ocr_gate_silent_without_key,
        test_order_reply_policy_closed_only_when_matched,
        test_closed_day_real_order_vs_meme_text,
        test_payment,
        test_card,
        test_ocr_payload,
        test_summary_detect,
        test_summary_parse_sviatoslav,
        test_summary_no_blank_lines_in_last,
        test_summary_dozazak_extra,
        test_guess_tray_role,
        test_tray_count_rules,
        test_synonym_match,
        test_fallback_silent_before_today_menu,
        test_unavailable_when_today_menu_exists,
        test_collect_confirmation_reply_map,
        test_generic_word_salat_is_not_a_match,
        test_bare_salat_is_ambiguous_when_several_salads,
        test_bare_salat_matches_when_only_one_salad_on_menu,
        test_distinctive_word_still_matches_salad,
        test_explicit_synonym_beats_fuzzy_neighbours,
        test_same_synonym_on_two_dishes_is_ambiguous_not_first_in_menu,
        test_near_duplicate_dishes_flag_ambiguity,
        test_ambiguous_part_is_not_reported_as_unavailable_today,
        test_word_endings_and_ru_spelling_still_match,
        test_exact_dish_name_beats_synonym_of_other_dish,
        test_synonym_owner_is_newest_row,
        test_exact_word_beats_other_word_form,
        test_synonym_owner_prefers_dish_whose_name_matches_over_newer_poison,
        test_synonym_owner_equally_similar_names_fall_back_to_newest,
        test_confirm_text_explains_ambiguity,
        test_quantity_in_text,
        test_conjunction_splits_only_into_distinct_dishes,
        test_text_without_separators_is_segmented_by_menu,
        test_negated_parts_are_not_orders,
        test_payment_link_and_mention_are_not_reported_as_unrecognized,
        test_short_synonym_does_not_swallow_longer_dish,
        test_ru_cooking_words,
        test_mega_counts_distinct_dishes_not_portions,
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
