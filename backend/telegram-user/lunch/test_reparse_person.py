#!/usr/bin/env python3
"""Тести розбору однієї людини та плану повідомлення — без Telegram і без БД (фейки в пам'яті).

  cd backend/telegram-user && python3 -m lunch.test_reparse_person
"""

from __future__ import annotations

import asyncio
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.db import DayRow, MenuItemRow, OrderLineInput, today_kyiv
from lunch.reparse_day import (
    DayContext,
    ReparseStats,
    kyiv_day_bounds,
    plan_text_message,
    process_text_message,
)
from lunch.catch_up import catch_up_today
from lunch.reparse_person import reparse_person
from lunch.util import normalize_dish_name

GROUP = -100
UID = 777


def _row(i: int, name: str, price: int = 40, role: str = "second") -> MenuItemRow:
    return MenuItemRow(i, 1, name, normalize_dish_name(name), price, dish_id=i, tray_role=role)


MENU = [
    _row(1, "Пюре", 40),
    _row(2, "Котлети курячі", 75),
    _row(3, "Салат грецький", 60, "salad"),
    _row(4, "Салат Цезар", 70, "salad"),
    _row(5, "Суп грибний", 55, "soup"),
]


class FakeDB:
    """Мінімальна заміна LunchDB: лише методи, які чіпають reparse_person / process_text_message."""

    def __init__(self, menu=None, fallback=None, status="ordering"):
        self.menu = list(MENU if menu is None else menu)
        self.fallback = list(fallback or [])
        self.status = status
        self.participants: dict[str, dict[str, Any]] = {}
        self.orders: dict[int, dict[str, Any]] = {}
        self.payments: list[dict[str, Any]] = []
        self.outbound: list[dict[str, Any]] = []
        self.dzhura: list[dict[str, Any]] = []
        self.dzhura_error: Optional[str] = None
        self.cards: list[str] = []
        self.cancelled: set[int] = set()
        self.no_day = False
        self.payee_card: Optional[str] = None

    async def get_or_create_day(self, d=None):
        return DayRow(id=1, date=d or today_kyiv(), status=self.status, menu_message_id=None, payee_card=None)

    async def get_day(self, d=None):
        return None if self.no_day else DayRow(
            id=1, date=d or today_kyiv(), status=self.status, menu_message_id=None, payee_card=self.payee_card
        )

    async def has_order(self, day_id, pid):
        return pid in self.orders or pid in self.cancelled

    async def get_day_status(self, day_id):
        return self.status

    async def list_menu_items(self, day_id):
        return self.menu

    async def get_fallback_menu(self, day_id):
        return self.fallback

    async def find_participant_id_by_telegram_id(self, uid):
        p = self.participants.get(str(uid))
        return p["id"] if p else None

    async def get_participant_name(self, pid):
        for p in self.participants.values():
            if p["id"] == pid:
                return p["name"]
        return None

    async def upsert_participant(self, uid, name, username=None):
        p = self.participants.setdefault(str(uid), {"id": len(self.participants) + 1})
        p.update(name=name, username=username)
        return p["id"]

    async def has_active_order(self, day_id, pid):
        return pid in self.orders

    async def get_tray_price(self):
        return 5

    async def apply_trays_to_lines(self, lines):
        food = sum(l.line_total_uah for l in lines)
        trays = 1 if lines else 0
        return trays, trays * 5, food + trays * 5

    async def upsert_order(self, day_id, pid, raw_text, total, lines, source_message_id=None, unmatched_text=None, **kw):
        self.orders[pid] = {
            "raw": raw_text,
            "lines": [l.raw_name for l in lines],
            "unmatched": unmatched_text,
            "source": source_message_id,
        }
        return pid

    async def enqueue_outbound(self, text, *, kind="send", telegram_message_id=None, reply_to_message_id=None, target="lunch"):
        self.outbound.append({"text": text, "reply_to": reply_to_message_id})

    async def payment_source_exists(self, day_id, source_message_id):
        return any(p["source"] == source_message_id for p in self.payments)

    async def add_payment(self, day_id, pid, amount, raw, source_message_id=None):
        self.payments.append({"pid": pid, "amount": amount, "source": source_message_id})
        return len(self.payments)

    async def set_payee_card(self, day_id, card):
        self.cards.append(card)

    async def dzhura_sender_messages(self, tg_chat_id, tg_user_id, start_utc, end_utc):
        if self.dzhura_error:
            raise RuntimeError(self.dzhura_error)
        return [m for m in self.dzhura if m["uid"] == tg_user_id]


@dataclass
class FakeSender:
    first_name: str = "Аліна"
    last_name: Optional[str] = None
    username: Optional[str] = "alina"


class FakeMsg:
    def __init__(self, mid, text, when, sender_id=UID, photo=False):
        self.out = False
        self.id = mid
        self.message = text
        self.text = text
        self.date = when
        self.sender_id = sender_id
        self.photo = photo

    async def get_sender(self):
        return FakeSender()


class FakeClient:
    def __init__(self, messages, fail=None):
        self.messages = messages
        self.fail = fail

    async def iter_messages(self, entity, limit=None):
        if self.fail:
            raise RuntimeError(self.fail)
        for m in sorted(self.messages, key=lambda x: x.date, reverse=True)[:limit]:
            yield m


def _today_at(hour: int, minute: int = 0) -> datetime:
    start, _ = kyiv_day_bounds(today_kyiv())
    return (start + timedelta(hours=hour, minutes=minute)).astimezone(timezone.utc)


def run(coro):
    return asyncio.run(coro)


# ---------- plan_text_message ----------


def _plan(text, **kw):
    args = dict(uid="1", menu=MENU, fallback=[], day_closed=False, allow_orders_when_closed=False)
    args.update(kw)
    return plan_text_message(text, **args)


def test_plan_kinds_and_reasons():
    assert _plan("Пюре, котлети курячі").kind == "order"
    assert _plan("Аліна, заказ:\n• Пюре", is_own=True).kind == "echo"
    assert _plan("оплатив 150").kind == "payment"
    assert _plan("оплатив 150", uid="").kind == "no_sender"
    assert _plan("дякую всім").kind == "not_order"
    assert _plan("Пюре", day_closed=True).kind == "closed"
    assert _plan("Пюре", day_closed=True, allow_orders_when_closed=True).kind == "order"
    assert _plan("Пюре", menu=[], fallback=[]).kind == "no_menu"
    p = _plan("квасоля стручкова")
    assert p.kind == "no_match" and "жодна страва" in p.reason
    p = _plan("салат")
    assert p.kind == "no_match" and "неоднозначно" in p.reason


# ---------- reparse_person ----------


def test_foreign_message_starting_with_zakaz_is_an_order_not_bot_echo():
    """Регрес: чуже «Заказ: …» у розборі дня вважалось ехом бота й губилось."""
    text = "Заказ: пюре, котлети курячі"
    assert _plan(text).kind == "order"
    assert _plan(text, is_own=True).kind == "echo"
    db = FakeDB()
    stats = ReparseStats()
    run(process_text_message(db, day_id=1, text=text, uid="5", name="Діана", username=None,
                             message_id=7, allow_orders_when_closed=True, stats=stats, ctx=DayContext(), is_own=False))
    assert stats.orders == 1 and stats.skipped == 0


def test_person_own_bot_replies_are_ignored_for_the_owner():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "Аліна, заказ:\n• Пюре — 40 грн\nРазом: 45 грн", _today_at(10, 36)),
    ])
    for m in client.messages:
        m.out = True
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["orders"] == 1
    assert [d["messageId"] for d in out["details"]] == [11]


def test_person_first_ignored_order_is_found_and_confirmed():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(10, "привіт всім", _today_at(10, 0)),
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "Чужий", _today_at(10, 37), sender_id=999),
    ])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["orders"] == 1
    assert out["person"]["name"] == "Аліна"
    pid = db.participants[str(UID)]["id"]
    assert db.orders[pid]["lines"] == ["Пюре", "Котлети курячі"]
    assert db.orders[pid]["source"] == 11
    assert len(db.outbound) == 1 and db.outbound[0]["reply_to"] == 11
    assert "Аліна, заказ:" in db.outbound[0]["text"]
    assert [d["messageId"] for d in out["details"]] == [10, 11]
    assert out["details"][0]["outcome"] == "skipped" and out["details"][1]["outcome"] == "order"


def test_person_does_not_touch_other_people():
    db = FakeDB()
    other = run(db.upsert_participant("555", "Інший"))
    run(db.upsert_order(1, other, "Пюре", 40, [OrderLineInput(1, "Пюре", 1, 40, 40)]))
    client = FakeClient([FakeMsg(11, "Котлети курячі", _today_at(10, 36))])
    run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert db.orders[other]["lines"] == ["Пюре"]


def test_person_unmatched_text_becomes_visible_placeholder():
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "квасоля стручкова з яйцем", _today_at(10, 36))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    pid = db.participants[str(UID)]["id"]
    assert out["placeholder"] is True
    assert db.orders[pid]["lines"] == []
    assert db.orders[pid]["unmatched"] == "квасоля стручкова з яйцем"
    assert db.outbound == []  # без «не розпізнав» у чат — адмін виправляє вручну


def test_person_placeholder_collects_all_unmatched_messages():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(10, "мені як завжди", _today_at(10, 30)),
        FakeMsg(11, "квасоля стручкова", _today_at(10, 36)),
    ])
    run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    pid = db.participants[str(UID)]["id"]
    assert db.orders[pid]["unmatched"] == "мені як завжди; квасоля стручкова"
    assert db.orders[pid]["source"] == 11


def test_person_unmatched_does_not_overwrite_existing_order():
    db = FakeDB()
    pid = run(db.upsert_participant(str(UID), "Аліна"))
    run(db.upsert_order(1, pid, "з підсумку", 40, [OrderLineInput(1, "Пюре", 1, 40, 40)]))
    client = FakeClient([FakeMsg(11, "квасоля стручкова", _today_at(10, 36))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert db.orders[pid]["lines"] == ["Пюре"]
    assert out["placeholder"] is False


def test_person_works_when_day_is_closed():
    db = FakeDB(status="closed")
    client = FakeClient([FakeMsg(11, "Пюре", _today_at(12, 0))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["orders"] == 1


def test_person_last_order_wins_and_payment_not_duplicated():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "Котлети курячі", _today_at(10, 40)),
        FakeMsg(13, "оплатив 130", _today_at(13, 0)),
    ])
    run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    pid = db.participants[str(UID)]["id"]
    assert db.orders[pid]["lines"] == ["Котлети курячі"]
    assert len(db.payments) == 1  # другий прохід оплату не дублює
    assert out["payments"] == 0


def test_person_falls_back_to_dzhura_when_telegram_fails():
    db = FakeDB()
    db.dzhura = [
        {"uid": UID, "id": 21, "text": "Салат Цезар", "date": _today_at(10, 50), "edited": False,
         "deleted": False, "media": None, "first_name": "Аліна", "last_name": None, "username": "alina"},
        {"uid": UID, "id": 22, "text": "Пюре", "date": _today_at(10, 51), "edited": False,
         "deleted": True, "media": None, "first_name": "Аліна", "last_name": None, "username": "alina"},
    ]
    client = FakeClient([], fail="FloodWait 30")
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    pid = db.participants[str(UID)]["id"]
    assert out["source"] == "dzhura"
    assert any("Telegram недоступний" in w for w in out["warnings"])
    assert db.orders[pid]["lines"] == ["Салат Цезар"]  # видалене повідомлення не враховано


def test_person_nothing_found_reports_error_and_changes_nothing():
    db = FakeDB()
    client = FakeClient([FakeMsg(10, "дякую всім", _today_at(10, 0)), FakeMsg(11, "!зведення", _today_at(10, 1))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["orders"] == 0 and out["errors"]
    assert db.orders == {} and str(UID) not in db.participants


def test_person_no_notify_option():
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре", _today_at(10, 36))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID, notify=False))
    assert out["orders"] == 1 and db.outbound == [] and out["notified"] is False


def test_person_ambiguous_salad_is_reported_not_guessed():
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре, салат", _today_at(10, 36))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    pid = db.participants[str(UID)]["id"]
    assert db.orders[pid]["lines"] == ["Пюре"]
    assert db.orders[pid]["unmatched"] == "салат"
    assert "це Салат" in db.outbound[0]["text"]


# ---------- process_text_message (розбір дня) пише причини пропусків ----------


def test_day_reparse_records_reason_for_ignored_order():
    db = FakeDB()
    stats = ReparseStats()
    ctx = DayContext()
    run(process_text_message(db, day_id=1, text="квасоля стручкова", uid="5", name="Діана", username=None,
                             message_id=7, allow_orders_when_closed=True, stats=stats, ctx=ctx))
    run(process_text_message(db, day_id=1, text="Аліна, заказ:\n• Пюре", uid="5", name="Бот", username=None,
                             message_id=8, allow_orders_when_closed=True, stats=stats, ctx=ctx, is_own=True))
    run(process_text_message(db, day_id=1, text="Пюре", uid="5", name="Діана", username=None,
                             message_id=9, allow_orders_when_closed=True, stats=stats, ctx=ctx))
    assert stats.skipped == 2 and stats.orders == 1
    assert [d["messageId"] for d in stats.details] == [7, 9]  # ехо бота не засмічує звіт
    assert stats.details[0]["outcome"] == "skipped"
    assert "жодна страва" in stats.details[0]["reason"]


# ---------- catch_up_today ----------


def _now_at(hour: int, minute: int = 0) -> datetime:
    return _today_at(hour, minute)


def test_catch_up_creates_order_for_person_without_one_and_confirms():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "дякую", _today_at(10, 37), sender_id=999),
    ])
    out = run(catch_up_today(client, object(), db, now=_now_at(10, 40)))
    pid = db.participants[str(UID)]["id"]
    assert out["orders"] == 1 and db.orders[pid]["lines"] == ["Пюре", "Котлети курячі"]
    assert db.outbound and db.outbound[0]["reply_to"] == 11


def test_catch_up_never_overwrites_existing_or_cancelled_order():
    db = FakeDB()
    pid = run(db.upsert_participant(str(UID), "Аліна"))
    run(db.upsert_order(1, pid, "ручна правка", 40, [OrderLineInput(1, "Пюре", 1, 40, 40)]))
    client = FakeClient([FakeMsg(11, "Котлети курячі", _today_at(10, 36))])
    out = run(catch_up_today(client, object(), db, now=_now_at(10, 40)))
    assert out["orders"] == 0 and db.orders[pid]["lines"] == ["Пюре"]

    db2 = FakeDB()
    pid2 = run(db2.upsert_participant(str(UID), "Аліна"))
    db2.cancelled.add(pid2)  # адмін натиснув «Прибрати»
    out = run(catch_up_today(client, object(), db2, now=_now_at(10, 40)))
    assert out["orders"] == 0 and pid2 not in db2.orders


def test_catch_up_skips_closed_day_missing_day_and_missing_menu():
    client = FakeClient([FakeMsg(11, "Пюре", _today_at(10, 36))])
    closed = FakeDB(status="closed")
    assert run(catch_up_today(client, object(), closed, now=_now_at(10, 40)))["skipped_reason"] == "день закрито"
    nodday = FakeDB()
    nodday.no_day = True
    assert run(catch_up_today(client, object(), nodday, now=_now_at(10, 40)))["skipped_reason"] == "немає дня"
    nomenu = FakeDB(menu=[])
    assert run(catch_up_today(client, object(), nomenu, now=_now_at(10, 40)))["skipped_reason"] == "немає меню"
    assert closed.orders == {} and nodday.orders == {} and nomenu.orders == {}


def test_catch_up_window_ignores_old_messages():
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре", _today_at(7, 0))])
    out = run(catch_up_today(client, object(), db, now=_now_at(14, 0)))  # вікно — останні 3 год
    assert out["orders"] == 0 and out["scanned"] == 0


def test_catch_up_payment_not_duplicated_and_bot_echo_ignored():
    db = FakeDB()
    echo = FakeMsg(13, "Аліна, заказ:\n• Пюре — 40 грн", _today_at(10, 40))
    echo.out = True
    client = FakeClient([FakeMsg(12, "оплатив 45", _today_at(10, 38)), echo])
    out1 = run(catch_up_today(client, object(), db, now=_now_at(10, 45)))
    out2 = run(catch_up_today(client, object(), db, now=_now_at(10, 50)))
    assert out1["payments"] == 1 and out2["payments"] == 0
    assert len(db.payments) == 1 and db.orders == {}


def test_catch_up_ambiguous_text_is_not_guessed():
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "салат", _today_at(10, 36))])
    out = run(catch_up_today(client, object(), db, now=_now_at(10, 40)))
    assert out["orders"] == 0 and db.orders == {}


def main():
    tests = [
        test_plan_kinds_and_reasons,
        test_foreign_message_starting_with_zakaz_is_an_order_not_bot_echo,
        test_person_own_bot_replies_are_ignored_for_the_owner,
        test_person_first_ignored_order_is_found_and_confirmed,
        test_person_does_not_touch_other_people,
        test_person_unmatched_text_becomes_visible_placeholder,
        test_person_placeholder_collects_all_unmatched_messages,
        test_person_unmatched_does_not_overwrite_existing_order,
        test_person_works_when_day_is_closed,
        test_person_last_order_wins_and_payment_not_duplicated,
        test_person_falls_back_to_dzhura_when_telegram_fails,
        test_person_nothing_found_reports_error_and_changes_nothing,
        test_person_no_notify_option,
        test_person_ambiguous_salad_is_reported_not_guessed,
        test_day_reparse_records_reason_for_ignored_order,
        test_catch_up_creates_order_for_person_without_one_and_confirms,
        test_catch_up_never_overwrites_existing_or_cancelled_order,
        test_catch_up_skips_closed_day_missing_day_and_missing_menu,
        test_catch_up_window_ignores_old_messages,
        test_catch_up_payment_not_duplicated_and_bot_echo_ignored,
        test_catch_up_ambiguous_text_is_not_guessed,
    ]
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  OK  {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            import traceback

            traceback.print_exc()
            print(f"  FAIL {t.__name__}: {e}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
