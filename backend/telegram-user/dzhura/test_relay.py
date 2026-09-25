#!/usr/bin/env python3
"""Прості тести форматувальника Джури без Telegram/БД. Запуск: python3 -m dzhura.test_relay"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from dzhura.relay import (  # noqa: E402
    clip_raw_json,
    display_name,
    format_message_relay,
    format_reaction_relay,
    html_escape,
    media_label,
    message_link,
    naive_utc,
    person_link_html,
    plan_reaction_changes,
    reaction_key,
    reaction_label,
    reactions_counts,
    truncate,
)


def test_display_name_priority():
    assert display_name("Костя", "Іванов", "kostya", 1) == "Костя Іванов"
    assert display_name(None, None, "kostya", 1) == "@kostya"
    assert display_name("", " ", None, 42) == "42"
    assert display_name(None, None, None, None) == "Невідомий"


def test_person_link_prefers_username():
    html = person_link_html("Костя", None, "kostya", 1)
    assert html == '<a href="https://t.me/kostya">Костя</a> (@kostya)', html
    html2 = person_link_html("Оля <3", None, None, 77)
    assert html2 == '<a href="tg://user?id=77">Оля &lt;3</a>', html2
    assert person_link_html(None, None, None, None) == "Невідомий"


def test_message_link_only_for_supergroups():
    assert message_link("supergroup", -1001234567890, 55) == "https://t.me/c/1234567890/55"
    assert message_link("group", -5427750954, 55) is None
    assert message_link("private", 438099, 55) is None
    assert message_link("supergroup", 123, 55) is None


def test_media_label():
    assert media_label(None) == ""
    assert media_label("photo") == "[фото]"
    assert media_label("document", "звіт.pdf") == "[файл: звіт.pdf]"
    assert media_label("document") == "[файл]"
    assert media_label("weird") == "[медіа]"


def test_reaction_key_and_label():
    assert reaction_key("emoji", "❤️") == "❤️"
    assert reaction_key("custom", 5368) == "custom:5368"
    assert reaction_key("paid") == "paid"
    assert reaction_label("❤️") == "❤️"
    assert reaction_label("custom:5368") == "кастомну реакцію"
    assert reaction_label("paid").startswith("⭐")


def test_truncate_and_escape():
    assert truncate("  a \n\n b  ") == "a b"
    long = "х" * 200
    t = truncate(long, 10)
    assert len(t) == 10 and t.endswith("…"), t
    assert html_escape("<b> & 'q'") == "&lt;b&gt; &amp; 'q'"


def test_reactions_counts_drop_zero():
    assert reactions_counts([("❤️", 2, False), ("👍", 0, False), ("🔥", 1, True)]) == {"❤️": 2, "🔥": 1}


def test_plan_adds_recent_authors_in_group():
    to_add, to_close = plan_reaction_changes(
        active=[],
        recent=[(10, "❤️", False, None), (11, "👍", False, None)],
        results=[("❤️", 1, False), ("👍", 1, False)],
        private_other_id=None,
        me_id=1,
    )
    assert to_close == []
    assert [(a["person_tg_id"], a["emoji"], a["is_mine"]) for a in to_add] == [(10, "❤️", False), (11, "👍", False)]


def test_plan_is_idempotent_for_known_rows():
    to_add, to_close = plan_reaction_changes(
        active=[(1, 10, "❤️")],
        recent=[(10, "❤️", False, None)],
        results=[("❤️", 1, False)],
        private_other_id=None,
        me_id=1,
    )
    assert to_add == [] and to_close == []


def test_plan_closes_when_emoji_disappears():
    to_add, to_close = plan_reaction_changes(
        active=[(1, 10, "❤️"), (2, 11, "👍")],
        recent=[(11, "👍", False, None)],
        results=[("👍", 1, False)],
        private_other_id=None,
        me_id=1,
    )
    assert to_add == [] and to_close == [1]


def test_plan_closes_surplus_anonymous_first():
    # Було 3 ❤️ (одна анонімна), стало 2 → закриваємо анонімну.
    to_add, to_close = plan_reaction_changes(
        active=[(1, 10, "❤️"), (2, None, "❤️"), (3, 11, "❤️")],
        recent=[(10, "❤️", False, None), (11, "❤️", False, None)],
        results=[("❤️", 2, False)],
        private_other_id=None,
        me_id=1,
    )
    assert to_add == [] and to_close == [2]


def test_plan_private_chat_infers_author():
    # Приватний чат без recent_reactions: chosen → я, решта → співрозмовник.
    to_add, to_close = plan_reaction_changes(
        active=[],
        recent=[],
        results=[("❤️", 2, True), ("👍", 1, False)],
        private_other_id=777,
        me_id=1,
    )
    assert to_close == []
    got = sorted((a["person_tg_id"], a["emoji"], a["is_mine"]) for a in to_add)
    assert got == [(1, "❤️", True), (777, "❤️", False), (777, "👍", False)], got


def test_plan_big_group_anonymous_placeholder():
    to_add, to_close = plan_reaction_changes(
        active=[],
        recent=[],
        results=[("🔥", 3, False)],
        private_other_id=None,
        me_id=1,
    )
    assert to_close == []
    assert len(to_add) == 3 and all(a["person_tg_id"] is None for a in to_add)


def test_plan_mine_from_chosen_without_recent():
    to_add, _ = plan_reaction_changes(
        active=[],
        recent=[],
        results=[("❤️", 1, True)],
        private_other_id=None,
        me_id=1,
    )
    assert to_add == [{"person_tg_id": 1, "emoji": "❤️", "is_mine": True, "date": None}], to_add


def test_format_message_relay_text():
    out = format_message_relay(
        "Адмін <чат>",
        '<a href="https://t.me/k">Костя</a> (@k)',
        1234,
        "Привіт & бувай",
        reply_preview="Довге  батьківське\nповідомлення",
    )
    assert out.split("\n") == [
        '<b>Адмін &lt;чат&gt;</b> · <a href="https://t.me/k">Костя</a> (@k) · #1234',
        "Привіт &amp; бувай",
        "↩︎ у відповідь на: «Довге батьківське повідомлення»",
    ], out


def test_format_message_relay_media_and_link():
    out = format_message_relay(
        "Чат",
        "Костя",
        7,
        "",
        media_kind="photo",
        link="https://t.me/c/1/7",
        forward_from="Оля",
    )
    lines = out.split("\n")
    assert lines[0] == '<b>Чат</b> · Костя · <a href="https://t.me/c/1/7">#7</a>', lines[0]
    assert lines[1] == "↪︎ переслано від Оля"
    assert lines[2] == "[фото]"
    assert len(lines) == 3


def test_format_reaction_relay_variants():
    own = format_reaction_relay("Чат", "Костя", "❤️", "мій текст", own=True)
    assert own == "<b>Чат</b> · Костя: реакція ❤️ на ваше повідомлення «мій текст»", own
    other = format_reaction_relay("Чат", "Костя", "custom:5", "текст Олі", author_html="Оля")
    assert other == "<b>Чат</b> · Костя: реакція кастомну реакцію на повідомлення Оля «текст Олі»", other
    anon = format_reaction_relay("Чат", "Хтось", "🔥", None, link="https://t.me/c/1/2")
    assert anon == '<b>Чат</b> · Хтось: реакція 🔥 на повідомлення <a href="https://t.me/c/1/2">↗</a>', anon


def test_naive_utc():
    aware = datetime(2026, 9, 25, 12, 0, tzinfo=timezone(timedelta(hours=3)))
    assert naive_utc(aware) == datetime(2026, 9, 25, 9, 0)
    naive = datetime(2026, 9, 25, 9, 0)
    assert naive_utc(naive) is naive
    assert naive_utc(None) is None


def test_clip_raw_json():
    assert clip_raw_json(None) is None
    assert clip_raw_json('{"a":1}') == '{"a":1}'
    big = "x" * 9000
    clipped = clip_raw_json(big)
    assert clipped is not None and clipped.startswith('{"_truncated": true')


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK   {t.__name__}")
        except AssertionError as e:
            failed += 1
            print(f"  FAIL {t.__name__}: {e}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL {t.__name__}: {type(e).__name__}: {e}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
