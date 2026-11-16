#!/usr/bin/env python3
"""Тести розбору однієї людини та плану повідомлення — без Telegram і без БД (фейки в пам'яті).

  cd backend/telegram-user && python3 -m lunch.test_reparse_person
"""

from __future__ import annotations

import asyncio
import sys
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import lunch.evidence as evidence
from lunch.db import DayRow, MenuItemRow, OrderLineInput, today_kyiv
from lunch.evidence import compare_day, media_of
from lunch.formatters import format_debts, format_order_confirm
from lunch.ocr_menu import MediaScan, scan_from_raw
from lunch.reparse_day import (
    reparse_day_with_client,
    DayContext,
    ReparseStats,
    kyiv_day_bounds,
    plan_text_message,
    process_text_message,
)
from lunch.catch_up import catch_up_today, resolve_incomplete_orders
from lunch.listener import edit_or_reply
from lunch.parse_summary import parse_numbered_summary
from lunch.reparse_person import reparse_person
from lunch.summary_owner import attribute_summary_leftover, find_unexplained_entries
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
        self.scans: dict[int, dict[str, Any]] = {}
        self.cash: set[int] = set()

    async def get_or_create_day(self, d=None):
        return DayRow(id=1, date=d or today_kyiv(), status=self.status, menu_message_id=None, payee_card=None)

    async def clear_day_orders_and_payments(self, day_id):
        self.orders.clear()
        self.payments.clear()

    async def set_day_status(self, day_id, status):
        self.status = status

    async def set_reply_ids_by_source(self, day_id, mapping):
        return 0

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

    async def apply_trays_to_lines(self, lines, tray_count_override=None):
        food = sum(l.line_total_uah for l in lines if not l.unavailable)
        trays = tray_count_override if tray_count_override is not None else (1 if lines else 0)
        return trays, trays * 5, food + trays * 5

    async def list_incomplete_orders(self, day_id):
        out = []
        for pid, o in self.orders.items():
            if pid in self.cancelled:
                continue
            lines = o.get("lines_in", [])
            if (o["unmatched"] or "") != "" or any(l.unavailable for l in lines):
                out.append({
                    "order_id": pid, "participant_id": pid, "display_name": o.get("name", "?"),
                    "source_message_id": o["source"], "reply_message_id": o.get("reply"),
                    "raw_text": o["raw"], "unmatched_text": o["unmatched"],
                    "tray_count": o.get("trays", 0), "tray_count_manual": o.get("manual", False),
                    "lines": list(lines),
                })
        return out

    async def upsert_order(self, day_id, pid, raw_text, total, lines, source_message_id=None, unmatched_text=None, **kw):
        prev = self.orders.get(pid, {})
        self.orders[pid] = {
            "raw": raw_text,
            "lines": [l.raw_name for l in lines],
            "lines_in": list(lines),
            "unmatched": unmatched_text,
            "source": source_message_id,
            "total": total,
            "trays": kw.get("tray_count", 1 if lines else 0),
            "manual": kw.get("tray_count_manual", False),
            "reply": prev.get("reply"),
            "name": prev.get("name", "Людина"),
        }
        return pid

    async def enqueue_outbound(self, text, *, kind="send", telegram_message_id=None, reply_to_message_id=None, target="lunch"):
        self.outbound.append({"text": text, "reply_to": reply_to_message_id, "kind": kind, "edit_id": telegram_message_id})

    async def find_order_source_by_reply_id(self, reply_id):
        for o in self.orders.values():
            if o.get("reply") == reply_id:
                return o["source"]
        return None

    async def set_order_reply_message_id_by_source(self, source_id, reply_id):
        for o in self.orders.values():
            if o["source"] == source_id:
                o["reply"] = reply_id

    async def payment_source_exists(self, day_id, source_message_id):
        return any(p["source"] == source_message_id for p in self.payments)

    async def add_payment(self, day_id, pid, amount, raw, source_message_id=None, source="text"):
        self.payments.append({"pid": pid, "amount": amount, "source": source_message_id, "kind": source, "raw": raw})
        return len(self.payments)

    async def has_payment_of_amount(self, day_id, pid, amount, sources):
        return any(p["pid"] == pid and p["amount"] == amount and p.get("kind", "text") in sources for p in self.payments)

    async def has_payment_from(self, day_id, pid, sources):
        return any(p["pid"] == pid and p.get("kind", "text") in sources for p in self.payments)

    async def get_media_scan(self, day_id, tg_message_id):
        return self.scans.get(int(tg_message_id))

    async def save_media_scan(self, day_id, tg_message_id, *, sender_tg_id, source, kind, amount_uah=None, model=None, raw=None):
        import json as _json

        self.scans[int(tg_message_id)] = {
            "source": source, "kind": kind, "amount_uah": amount_uah, "model": model,
            "raw_json": _json.dumps(raw, ensure_ascii=False) if raw is not None else None,
            "sender_tg_id": str(sender_tg_id) if sender_tg_id else None,
        }

    async def scanned_message_ids(self, day_id):
        return set(self.scans)

    async def pending_link_receipts(self, day_id, sender_tg_id):
        paid = {p["source"] for p in self.payments}
        return sorted(
            mid for mid, r in self.scans.items()
            if r["source"] in ("link", "claim") and r["sender_tg_id"] == str(sender_tg_id) and mid not in paid
        )

    async def set_order_cash(self, day_id, pid, value=True):
        if pid not in self.orders or pid in self.cancelled or (pid in self.cash) == bool(value):
            return False
        (self.cash.add if value else self.cash.discard)(pid)
        return True

    async def get_order_cash(self, day_id, pid):
        return pid in self.cash

    async def catalog_dish_names(self, limit=300):
        return [m.name for m in self.menu]

    async def replace_menu(self, day_id, items, menu_message_id=None, parsed_raw=None):
        self.menu = [_row(100 + i, name, price) for i, (name, price) in enumerate(items)]
        self.menu_message_id = menu_message_id
        return list(self.menu)

    async def sync_orders_after_menu(self, day_id):
        return []

    async def participant_balance(self, day_id, pid):
        o = self.orders.get(pid)
        ordered = o["total"] if o and pid not in self.cancelled else 0
        paid = sum(p["amount"] for p in self.payments if p["pid"] == pid)
        return ordered, paid, ordered - paid

    async def day_order_texts(self, day_id, *, exclude_telegram_user_id):
        own = self.participants.get(str(exclude_telegram_user_id), {}).get("id")
        return [o["raw"] for pid, o in self.orders.items() if pid != own and pid not in self.cancelled and o["raw"]]

    async def get_order_reply_message_id(self, day_id, pid):
        return self.orders.get(pid, {}).get("reply")

    async def get_order_for_reply(self, day_id, pid):
        o = self.orders.get(pid)
        if not o or pid in self.cancelled:
            return None
        return {
            "reply_message_id": o.get("reply"),
            "display_name": o.get("name", "Людина"),
            "total_uah": o["total"],
            "tray_count": o.get("trays", 0),
            "tray_total_uah": o.get("trays", 0) * 5,
            "unmatched_text": o["unmatched"],
            "cash_promised": pid in self.cash,
            "lines": [
                {"menuItemName": l.raw_name, "qty": l.qty, "unitPriceUah": l.unit_price_uah,
                 "lineTotalUah": l.line_total_uah, "unavailable": l.unavailable}
                for l in o.get("lines_in", [])
            ],
        }

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
    id: int = 0


class FakeMsg:
    def __init__(self, mid, text, when, sender_id=UID, photo=False, sender_name=None, pdf=False, data=b"img"):
        self.sender_name = sender_name
        self.out = False
        self.id = mid
        self.message = text
        self.text = text
        self.date = when
        self.sender_id = sender_id
        self.photo = photo
        # PDF-квитанція — документ із mime application/pdf
        self.document = object() if pdf else None
        self.file = SimpleNamespace(mime_type="application/pdf" if pdf else "image/jpeg", size=len(data))
        self.data = data
        self.downloads = 0

    async def download_media(self, file=None):
        self.downloads += 1
        return self.data

    async def get_sender(self):
        return FakeSender(first_name=self.sender_name or "Аліна", id=self.sender_id)


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


# ---------- resolve_incomplete_orders (меню завантажили ПІСЛЯ замовлень) ----------


def _today_menu():
    def r(i, name, price, role="second"):
        return MenuItemRow(i, 1, name, normalize_dish_name(name), price, dish_id=i, tray_role=role)

    return [
        r(33, "Печінкові оладки", 70), r(44, "Салат «Крабово-сирний»", 50, "salad"),
        r(86, "Капуста тушкована з м'ясом", 90), r(36, "Пюре", 45), r(26, "Макарони", 40),
        r(22, "Котлети курячі", 70), r(43, "Салат «Капуста молода з огірком»", 40, "salad"),
        r(18, "Каша пшоняна з грибами", 45), r(6, "Буряк з сиром фета", 50),
    ]


def _line(dish_id, name, price, unavailable=False, role="second"):
    return OrderLineInput(None if unavailable else dish_id, name, 1, price, price, dish_id=dish_id,
                          tray_role=role, unavailable=unavailable)


def _seed(db, uid, raw, lines, unmatched=None, reply=555, manual=False, trays=1):
    pid = run(db.upsert_participant(str(uid), f"Людина {uid}"))
    run(db.upsert_order(1, pid, raw, 0, lines, source_message_id=100 + uid, unmatched_text=unmatched))
    db.orders[pid].update(reply=reply, manual=manual, trays=trays, name=f"Людина {uid}")
    return pid


def test_resolve_replaces_stale_line_when_text_fully_explained_by_today_menu():
    """Marta-like: «Печінкові оладки» стало «Печінка смажена» (хибний збіг), крабовий салат не розпізнано."""
    db = FakeDB(menu=_today_menu())
    pid = _seed(db, 1, "Печінкові оладки \nСалат крабово-сирний",
                [_line(32, "Печінка смажена з цибулею", 70, unavailable=True)], unmatched="Салат крабово-сирний")
    out = run(resolve_incomplete_orders(db, 1, db.menu))
    assert out == {"resolved": 1, "partial": 0}
    assert db.orders[pid]["lines"] == ["Печінкові оладки", "Салат «Крабово-сирний»"]
    assert db.orders[pid]["unmatched"] is None
    assert db.orders[pid]["total"] == 70 + 50 + 5
    # правимо нашу відповідь у групі, а не пишемо нову
    assert db.outbound[-1]["kind"] == "edit" and db.outbound[-1]["edit_id"] == 555


def test_resolve_adds_only_missing_dishes_and_keeps_rest_unmatched():
    db = FakeDB(menu=_today_menu())
    pid = _seed(db, 2, "Макарони\nкотлети\nквасоля стручкова",
                [_line(22, "Котлети курячі", 70)], unmatched="Макарони; квасоля стручкова")
    out = run(resolve_incomplete_orders(db, 1, db.menu))
    assert out == {"resolved": 0, "partial": 1}
    assert db.orders[pid]["lines"] == ["Котлети курячі", "Макарони"]
    assert db.orders[pid]["unmatched"] == "квасоля стручкова"
    assert "Не розпізнав: квасоля стручкова" in db.outbound[-1]["text"]


def test_resolve_handles_todays_real_cases():
    db = FakeDB(menu=_today_menu())
    a = _seed(db, 3, "пюре\nкапуста тушенная с мясом", [_line(36, "Пюре", 45)], unmatched="капуста тушенная с мясом")
    b = _seed(db, 4, "макарони\nкотлети\nсалат капуста з огірком",
              [_line(22, "Котлети курячі", 70), _line(43, "Салат «Капуста молода з огірком»", 40, role="salad")],
              unmatched="макарони")
    c = _seed(db, 5, "Буряк з сиром фета\nКаша пшоняна\nКотлети курячі",
              [_line(6, "Буряк з сиром фета", 50), _line(22, "Котлети курячі", 70)], unmatched="Каша пшоняна")
    out = run(resolve_incomplete_orders(db, 1, db.menu))
    assert out["resolved"] == 3
    assert db.orders[a]["lines"] == ["Пюре", "Капуста тушкована з м'ясом"]
    assert sorted(db.orders[b]["lines"]) == sorted(["Макарони", "Котлети курячі", "Салат «Капуста молода з огірком»"])
    assert sorted(db.orders[c]["lines"]) == sorted(["Буряк з сиром фета", "Каша пшоняна з грибами", "Котлети курячі"])
    assert all(db.orders[x]["unmatched"] is None for x in (a, b, c))


def test_resolve_is_idempotent_and_silent_when_nothing_new():
    db = FakeDB(menu=_today_menu())
    _seed(db, 6, "Макарони\nквасоля стручкова", [], unmatched="Макарони; квасоля стручкова")
    run(resolve_incomplete_orders(db, 1, db.menu))
    sent = len(db.outbound)
    again = run(resolve_incomplete_orders(db, 1, db.menu))
    assert again == {"resolved": 0, "partial": 0} and len(db.outbound) == sent

    db2 = FakeDB(menu=_today_menu())
    pid = _seed(db2, 7, "квасоля стручкова", [], unmatched="квасоля стручкова")
    assert run(resolve_incomplete_orders(db2, 1, db2.menu)) == {"resolved": 0, "partial": 0}
    assert db2.outbound == [] and db2.orders[pid]["unmatched"] == "квасоля стручкова"


def test_resolve_keeps_manual_tray_count_and_skips_complete_orders():
    db = FakeDB(menu=_today_menu())
    pid = _seed(db, 8, "Пюре\nМакарони", [_line(36, "Пюре", 45)], unmatched="Макарони", manual=True, trays=3)
    done = _seed(db, 9, "Пюре", [_line(36, "Пюре", 45)])  # повне замовлення — не чіпаємо
    run(resolve_incomplete_orders(db, 1, db.menu))
    assert db.orders[pid]["trays"] == 3 and db.orders[pid]["manual"] is True
    assert db.orders[pid]["total"] == 45 + 40 + 3 * 5
    assert db.orders[done]["lines"] == ["Пюре"]


def test_resolve_does_not_resurrect_cancelled_and_needs_menu():
    db = FakeDB(menu=_today_menu())
    pid = _seed(db, 10, "Макарони", [], unmatched="Макарони")
    db.cancelled.add(pid)
    assert run(resolve_incomplete_orders(db, 1, db.menu)) == {"resolved": 0, "partial": 0}
    assert run(resolve_incomplete_orders(FakeDB(menu=[]), 1, [])) == {"resolved": 0, "partial": 0}


def test_catch_up_also_resolves_incomplete_orders():
    db = FakeDB(menu=_today_menu())
    _seed(db, 11, "Макарони", [], unmatched="Макарони")
    out = run(catch_up_today(FakeClient([]), object(), db, now=_now_at(10, 40)))
    assert out["resolved"] == 1


# ---------- edit_or_reply (наша відповідь у групі вже видалена) ----------


class MessageIdInvalidError(Exception):
    """Те саме ім'я, що в telethon.errors — listener розпізнає за ним."""


class FakeEditClient:
    def __init__(self, edit_error=None):
        self.edit_error = edit_error
        self.edited = []
        self.sent = []

    async def edit_message(self, entity, mid, text):
        if self.edit_error:
            raise self.edit_error
        self.edited.append((mid, text))

    async def send_message(self, entity, text, reply_to=None):
        self.sent.append((text, reply_to))
        return type("Sent", (), {"id": 9001})()


def test_edit_or_reply_edits_normally():
    db = FakeDB()
    client = FakeEditClient()
    out = run(edit_or_reply(client, object(), db, {"telegram_message_id": 555, "text": "нова"}))
    assert out is None and client.edited == [(555, "нова")] and client.sent == []


def test_edit_or_reply_posts_new_reply_when_old_one_was_deleted():
    db = FakeDB()
    pid = run(db.upsert_participant("1", "Марта"))
    run(db.upsert_order(1, pid, "x", 0, [], source_message_id=777))
    db.orders[pid]["reply"] = 555
    client = FakeEditClient(MessageIdInvalidError("The specified message ID is invalid or you can't do that operation"))
    out = run(edit_or_reply(client, object(), db, {"telegram_message_id": 555, "text": "нова"}))
    assert out is not None and client.sent == [("нова", 777)]
    assert db.orders[pid]["reply"] == 9001  # наступні правки вже б'ють у живе повідомлення


class MessageNotModifiedError(Exception):
    """Те саме ім'я, що в telethon.errors: правка тим самим текстом."""


def test_edit_or_reply_same_text_is_done_not_retried():
    """«Розібрати» нічого не змінив — правка тим самим текстом: не помилка, нової відповіді теж не пишемо."""
    db = FakeDB()
    client = FakeEditClient(MessageNotModifiedError("Content of the message was not modified"))
    out = run(edit_or_reply(client, object(), db, {"telegram_message_id": 555, "text": "те саме"}))
    assert out is None and client.sent == []


def test_edit_or_reply_reraises_other_errors_and_unknown_orders():
    db = FakeDB()
    client = FakeEditClient(RuntimeError("flood"))
    try:
        run(edit_or_reply(client, object(), db, {"telegram_message_id": 555, "text": "x"}))
        raise AssertionError("мало кинути")
    except RuntimeError:
        pass
    gone = FakeEditClient(MessageIdInvalidError("x"))
    try:
        run(edit_or_reply(gone, object(), db, {"telegram_message_id": 404, "text": "x"}))  # замовлення з таким reply немає
        raise AssertionError("мало кинути")
    except MessageIdInvalidError:
        pass
    assert gone.sent == []


# ---------- нумерований підсумок оператора: пункт без повідомлення людини = страви автора ----------

# Підсумок оператора 2026-10-02 (як був; імена людей у ньому відсутні — лише номери)
OPERATOR_SUMMARY = (
    "1. Пюре \nФиле куриное запечене с помидором \nСирники \n\n2.Оселедець під шубою\n\n"
    "3.Гречка \nЯйце з кабачковою ікрою \nСалат з капусти\n\n4.філе риби в яйці, гречка, салат грецький\n\n"
    "5.пюре\nкапуста тушенная с мясом\n\n6.1 порції сметани\n\n7.Печінкові оладки \nСалат крабово-сирний\n\n"
    "8.макарони\nкотлети\nсалат капуста з огірком\n\n9.Буряк з сиром фета\nКаша пшоняна\nКотлети курячі\n\n"
    "10.Биток, буряк фета"
)

# Повідомлення людей того дня (без підсумку)
PEOPLE_TEXTS = [
    "Оселедець під шубою",
    "Гречка \nЯйце з кабачковою ікрою \nСалат з капусти",
    "філе риби в яйці, гречка, салат грецький",
    "пюре\nкапуста тушенная с мясом",
    "1 порції сметани",  # не з меню, але це чиєсь повідомлення — пункт 6 пояснений
    "Печінкові оладки \nСалат крабово-сирний",
    "макарони\nкотлети\nсалат капуста з огірком",
    "Буряк з сиром фета\nКаша пшоняна\nКотлети курячі",
    "Биток, буряк фета",
    "привіт всім",
]


def _summary_menu():
    def r(i, name, price, role="second"):
        return MenuItemRow(i, 1, name, normalize_dish_name(name), price, dish_id=i, tray_role=role)

    return [
        r(36, "Пюре", 45), r(60, "Філе курки запечене з ананасом або помідором", 90), r(51, "Сирники", 45),
        r(48, "Салат «Оселедець під шубою»", 50, "salad"), r(12, "Гречка", 35), r(81, "Яйце з кабачковою ікрою", 40),
        r(43, "Салат «Капуста молода з огірком»", 40, "salad"), r(84, "Філе риби смажене в яйці", 80),
        r(41, "Салат «Грецький»", 25, "salad"), r(86, "Капуста тушкована з м'ясом", 90), r(33, "Печінкові оладки", 70),
        r(44, "Салат «Крабово-сирний»", 50, "salad"), r(26, "Макарони", 40), r(22, "Котлети курячі", 70),
        r(6, "Буряк з сиром фета", 50), r(18, "Каша пшоняна з грибами", 45), r(1, "Биток Київський", 90),
    ]


def test_parse_numbered_summary_reads_the_real_summary():
    entries = parse_numbered_summary(OPERATOR_SUMMARY)
    assert len(entries) == 10
    assert entries[0] == "Пюре\nФиле куриное запечене с помидором\nСирники"
    assert entries[5] == "1 порції сметани"
    assert entries[9] == "Биток, буряк фета"


def test_parse_numbered_summary_ignores_ordinary_texts():
    assert parse_numbered_summary("Пюре\nкотлети") == []
    assert parse_numbered_summary("1. борщ\n2. котлета") == []  # лише два пункти
    assert parse_numbered_summary("1. борщ\n3. котлета\n4. компот") == []  # нумерація не підряд
    assert parse_numbered_summary("> Диана:\nрис\n\n> Марта:\nпюре") == []  # формат із цитатами — не наш


def test_only_the_entry_nobody_wrote_is_unexplained():
    entries = parse_numbered_summary(OPERATOR_SUMMARY)
    assert find_unexplained_entries(entries, PEOPLE_TEXTS, _summary_menu()) == [0]
    # якщо повідомлення людини немає серед відомих — її пункт теж стає «нічийним»
    assert find_unexplained_entries(entries, PEOPLE_TEXTS[:1] + PEOPLE_TEXTS[2:], _summary_menu()) == [0, 2]


def _attribute(db, known=None, entries=None, uid="5"):
    return run(attribute_summary_leftover(
        db, 1, _summary_menu(), entries=entries or parse_numbered_summary(OPERATOR_SUMMARY),
        known_texts=PEOPLE_TEXTS if known is None else known,
        sender_uid=uid, sender_name="Святослав", sender_username=None, source_message_id=105150,
    ))


def test_leftover_entry_becomes_the_operators_order():
    db = FakeDB(menu=_summary_menu())
    out = _attribute(db)
    assert out["status"] == "created" and out["total"] == 45 + 90 + 45 + 5
    pid = db.participants["5"]["id"]
    assert sorted(db.orders[pid]["lines"]) == sorted(
        ["Пюре", "Філе курки запечене з ананасом або помідором", "Сирники"]
    )
    assert db.orders[pid]["source"] == 105150
    assert db.outbound[-1]["reply_to"] == 105150 and "Святослав, заказ:" in db.outbound[-1]["text"]


def test_leftover_not_attributed_when_it_is_ambiguous_which_entries_are_nobodys():
    db = FakeDB(menu=_summary_menu())
    out = _attribute(db, known=PEOPLE_TEXTS[:1] + PEOPLE_TEXTS[2:])  # два пункти без автора
    assert out["status"] == "skipped" and "2 пунктів" in out["reason"]
    assert db.orders == {}


def test_leftover_not_attributed_when_operator_already_has_an_order():
    db = FakeDB(menu=_summary_menu())
    pid = run(db.upsert_participant("5", "Святослав"))
    run(db.upsert_order(1, pid, "своє", 40, [OrderLineInput(36, "Пюре", 1, 45, 45, dish_id=36)]))
    out = _attribute(db)
    assert out["status"] == "skipped" and db.orders[pid]["lines"] == ["Пюре"]
    # скасоване ("Прибрати") теж не воскрешаємо
    db2 = FakeDB(menu=_summary_menu())
    pid2 = run(db2.upsert_participant("5", "Святослав"))
    db2.cancelled.add(pid2)
    assert _attribute(db2)["status"] == "skipped" and pid2 not in db2.orders


def test_leftover_not_attributed_when_entry_is_not_on_todays_menu():
    entries = parse_numbered_summary(OPERATOR_SUMMARY)
    entries[0] = "Пюре\nквасоля стручкова"
    db = FakeDB(menu=_summary_menu())
    out = _attribute(db, entries=entries)
    assert out["status"] == "skipped" and "не розпізнано" in out["reason"] and db.orders == {}


def test_catch_up_attributes_operator_order_once_and_only_from_whole_day():
    """Усі повідомлення старші за вікно дозбору (3 год) — замовлення людей не чіпаємо, але для звірки читаємо."""
    db = FakeDB(menu=_summary_menu())
    msgs = [FakeMsg(100 + i, t, _today_at(7, 31 + i), sender_id=200 + i) for i, t in enumerate(PEOPLE_TEXTS)]
    msgs.append(FakeMsg(150, OPERATOR_SUMMARY, _today_at(7, 54), sender_id=5, sender_name="Святослав"))
    client = FakeClient(msgs)
    out1 = run(catch_up_today(client, object(), db, now=_now_at(13, 0)))
    pid = db.participants["5"]["id"]
    assert out1["summary_owner"] == "created"
    assert sorted(db.orders[pid]["lines"]) == sorted(
        ["Пюре", "Філе курки запечене з ананасом або помідором", "Сирники"]
    )
    # людей із старих повідомлень не чіпали
    assert len(db.orders) == 1
    out2 = run(catch_up_today(client, object(), db, now=_now_at(13, 5)))
    assert out2["summary_owner"] == "skipped" and len(db.orders) == 1


def test_day_reparse_adds_operators_own_order_from_numbered_summary():
    """Повний «Розібрати день»: замовлення людей + єдиний пункт підсумку без автора → автору підсумку."""
    db = FakeDB(menu=_summary_menu())
    msgs = [
        FakeMsg(110 + i, t, _today_at(7, 31 + i), sender_id=200 + i, sender_name=f"Людина{i}")
        for i, t in enumerate(PEOPLE_TEXTS[:9])  # без «привіт всім»
    ]
    msgs.append(FakeMsg(150, OPERATOR_SUMMARY, _today_at(7, 54), sender_id=5, sender_name="Святослав"))
    stats = run(reparse_day_with_client(FakeClient(msgs), object(), db))
    names = {p["name"] for p in db.participants.values()}
    assert "Святослав" in names
    sv = db.participants["5"]["id"]
    assert sorted(db.orders[sv]["lines"]) == sorted(
        ["Пюре", "Філе курки запечене з ананасом або помідором", "Сирники"]
    )
    # 8 замовлень людей (повідомлення «1 порції сметани» замовленням не стало) + 1 оператора
    assert stats.orders == 9 and len(db.orders) == 9
    assert any(d["reason"].startswith("замовлення автора підсумку") for d in stats.details)
    assert db.outbound == []  # розбір дня мовчить


def test_day_reparse_leaves_summary_alone_when_it_cannot_be_reconciled():
    db = FakeDB(menu=_summary_menu())
    msgs = [FakeMsg(110, "Биток, буряк фета", _today_at(7, 40), sender_id=200, sender_name="Людина")]
    msgs.append(FakeMsg(150, OPERATOR_SUMMARY, _today_at(7, 54), sender_id=5, sender_name="Святослав"))
    stats = run(reparse_day_with_client(FakeClient(msgs), object(), db))
    assert "5" not in db.participants  # забагато «нічиїх» пунктів — нікому нічого не приписано
    assert any("[підсумок списком]" in d["text"] for d in stats.details)


def test_leftover_not_attributed_when_it_looks_like_a_persons_edited_order():
    """Оператор змінив чуже замовлення в підсумку: пункт «нічий», а повідомлення людини лишилось невикористаним."""
    db = FakeDB(menu=_summary_menu())
    entries = parse_numbered_summary(OPERATOR_SUMMARY)
    entries[8] = "Буряк з сиром фета\nМакарони"  # було: Буряк, Каша пшоняна, Котлети курячі
    # тепер «нічиїх» два пункти (1 і 9) — і так не приписуємо; прибираємо перший, щоб лишився один
    entries[0] = PEOPLE_TEXTS[1]  # пункт 1 пояснюється повідомленням 2-ї людини (дубль)
    known = PEOPLE_TEXTS + [PEOPLE_TEXTS[1]]
    out = _attribute(db, known=known, entries=entries)
    assert out["status"] == "skipped" and "змінене" in out["reason"]
    assert db.orders == {}


# ---------- відповідь у групі: правка замість нової, «✅ Оплатив» ----------


def test_person_reparse_edits_our_previous_reply_instead_of_posting_a_new_one():
    """«Розібрати» в адмінці: ми вже відповідали людині — правимо ту відповідь, як при ручній правці."""
    db = FakeDB()
    pid = run(db.upsert_participant(str(UID), "Аліна"))
    run(db.upsert_order(1, pid, "Пюре", 45, [OrderLineInput(1, "Пюре", 1, 40, 40)], source_message_id=10))
    db.orders[pid]["reply"] = 900
    client = FakeClient([FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["notified"] is True and out["notifiedEdit"] is True
    assert len(db.outbound) == 1
    assert db.outbound[0]["kind"] == "edit" and db.outbound[0]["edit_id"] == 900
    assert db.outbound[0]["reply_to"] is None
    assert "Котлети курячі" in db.outbound[0]["text"]


def test_person_reparse_keeps_paid_mark_in_the_reply():
    """Людина вже оплатила (кнопка «Оплатив» / «оплатив …» у чаті) — правка відповіді не стирає позначку."""
    db = FakeDB()
    pid = run(db.upsert_participant(str(UID), "Аліна"))
    run(db.upsert_order(1, pid, "Пюре", 45, [OrderLineInput(1, "Пюре", 1, 40, 40)], source_message_id=11))
    db.orders[pid]["reply"] = 900
    run(db.add_payment(1, pid, 45, "admin"))
    client = FakeClient([FakeMsg(11, "Пюре", _today_at(10, 36))])
    run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert db.outbound[-1]["kind"] == "edit"
    assert "Разом: 45 грн\n✅ Оплатив" in db.outbound[-1]["text"]


def test_person_reparse_counts_payment_found_in_the_same_pass():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "оплатив 20", _today_at(10, 40)),
    ])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert db.outbound[-1]["reply_to"] == 11 and out["notifiedEdit"] is False  # відповіді ще не було — пишемо нову
    assert "Оплатив 20 грн, залишок 25 грн" in db.outbound[-1]["text"]


def test_paid_line_variants():
    from lunch.formatters import format_paid_line

    assert format_paid_line(155, 0) is None
    assert format_paid_line(155, 155) == "✅ Оплатив"
    assert format_paid_line(155, 100) == "Оплатив 100 грн, залишок 55 грн"
    assert format_paid_line(155, 200) == "✅ Оплатив (переплата 45 грн)"


def test_catch_up_edit_keeps_paid_mark():
    db = FakeDB(menu=_today_menu())
    pid = _seed(db, 6, "Пюре\nМакарони", [_line(36, "Пюре", 45)], unmatched="Макарони")
    run(db.add_payment(1, pid, 90, "admin"))
    run(resolve_incomplete_orders(db, 1, db.menu))
    assert db.outbound[-1]["kind"] == "edit"
    assert "Разом: 90 грн\n✅ Оплатив" in db.outbound[-1]["text"]


# ---------- «оплатив …» у чаті: ✅ у нашій відповіді на замовлення ----------


def _order_with_reply(db, reply=900):
    pid = run(db.upsert_participant(str(UID), "Аліна"))
    run(db.upsert_order(1, pid, "Пюре", 45, [OrderLineInput(1, "Пюре", 1, 40, 40)], source_message_id=11))
    db.orders[pid].update(reply=reply, name="Аліна")
    return pid


def test_refresh_order_reply_marks_paid_in_our_reply():
    from lunch.order_reply import refresh_order_reply

    db = FakeDB()
    pid = _order_with_reply(db)
    run(db.add_payment(1, pid, 45, "оплатив 45"))
    assert run(refresh_order_reply(db, 1, pid)) is True
    assert db.outbound == [{
        "text": "Аліна, заказ:\n• Пюре — 40 грн (40/шт)\nЛотки: 1 × 5 = 5 грн\nРазом: 45 грн\n✅ Оплатив",
        "reply_to": None, "kind": "edit", "edit_id": 900,
    }]


def test_refresh_order_reply_does_nothing_without_order_or_reply():
    from lunch.order_reply import refresh_order_reply

    db = FakeDB()
    pid = run(db.upsert_participant(str(UID), "Аліна"))
    assert run(refresh_order_reply(db, 1, pid)) is False  # замовлення немає (оплатив наперед)
    pid = _order_with_reply(db, reply=None)
    assert run(refresh_order_reply(db, 1, pid)) is False  # ми ще не відповідали
    assert db.outbound == []


def test_catch_up_payment_from_chat_marks_paid_in_our_reply():
    db = FakeDB()
    pid = _order_with_reply(db)
    client = FakeClient([FakeMsg(12, "оплатив 45", _today_at(10, 38))])
    out = run(catch_up_today(client, object(), db, now=_now_at(10, 40)))
    assert out["payments"] == 1
    assert db.outbound[-1]["kind"] == "edit" and db.outbound[-1]["edit_id"] == 900
    assert db.outbound[-1]["text"].endswith("Разом: 45 грн\n✅ Оплатив")


def test_person_reparse_with_only_a_payment_marks_paid_in_our_reply():
    db = FakeDB()
    pid = _order_with_reply(db)
    client = FakeClient([FakeMsg(12, "оплатив 45", _today_at(10, 38))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["payments"] == 1 and out["notifiedEdit"] is True
    assert db.orders[pid]["lines"] == ["Пюре"]  # замовлення не чіпали
    assert db.outbound[-1]["kind"] == "edit" and "✅ Оплатив" in db.outbound[-1]["text"]


# ---------- 2026-11-05: підсумок оператора з порожніми пунктами, «Розібрати» на самому операторі ----------

# Як сьогоднішній: свої страви оператор пише першим пунктом, далі люди, 5–8 — порожні місця на виріст
SUMMARY_2026_11_05 = (
    "1. Пюре\nФиле куриное с помидором\nСирники\n\n2.Пюре\nБиток Київський\n\n"
    "3.Каша пшона с грибами\nКапуста молода\nФиле З помідором\n\n4.Сметана\n\n5.\n\n6.\n\n7.\n\n8."
)
OPERATOR_UID = 465


def _seed_people_orders(db, texts):
    for i, t in enumerate(texts):
        pid = run(db.upsert_participant(str(900 + i), f"Людина{i}"))
        run(db.upsert_order(1, pid, t, 50, [OrderLineInput(36, "Пюре", 1, 45, 45, dish_id=36)], source_message_id=500 + i))


def _operator_client():
    return FakeClient([
        FakeMsg(112481, "", _today_at(11, 20), sender_id=OPERATOR_UID, photo=True, sender_name="Святослав"),
        FakeMsg(112494, SUMMARY_2026_11_05, _today_at(11, 32), sender_id=OPERATOR_UID, sender_name="Святослав"),
        FakeMsg(112495, "", _today_at(11, 33), sender_id=OPERATOR_UID, photo=True, sender_name="Святослав"),
    ])


def _menu_with_smetana():
    return _summary_menu() + [MenuItemRow(54, 1, "Сметана", normalize_dish_name("Сметана"), 25, dish_id=54)]


def test_empty_placeholder_entries_are_ignored_and_reformatted_entries_still_match():
    from lunch.summary_owner import pick_author_entry

    entries = parse_numbered_summary(SUMMARY_2026_11_05)
    assert len(entries) == 8 and entries[4:] == ["", "", "", ""]
    # люди писали в один рядок, оператор переписав рядками — це ті самі замовлення
    people = ["Пюре Биток Київський", "Каша пшона с грибами Капуста молода Филе З помідором", "Сметана"]
    assert pick_author_entry(entries, people, _menu_with_smetana()) == (0, "")


def test_first_entry_goes_to_author_on_explicit_action_even_with_another_unexplained():
    from lunch.summary_owner import pick_author_entry

    entries = parse_numbered_summary(SUMMARY_2026_11_05)
    people = ["Пюре\nБиток Київський", "Сметана"]  # третю людину не знайшли
    menu = _menu_with_smetana()
    idx, reason = pick_author_entry(entries, people, menu)
    assert idx is None and "2 пунктів" in reason  # фоновий дозбір лишається суворим
    assert pick_author_entry(entries, people, menu, first_is_author=True) == (0, "")
    # але не коли підсумок майже ні з чим не збігається
    idx, reason = pick_author_entry(entries, ["Сметана"], menu, first_is_author=True)
    assert idx is None and "майже не збігається" in reason


def test_person_reparse_of_the_operator_takes_his_own_entry_from_the_summary():
    """Регрес 2026-11-05: «Розібрати» на Святославі — orders=0, бо його страви лише в підсумку."""
    db = FakeDB(menu=_menu_with_smetana())
    _seed_people_orders(db, ["Пюре\nБиток Київський", "Каша пшона с грибами\nКапуста молода\nФиле З помідором", "Сметана"])
    out = run(reparse_person(_operator_client(), object(), db, group_id=GROUP, tg_user_id=OPERATOR_UID))
    assert out["orders"] == 1 and not out["errors"]
    sv = db.participants[str(OPERATOR_UID)]["id"]
    assert sorted(db.orders[sv]["lines"]) == sorted(["Пюре", "Філе курки запечене з ананасом або помідором", "Сирники"])
    assert db.orders[sv]["source"] == 112494
    assert any("свій пункт нумерованого підсумку" in d["reason"] for d in out["details"])
    assert db.outbound[-1]["reply_to"] == 112494 and "Святослав, заказ:" in db.outbound[-1]["text"]


def test_person_reparse_of_the_operator_when_his_entry_is_someone_elses():
    db = FakeDB(menu=_menu_with_smetana())
    # перший пункт збігається із замовленням людини, інших нічиїх немає — операторові нічого не приписуємо
    _seed_people_orders(db, [
        "Пюре\nФиле куриное с помидором\nСирники", "Пюре\nБиток Київський",
        "Каша пшона с грибами\nКапуста молода\nФиле З помідором", "Сметана",
    ])
    out = run(reparse_person(_operator_client(), object(), db, group_id=GROUP, tg_user_id=OPERATOR_UID))
    assert out["orders"] == 0 and str(OPERATOR_UID) not in db.participants
    assert any(d["text"] == "[підсумок списком]" for d in out["details"])


def test_day_reparse_attributes_first_entry_with_empty_placeholders():
    db = FakeDB(menu=_menu_with_smetana())
    msgs = [
        FakeMsg(112482, "Пюре Биток Київський", _today_at(11, 21), sender_id=201, sender_name="Лера"),
        FakeMsg(112486, "Каша пшона с грибами\nКапуста молода\nФиле З помідором", _today_at(11, 22), sender_id=202),
        FakeMsg(112491, "Сметана", _today_at(11, 30), sender_id=203, sender_name="Evgeniia"),
        FakeMsg(112494, SUMMARY_2026_11_05, _today_at(11, 32), sender_id=OPERATOR_UID, sender_name="Святослав"),
    ]
    run(reparse_day_with_client(FakeClient(msgs), object(), db))
    sv = db.participants[str(OPERATOR_UID)]["id"]
    assert sorted(db.orders[sv]["lines"]) == sorted(["Пюре", "Філе курки запечене з ананасом або помідором", "Сирники"])


# ---------- чеки оплати (фото, PDF, посилання) і «віддам готівкою» ----------

MENU_RAW = {"kind": "menu", "amount": 0, "items": [{"name": n, "price": p} for n, p in (
    ("Пюре", 40), ("Котлети курячі", 75), ("Салат грецький", 60), ("Салат Цезар", 70), ("Суп грибний", 55), ("Борщ", 50),
)]}


class FakeScanner:
    """Підміна моделі: що «видно» у фото — за вмістом файлу; рахує запити."""

    def __init__(self, by_data):
        self.by_data = by_data
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, data, *, mime="image/jpeg", known_names=(), model=None, **kw):
        self.calls.append({"data": data, "mime": mime, "model": model})
        raw = self.by_data[data]
        if isinstance(raw, Exception):
            raise raw
        raw = raw.get(model, raw) if model and model in raw else raw
        scan = scan_from_raw(raw, model=model or "claude-haiku-5-5")
        scan.input_tokens, scan.output_tokens = 2000, 300
        return scan


def with_scanner(by_data):
    """Контекст: ключ Claude «є», модель — FakeScanner."""

    class _Ctx:
        def __enter__(self):
            self.prev_key = os.environ.get("ANTHROPIC_API_KEY")
            self.prev_scan = evidence.scan_media_bytes
            os.environ["ANTHROPIC_API_KEY"] = "sk-test"
            self.scanner = FakeScanner(by_data)
            evidence.scan_media_bytes = self.scanner
            return self.scanner

        def __exit__(self, *exc):
            evidence.scan_media_bytes = self.prev_scan
            if self.prev_key is None:
                os.environ.pop("ANTHROPIC_API_KEY", None)
            else:
                os.environ["ANTHROPIC_API_KEY"] = self.prev_key
            return False

    return _Ctx()


def _receipt(amount):
    return {"kind": "receipt", "items": [], "amount": amount}


def test_plan_receipt_link_and_cash():
    link = "https://check.monobank.ua/p/Zy_XwVuTsRqPoNmLk-01"
    assert _plan(link).kind == "link" and _plan(link).links == [link]
    assert _plan("Віддам готівкою").kind == "cash"
    chat = _plan("є кеш тільки на столову")  # розмова, а не обіцянка
    assert chat.kind != "cash" and not chat.cash
    both = _plan(f"Пюре\nКотлети курячі\n\nВіддам готівкою\n{link}")
    assert both.kind == "order" and both.cash and both.links == [link]
    assert [l.raw_name for l in both.result.lines] == ["Пюре", "Котлети курячі"]
    assert both.result.unmatched == []  # «віддам готівкою» й посилання — не «нерозпізнані страви»
    assert _plan(link, uid="").kind == "no_sender"


def test_media_of_photo_pdf_and_other_documents():
    when = _today_at(10, 0)
    assert media_of(FakeMsg(1, "", when, photo=True)) == ("photo", "image/jpeg")
    assert media_of(FakeMsg(2, "", when, pdf=True)) == ("pdf", "application/pdf")
    assert media_of(FakeMsg(3, "Пюре", when)) is None
    doc = FakeMsg(4, "", when, pdf=True)
    doc.file = SimpleNamespace(mime_type="video/mp4", size=10)
    assert media_of(doc) is None
    doc.file = SimpleNamespace(mime_type="image/png", size=10)  # фото, надіслане файлом
    assert media_of(doc) == ("photo", "image/png")


def test_day_reparse_receipt_photo_and_pdf_become_payments_and_journal_is_reused():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"shot-115"),
        FakeMsg(21, "Суп грибний", _today_at(10, 40), sender_id=888),
        FakeMsg(22, "", _today_at(10, 41), sender_id=888, pdf=True, data=b"pdf-55"),
        FakeMsg(23, "", _today_at(10, 50), sender_id=888, photo=True, data=b"mem"),
    ])
    by_data = {b"shot-115": _receipt(115), b"pdf-55": _receipt(55.0), b"mem": {"kind": "other", "items": [], "amount": 0}}
    with with_scanner(by_data) as scanner:
        stats = run(reparse_day_with_client(client, object(), db))
        assert stats.orders == 2 and stats.payments == 2
        assert [(p["amount"], p["kind"], p["source"]) for p in db.payments] == [(115, "receipt", 12), (55, "receipt", 22)]
        assert [c["mime"] for c in scanner.calls] == ["image/jpeg", "application/pdf", "image/jpeg"]
        notes = {d["messageId"]: d for d in stats.details}
        assert notes[12]["outcome"] == "payment" and "115 грн — зараховано" in notes[12]["reason"]
        assert notes[22]["text"] == "[PDF]" and notes[23]["reason"] == "фото без меню й чека"
        # «Розібрати день» ще раз: оплати стерто й відновлено з журналу, модель не питаємо
        db.payments.clear()
        stats2 = run(reparse_day_with_client(client, object(), db))
        assert len(scanner.calls) == 3 and stats2.payments == 2 and len(db.payments) == 2


def test_day_reparse_without_claude_key_skips_new_media_but_uses_journal():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"shot"),
    ])
    prev = os.environ.pop("ANTHROPIC_API_KEY", None)
    try:
        stats = run(reparse_day_with_client(client, object(), db))
        assert stats.payments == 0 and "не розібрано" in {d["messageId"]: d for d in stats.details}[12]["reason"]
        run(db.save_media_scan(1, 12, sender_tg_id=str(UID), source="photo", kind="receipt", amount_uah=40, raw=_receipt(40)))
        assert run(reparse_day_with_client(client, object(), db)).payments == 1
    finally:
        if prev is not None:
            os.environ["ANTHROPIC_API_KEY"] = prev


def test_receipt_confirms_text_payment_instead_of_doubling_both_orders():
    # «оплатив 115», потім скрін на 115 → одна оплата
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "оплатив 115", _today_at(10, 37)),
        FakeMsg(13, "", _today_at(10, 38), photo=True, data=b"shot"),
    ])
    with with_scanner({b"shot": _receipt(115)}):
        stats = run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(115, "text")]
    assert "підтверджує вже зараховану оплату" in {d["messageId"]: d for d in stats.details}[13]["reason"]
    # скрін, потім «оплатив 115» → теж одна; інша сума — окрема оплата
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"shot"),
        FakeMsg(13, "оплатив 115", _today_at(10, 38)),
        FakeMsg(14, "оплатив 20", _today_at(10, 39)),
    ])
    with with_scanner({b"shot": _receipt(115)}):
        run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(115, "receipt"), (20, "text")]


def test_receipt_of_another_amount_does_not_double_a_debt_already_settled():
    # Адмін натиснув «Оплатив» (борг 115 закрито), а в чеку 120 (інакше порахована таця) — це та сама оплата.
    from lunch.evidence import apply_receipt

    db = FakeDB()
    run(reparse_day_with_client(FakeClient([FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36))]), object(), db))
    pid = db.participants[str(UID)]["id"]
    run(db.add_payment(1, pid, 115, "адмінка", source="admin"))
    assert run(apply_receipt(db, 1, pid, amount_uah=120, message_id=12, source="photo")) == "settled"
    assert run(apply_receipt(db, 1, pid, amount_uah=115, message_id=13, source="pdf")) == "confirms"
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(115, "admin")]
    # «скинула гроші» закрила борг, потім чек на іншу суму → теж не друга оплата
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "скинула гроші", _today_at(10, 37)),
        FakeMsg(13, "", _today_at(10, 38), photo=True, data=b"shot"),
    ])
    with with_scanner({b"shot": _receipt(110)}):
        stats = run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(115, "claim")]
    assert "борг уже закрито" in {d["messageId"]: d for d in stats.details}[13]["reason"]
    # борг закрито лише частково → чек зараховується; два чеки (оплата двома переказами) — обидва
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "оплатив 50", _today_at(10, 37)),
        FakeMsg(13, "", _today_at(10, 38), photo=True, data=b"a"),
        FakeMsg(14, "", _today_at(10, 39), photo=True, data=b"b"),
    ])
    with with_scanner({b"a": _receipt(40), b"b": _receipt(25)}):
        run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(50, "text"), (40, "receipt"), (25, "receipt")]
    # борг закрито чеком, другий чек (заплатив за колегу) лишається видимим як переплата
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 38), photo=True, data=b"a"),
        FakeMsg(13, "", _today_at(10, 39), photo=True, data=b"b"),
    ])
    with with_scanner({b"a": _receipt(115), b"b": _receipt(90)}):
        run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(115, "receipt"), (90, "receipt")]


def test_receipt_without_amount_or_failed_scan_changes_nothing():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"blur"),
        FakeMsg(13, "", _today_at(10, 38), photo=True, data=b"boom"),
    ])
    with with_scanner({b"blur": _receipt(0), b"boom": RuntimeError("credit balance is too low")}):
        stats = run(reparse_day_with_client(client, object(), db))
    assert db.payments == [] and 13 not in db.scans  # помилку не журналюємо — наступний прохід спробує ще
    assert "суму не видно" in {d["messageId"]: d for d in stats.details}[12]["reason"]
    assert any("msg 13" in e for e in stats.errors)


def test_receipt_link_pays_the_debt_and_waits_for_the_order():
    link = "https://check.monobank.ua/p/AbCdEfGhIjKlMnOpQrSt"
    # замовлення, потім посилання
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)), FakeMsg(12, link, _today_at(10, 37))])
    stats = run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"], p["source"]) for p in db.payments] == [(115, "link", 12)]
    assert "суму не перевірено" in db.payments[0]["raw"] and stats.payments == 1
    # посилання раніше за замовлення: чекає і гасить борг, щойно замовлення з'явилось
    db = FakeDB()
    client = FakeClient([FakeMsg(11, link, _today_at(10, 30)), FakeMsg(12, "Пюре", _today_at(10, 36))])
    stats = run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"], p["source"]) for p in db.payments] == [(40, "link", 11)]
    assert "замовлення ще немає" in {d["messageId"]: d for d in stats.details}[11]["reason"]
    # боргу вже немає — посилання нічого не додає
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)), FakeMsg(12, "оплатив 40", _today_at(10, 37)), FakeMsg(13, link, _today_at(10, 38)),
    ])
    run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(40, "text")]


def test_paid_claim_without_amount_settles_the_debt_like_a_link():
    """«Скинула гроші» без суми й чека — рішення власника: гасить увесь борг, позначено «суму не перевірено»."""
    assert _plan("скинула гроші").kind == "claim" and _plan("скинул").kind == "claim"
    with_order = _plan("Пюре\nКотлети курячі\nоплатила")
    assert with_order.kind == "order" and with_order.claim and with_order.result.unmatched == []
    for chat in ("Кто забыл скинуть за обед?", "сейчас заказ сделаю и скину сразу", "я закинул андрею", "Иду в столовую, кидайте деньги"):
        assert _plan(chat).kind not in ("claim", "payment") and not _plan(chat).claim, chat
    # замовлення, потім «скинула гроші»
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)), FakeMsg(12, "скинула гроші", _today_at(10, 37))])
    stats = run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"], p["source"]) for p in db.payments] == [(115, "claim", 12)]
    assert "суму не перевірено" in db.payments[0]["raw"] and stats.payments == 1
    # «оплатила» раніше за замовлення — чекає; скрін на ту саму суму після — лише підтверджує
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "оплатила", _today_at(10, 30)),
        FakeMsg(12, "Пюре", _today_at(10, 36)),
        FakeMsg(13, "", _today_at(10, 37), photo=True, data=b"shot"),
        FakeMsg(14, "скинула", _today_at(10, 38)),
    ])
    with with_scanner({b"shot": _receipt(40)}):
        run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"], p["source"]) for p in db.payments] == [(40, "claim", 11)]
    # скрін уже погасив борг — слова «скинула» нічого не додають
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"shot"),
        FakeMsg(13, "скинула", _today_at(10, 38)),
    ])
    with with_scanner({b"shot": _receipt(40)}):
        run(reparse_day_with_client(client, object(), db))
    assert [(p["amount"], p["kind"]) for p in db.payments] == [(40, "receipt")]
    # дозбір: правка нашої відповіді з «✅ Оплатив», і вдруге нічого
    db = FakeDB()
    pid = _seed(db, UID, "Пюре", [_line(1, "Пюре", 40)])
    db.orders[pid]["total"] = 45
    client = FakeClient([FakeMsg(12, "скинул", _today_at(10, 38))])
    assert run(catch_up_today(client, object(), db, now=_now_at(10, 45)))["payments"] == 1
    assert db.outbound[-1]["kind"] == "edit" and db.outbound[-1]["text"].endswith("✅ Оплатив")
    assert run(catch_up_today(client, object(), db, now=_now_at(10, 50)))["payments"] == 0 and len(db.payments) == 1


def test_cash_promise_marks_order_reply_and_debts():
    db = FakeDB()
    client = FakeClient([
        FakeMsg(11, "Пюре\nКотлети курячі\n\nВіддам готівкою", _today_at(10, 36)),
        FakeMsg(21, "Суп грибний", _today_at(10, 40), sender_id=888),
        FakeMsg(22, "налом", _today_at(10, 41), sender_id=888),
    ])
    stats = run(reparse_day_with_client(client, object(), db))
    a, b = db.participants[str(UID)]["id"], db.participants["888"]["id"]
    assert db.cash == {a, b} and db.orders[a]["unmatched"] is None
    assert "віддасть готівкою" in {d["messageId"]: d for d in stats.details}[11]["reason"]
    text = format_order_confirm("Аліна", [], 115, [], cash=True)
    assert text.endswith("Разом: 115 грн\n💵 Готівкою")
    assert "💵" not in format_order_confirm("Аліна", [], 115, [], cash=True, paid_uah=115)  # розрахувалась — лише «✅ Оплатив»
    assert "Оплатив 50 грн, залишок 65 грн\n💵 Готівкою" in format_order_confirm("Аліна", [], 115, [], cash=True, paid_uah=50)
    debts = format_debts([{"display_name": "Аліна", "debt_uah": 115, "total_uah": 115, "paid_uah": 0, "cash_promised": True}])
    assert debts.endswith("(заказ 115, оплачено 0) — готівкою")


def test_catch_up_cash_message_edits_our_reply():
    db = FakeDB()
    pid = _seed(db, UID, "Пюре", [_line(1, "Пюре", 40)])
    db.orders[pid]["total"] = 45
    client = FakeClient([FakeMsg(12, "дам наличкой", _today_at(10, 38))])
    run(catch_up_today(client, object(), db, now=_now_at(10, 45)))
    assert pid in db.cash
    assert db.outbound[-1]["kind"] == "edit" and db.outbound[-1]["text"].endswith("💵 Готівкою")
    n = len(db.outbound)
    run(catch_up_today(client, object(), db, now=_now_at(10, 50)))
    assert len(db.outbound) == n  # вдруге не смикаємо групу


def test_catch_up_scans_missed_menu_photo_and_receipts_once():
    db = FakeDB(menu=[])
    db.no_day = True  # меню прийшло, поки слухач був на паузі: дня ще немає
    msgs = [
        FakeMsg(10, "", _today_at(10, 30), photo=True, data=b"menu", sender_id=555),
        FakeMsg(11, "Пюре, котлети курячі", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"shot"),
        FakeMsg(13, "", _today_at(6, 0), photo=True, data=b"old"),  # поза вікном дозбору
    ]
    client = FakeClient(msgs)
    with with_scanner({b"menu": MENU_RAW, b"shot": _receipt(115)}) as scanner:
        db.no_day = False
        out = run(catch_up_today(client, object(), db, now=_now_at(10, 45)))
        assert out["menu"] == 6 and out["orders"] == 1 and out["payments"] == 1
        assert [m.name for m in db.menu][:2] == ["Пюре", "Котлети курячі"] and db.menu_message_id == 10
        assert db.outbound[0]["reply_to"] == 10 and db.outbound[0]["text"].startswith("Меню на сьогодні:")
        assert [(p["amount"], p["kind"]) for p in db.payments] == [(115, "receipt")]
        # меню: дешева модель впізнала, дорога перечитала; чек — лише дешева
        assert [c["model"] for c in scanner.calls] == [None, "claude-opus-5-5", None]
        out2 = run(catch_up_today(client, object(), db, now=_now_at(10, 50)))
        assert len(scanner.calls) == 3 and out2["payments"] == 0 and len(db.payments) == 1


def test_menu_is_reread_by_the_expensive_model_and_its_prices_win():
    """Порівняння 16.11.2026: Haiku впізнає меню, але зсуває ціни на рядок. Страви й ціни бере Opus."""
    shifted = {"kind": "menu", "amount": 0, "items": [{**it, "price": it["price"] + 10} for it in MENU_RAW["items"]]}
    db = FakeDB(menu=[])
    client = FakeClient([FakeMsg(10, "", _today_at(10, 30), photo=True, data=b"menu", sender_id=555)])
    with with_scanner({b"menu": {"claude-opus-5-5": MENU_RAW, "items": shifted["items"], "kind": "menu", "amount": 0}}) as scanner:
        out = run(catch_up_today(client, object(), db, now=_now_at(10, 45)))
        assert out["menu"] == 6
        assert [c["model"] for c in scanner.calls] == [None, "claude-opus-5-5"]
        assert [(m.name, m.price_uah) for m in db.menu][:2] == [("Пюре", 40), ("Котлети курячі", 75)]  # ціни дорогої
        assert db.scans[10]["model"] == "claude-opus-5-5" and db.scans[10]["kind"] == "menu"
    # LUNCH_MENU_MODEL = та сама дешева → другого запиту немає
    prev = os.environ.get("LUNCH_MENU_MODEL")
    os.environ["LUNCH_MENU_MODEL"] = "claude-haiku-5-5"
    try:
        db = FakeDB(menu=[])
        with with_scanner({b"menu": MENU_RAW}) as scanner:
            run(catch_up_today(client, object(), db, now=_now_at(10, 45)))
            assert len(scanner.calls) == 1
    finally:
        if prev is None:
            os.environ.pop("LUNCH_MENU_MODEL", None)
        else:
            os.environ["LUNCH_MENU_MODEL"] = prev


def test_catch_up_receipt_marks_paid_in_our_reply_even_when_day_is_closed():
    db = FakeDB(status="closed")
    pid = _seed(db, UID, "Пюре", [_line(1, "Пюре", 40)])
    client = FakeClient([FakeMsg(12, "", _today_at(13, 0), pdf=True, data=b"pdf")])
    with with_scanner({b"pdf": _receipt(45)}):
        out = run(catch_up_today(client, object(), db, now=_now_at(13, 5)))
    assert out["payments"] == 1 and out["skipped_reason"] == "день закрито"
    assert db.payments[0]["pid"] == pid
    assert db.outbound[-1]["kind"] == "edit" and "✅ Оплатив" in db.outbound[-1]["text"]


def test_person_reparse_takes_link_and_cash():
    link = "https://check.monobank.ua/p/Zy_XwVuTsRqPoNmLk-01"
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре", _today_at(10, 36)), FakeMsg(12, link, _today_at(10, 37))])
    out = run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert out["orders"] == 1 and out["payments"] == 1 and db.payments[0]["kind"] == "link"
    assert "Оплатив 40 грн" in db.outbound[-1]["text"]  # FakeDB рахує борг без лотка
    db = FakeDB()
    client = FakeClient([FakeMsg(11, "Пюре\nготівкою", _today_at(10, 36))])
    run(reparse_person(client, object(), db, group_id=GROUP, tg_user_id=UID))
    assert db.outbound[-1]["text"].endswith("💵 Готівкою")


def test_compare_day_reports_where_models_disagree():
    cheap_menu = {"kind": "menu", "amount": 0, "items": [*MENU_RAW["items"][:4], {"name": "Суп грибний", "price": 65}, {"name": "Узвар", "price": 20}]}
    by_data = {
        b"menu": {"claude-opus-5-5": MENU_RAW, "claude-haiku-5-5": cheap_menu},
        b"shot": {"claude-opus-5-5": _receipt(115), "claude-haiku-5-5": _receipt(115)},
        b"mem": {"claude-opus-5-5": {"kind": "other", "items": [], "amount": 0}, "claude-haiku-5-5": RuntimeError("x")},
    }

    class PerModel(FakeScanner):
        async def __call__(self, data, *, mime="image/jpeg", known_names=(), model=None, **kw):
            raw = self.by_data[data][model]
            self.calls.append({"model": model})
            if isinstance(raw, Exception):
                raise raw
            scan = scan_from_raw(raw, model=model)
            scan.input_tokens, scan.output_tokens = 2000, 500
            return scan

    db = FakeDB()
    client = FakeClient([
        FakeMsg(10, "", _today_at(10, 30), photo=True, data=b"menu"),
        FakeMsg(11, "Пюре", _today_at(10, 36)),
        FakeMsg(12, "", _today_at(10, 37), photo=True, data=b"shot"),
        FakeMsg(13, "", _today_at(10, 50), pdf=True, data=b"mem"),
    ])
    lines: list[str] = []
    out = run(compare_day(
        client, object(), db, day=today_kyiv(), models=["claude-opus-5-5", "claude-haiku-5-5"],
        scan=PerModel(by_data), log=lines.append,
    ))
    assert out["baseline"] == "claude-opus-5-5" and [m["messageId"] for m in out["media"]] == [10, 12, 13]
    menu_row = out["media"][0]["results"]
    assert menu_row[0]["agree"] is True and menu_row[1]["agree"] is False
    assert menu_row[1]["menuDiff"] == {
        "missing": ["Борщ"], "extra": ["Узвар"], "prices": [{"name": "Суп грибний", "base": 55, "other": 65}],
    }
    assert out["media"][1]["results"][1] == {**out["media"][1]["results"][1], "kind": "receipt", "amountUah": 115, "agree": True}
    assert out["media"][2]["results"][1]["error"].startswith("RuntimeError")
    summary = {s["model"]: s for s in out["summary"]}
    assert summary["claude-opus-5-5"]["agree"] == 3 and summary["claude-opus-5-5"]["costUsd"] == 0.054
    assert summary["claude-haiku-5-5"] == {**summary["claude-haiku-5-5"], "agree": 1, "errors": 1, "menu": 1, "receipt": 1, "costUsd": 0.0009}
    assert db.payments == [] and db.scans == {} and db.orders == {}  # порівняння нічого не змінює
    assert any("Суп грибний 55→65" in ln for ln in lines) and "підсумок" in lines[-1]


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
        test_resolve_replaces_stale_line_when_text_fully_explained_by_today_menu,
        test_resolve_adds_only_missing_dishes_and_keeps_rest_unmatched,
        test_resolve_handles_todays_real_cases,
        test_resolve_is_idempotent_and_silent_when_nothing_new,
        test_resolve_keeps_manual_tray_count_and_skips_complete_orders,
        test_resolve_does_not_resurrect_cancelled_and_needs_menu,
        test_catch_up_also_resolves_incomplete_orders,
        test_edit_or_reply_edits_normally,
        test_edit_or_reply_posts_new_reply_when_old_one_was_deleted,
        test_edit_or_reply_same_text_is_done_not_retried,
        test_edit_or_reply_reraises_other_errors_and_unknown_orders,
        test_parse_numbered_summary_reads_the_real_summary,
        test_parse_numbered_summary_ignores_ordinary_texts,
        test_only_the_entry_nobody_wrote_is_unexplained,
        test_leftover_entry_becomes_the_operators_order,
        test_leftover_not_attributed_when_it_is_ambiguous_which_entries_are_nobodys,
        test_leftover_not_attributed_when_operator_already_has_an_order,
        test_leftover_not_attributed_when_entry_is_not_on_todays_menu,
        test_leftover_not_attributed_when_it_looks_like_a_persons_edited_order,
        test_catch_up_attributes_operator_order_once_and_only_from_whole_day,
        test_day_reparse_adds_operators_own_order_from_numbered_summary,
        test_day_reparse_leaves_summary_alone_when_it_cannot_be_reconciled,
        test_person_reparse_edits_our_previous_reply_instead_of_posting_a_new_one,
        test_person_reparse_keeps_paid_mark_in_the_reply,
        test_person_reparse_counts_payment_found_in_the_same_pass,
        test_paid_line_variants,
        test_catch_up_edit_keeps_paid_mark,
        test_refresh_order_reply_marks_paid_in_our_reply,
        test_refresh_order_reply_does_nothing_without_order_or_reply,
        test_catch_up_payment_from_chat_marks_paid_in_our_reply,
        test_person_reparse_with_only_a_payment_marks_paid_in_our_reply,
        test_empty_placeholder_entries_are_ignored_and_reformatted_entries_still_match,
        test_first_entry_goes_to_author_on_explicit_action_even_with_another_unexplained,
        test_person_reparse_of_the_operator_takes_his_own_entry_from_the_summary,
        test_person_reparse_of_the_operator_when_his_entry_is_someone_elses,
        test_day_reparse_attributes_first_entry_with_empty_placeholders,
        test_plan_receipt_link_and_cash,
        test_media_of_photo_pdf_and_other_documents,
        test_day_reparse_receipt_photo_and_pdf_become_payments_and_journal_is_reused,
        test_day_reparse_without_claude_key_skips_new_media_but_uses_journal,
        test_receipt_confirms_text_payment_instead_of_doubling_both_orders,
        test_receipt_of_another_amount_does_not_double_a_debt_already_settled,
        test_receipt_without_amount_or_failed_scan_changes_nothing,
        test_receipt_link_pays_the_debt_and_waits_for_the_order,
        test_paid_claim_without_amount_settles_the_debt_like_a_link,
        test_cash_promise_marks_order_reply_and_debts,
        test_catch_up_cash_message_edits_our_reply,
        test_catch_up_scans_missed_menu_photo_and_receipts_once,
        test_menu_is_reread_by_the_expensive_model_and_its_prices_win,
        test_catch_up_receipt_marks_paid_in_our_reply_even_when_day_is_closed,
        test_person_reparse_takes_link_and_cash,
        test_compare_day_reports_where_models_disagree,
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
