"""Дозбір замовлень, які слухач не обробив наживо.

Коли це буває:
  * backend зупиняє слухача під «ексклюзивну» Telethon-сесію (пошук телефону, розсилки,
    імпорт з Telegram) — у логах це «pause for exclusive session» приблизно щоп'ять хвилин;
    повідомлення, що прийшли за ці секунди, обробник NewMessage не бачить;
  * меню дня додали вже після перших замовлень (OCR вимкнений — меню вставляє адмін).

Правила, щоб нічого не зіпсувати:
  * лише люди, у яких за сьогодні ще НЕМАЄ замовлення (навіть скасованого — «Прибрати»
    не воскрешаємо) — ручні правки й чужі замовлення не перезаписуємо;
  * оплата — лише якщо такого повідомлення ще немає серед оплат; картка — якщо ще не збережена;
  * підсумок дня й «забагато страв» не чіпаємо — це робить живий обробник / «Розібрати день»;
  * підтвердження людині йде звичайною чергою (reply до її повідомлення), як і наживо.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from .db import LunchDB, today_kyiv
from .formatters import format_order_confirm
from .reparse_day import DayContext, kyiv_day_bounds, plan_text_message

CATCH_UP_WINDOW = timedelta(hours=3)
CATCH_UP_LIMIT = 300


def _display_name(sender) -> str:
    if sender is None:
        return "Невідомий"
    parts = [x for x in (getattr(sender, "first_name", None), getattr(sender, "last_name", None)) if x]
    if parts:
        return " ".join(parts)
    if getattr(sender, "username", None):
        return f"@{sender.username}"
    return str(getattr(sender, "id", "Невідомий"))


async def catch_up_today(
    client,
    entity,
    db: LunchDB,
    *,
    now: Optional[datetime] = None,
    notify: bool = True,
) -> dict[str, Any]:
    stats: dict[str, Any] = {"scanned": 0, "orders": 0, "payments": 0, "cards": 0, "skipped_reason": None}
    d = today_kyiv()
    day = await db.get_day(d)
    if day is None:
        stats["skipped_reason"] = "немає дня"
        return stats
    if day.status == "closed":
        stats["skipped_reason"] = "день закрито"
        return stats
    ctx = DayContext()
    menu, fallback = await ctx.load(db, day.id)
    if not menu and not fallback:
        stats["skipped_reason"] = "немає меню"
        return stats

    start, end = kyiv_day_bounds(d)
    current = now or datetime.now(timezone.utc)
    since = max(start.astimezone(timezone.utc), current - CATCH_UP_WINDOW)
    end_utc = end.astimezone(timezone.utc)

    messages: list = []
    async for msg in client.iter_messages(entity, limit=CATCH_UP_LIMIT):
        if not msg.date:
            continue
        md = msg.date if msg.date.tzinfo else msg.date.replace(tzinfo=timezone.utc)
        if md > end_utc:
            continue
        if md < since:
            break
        messages.append(msg)
    messages.reverse()

    card_known = bool(day.payee_card)
    for msg in messages:
        text = (getattr(msg, "message", None) or getattr(msg, "text", None) or "").strip()
        if not text:
            continue
        stats["scanned"] += 1
        sender_id = getattr(msg, "sender_id", None)
        uid = str(sender_id) if sender_id else ""
        plan = plan_text_message(
            text,
            uid=uid,
            menu=menu,
            fallback=fallback,
            day_closed=False,
            allow_orders_when_closed=False,
            is_own=bool(getattr(msg, "out", False)),
        )

        if plan.kind == "card" and plan.card:
            if not card_known:
                await db.set_payee_card(day.id, plan.card)
                card_known = True
                stats["cards"] += 1
            continue

        if plan.kind == "payment" and plan.payment:
            if await db.payment_source_exists(day.id, int(msg.id)):
                continue
            sender = await msg.get_sender()
            username = getattr(sender, "username", None) if sender else None
            pid = await db.upsert_participant(uid, _display_name(sender), f"@{username}" if username else None)
            await db.add_payment(day.id, pid, plan.payment.amount_uah, text, source_message_id=int(msg.id))
            stats["payments"] += 1
            continue

        if plan.kind != "order" or plan.result is None:
            continue
        existing = await db.find_participant_id_by_telegram_id(uid)
        if existing is not None and await db.has_order(day.id, existing):
            continue
        sender = await msg.get_sender()
        name = _display_name(sender)
        username = getattr(sender, "username", None) if sender else None
        pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
        result = plan.result
        await db.upsert_order(
            day.id,
            pid,
            text,
            result.total_uah,
            result.lines,
            source_message_id=int(msg.id),
            unmatched_text=result.unmatched_text or None,
        )
        stats["orders"] += 1
        if notify:
            tray_price = await db.get_tray_price()
            trays, tray_sum, grand = await db.apply_trays_to_lines(result.lines)
            await db.enqueue_outbound(
                format_order_confirm(
                    name,
                    result.lines,
                    grand,
                    result.unmatched,
                    tray_count=trays,
                    tray_price_uah=tray_price,
                    tray_total_uah=tray_sum,
                    unavailable=result.unavailable,
                    ambiguous=result.ambiguous,
                ),
                reply_to_message_id=int(msg.id),
            )
    return stats
