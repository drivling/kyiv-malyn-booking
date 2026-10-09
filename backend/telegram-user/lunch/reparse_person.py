"""Розбір повідомлень однієї людини за день (кнопка «Розібрати» біля імені в адмінці).

На відміну від «Розібрати поточний день» не скидає чужі замовлення й ручні правки:
чіпає лише замовлення та розпізнані оплати цієї людини. Якщо замовлення є, але з меню
не збіглось нічого — лишаємо порожнє замовлення з оригінальним текстом, щоб його було
видно в таблиці й можна було виправити вручну (замість тихого «проігноровано»).

Джерело повідомлень: Telegram (актуальний текст) і база «Джури» (DzhuraMessage — те, що слухач
уже зберіг; рятує, коли Telegram недоступний або історія не дійшла до початку дня).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any, Optional

from .db import LunchDB, today_kyiv
from .formatters import format_order_confirm
from .reparse_day import (
    SKIP_REASONS,
    DayContext,
    ReparseStats,
    kyiv_day_bounds,
    plan_text_message,
)

TELEGRAM_SCAN_LIMIT = 1000
# Скільки нерозпізнаних повідомлень людини збираємо в один порожній рядок замовлення.
PLACEHOLDER_MAX_MESSAGES = 5


@dataclass
class PersonMessage:
    id: int
    text: str
    date: datetime
    media: Optional[str] = None
    # повідомлення з нашого акаунта (бувають і відповіді бота, і власні замовлення власника)
    outgoing: bool = False


@dataclass
class PersonSource:
    messages: list[PersonMessage]
    name: Optional[str]
    username: Optional[str]
    warnings: list[str]
    source: str  # telegram | dzhura | none


def _fmt_name(first: Optional[str], last: Optional[str], username: Optional[str], fallback: str) -> str:
    parts = [x for x in (first, last) if x]
    if parts:
        return " ".join(parts)
    if username:
        return f"@{username}"
    return fallback


async def collect_person_messages(
    client,
    entity,
    db: LunchDB,
    *,
    group_id: int,
    tg_user_id: int,
    day: date,
) -> PersonSource:
    start, end = kyiv_day_bounds(day)
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    warnings: list[str] = []

    tg_messages: list[PersonMessage] = []
    tg_name: Optional[str] = None
    tg_username: Optional[str] = None
    tg_complete = False
    if client is not None and entity is not None:
        try:
            reached_start = False
            seen = 0
            async for msg in client.iter_messages(entity, limit=TELEGRAM_SCAN_LIMIT):
                seen += 1
                if not msg.date:
                    continue
                md = msg.date if msg.date.tzinfo else msg.date.replace(tzinfo=timezone.utc)
                if md > end_utc:
                    continue
                if md < start_utc:
                    reached_start = True
                    break
                if getattr(msg, "sender_id", None) is None or int(msg.sender_id) != int(tg_user_id):
                    continue
                if tg_name is None:
                    sender = await msg.get_sender()
                    if sender is not None:
                        tg_name = _fmt_name(
                            getattr(sender, "first_name", None),
                            getattr(sender, "last_name", None),
                            getattr(sender, "username", None),
                            str(tg_user_id),
                        )
                        tg_username = getattr(sender, "username", None)
                text = (getattr(msg, "message", None) or getattr(msg, "text", None) or "").strip()
                media = "photo" if getattr(msg, "photo", None) else None
                tg_messages.append(
                    PersonMessage(int(msg.id), text, md, media, bool(getattr(msg, "out", False)))
                )
            # історія пройшла до початку дня (або чат коротший за ліміт) — Telegram повний
            tg_complete = reached_start or seen < TELEGRAM_SCAN_LIMIT
            if not tg_complete:
                warnings.append(
                    f"Telegram: переглянуто {TELEGRAM_SCAN_LIMIT} повідомлень і не дійшли до початку дня"
                )
        except Exception as e:  # noqa: BLE001 — FloodWait, мережа, права
            warnings.append(f"Telegram недоступний ({e}); беру збережене в Джурі")
            tg_messages = []
            tg_complete = False

    if tg_complete:
        tg_messages.sort(key=lambda m: (m.date, m.id))
        return PersonSource(tg_messages, tg_name, tg_username, warnings, "telegram")

    dz_messages: list[PersonMessage] = []
    dz_name: Optional[str] = None
    dz_username: Optional[str] = None
    try:
        rows = await db.dzhura_sender_messages(group_id, tg_user_id, start_utc, end_utc)
        for r in rows:
            if dz_name is None:
                dz_name = _fmt_name(r.get("first_name"), r.get("last_name"), r.get("username"), str(tg_user_id))
                dz_username = r.get("username")
            if r.get("deleted"):
                continue
            dz_messages.append(
                PersonMessage(
                    int(r["id"]), (r.get("text") or "").strip(), r["date"], r.get("media"), bool(r.get("outgoing"))
                )
            )
    except Exception as e:  # noqa: BLE001 — таблиць Джури може не бути
        warnings.append(f"База Джури недоступна: {e}")

    merged: dict[int, PersonMessage] = {m.id: m for m in dz_messages}
    for m in tg_messages:  # актуальний текст з Telegram виграє
        merged[m.id] = m
    out = sorted(merged.values(), key=lambda m: (m.date, m.id))
    return PersonSource(
        out,
        tg_name or dz_name,
        tg_username or dz_username,
        warnings,
        "dzhura" if out else "none",
    )


async def reparse_person(
    client,
    entity,
    db: LunchDB,
    *,
    group_id: int,
    tg_user_id: int,
    day: Optional[date] = None,
    notify: bool = True,
) -> dict[str, Any]:
    d = day or today_kyiv()
    day_row = await db.get_or_create_day(d)
    src = await collect_person_messages(
        client, entity, db, group_id=group_id, tg_user_id=tg_user_id, day=d
    )
    stats = ReparseStats()
    uid = str(tg_user_id)
    existing_pid = await db.find_participant_id_by_telegram_id(uid)
    name = src.name or (await db.get_participant_name(existing_pid)) or uid

    extra: dict[str, Any] = {
        "person": {"tgUserId": uid, "name": name},
        "source": src.source,
        "messages": len(src.messages),
        "warnings": src.warnings,
        "replaced": False,
        "placeholder": False,
        "notified": False,
    }

    ctx = DayContext()
    menu, fallback = await ctx.load(db, day_row.id)

    orders: list[tuple[PersonMessage, Any]] = []
    no_match: list[tuple[PersonMessage, Any]] = []
    payments: list[tuple[PersonMessage, Any]] = []
    for pm in src.messages:
        stats.scanned += 1
        if not pm.text:
            stats.skipped += 1
            stats.note(pm.id, name, "", "skipped", SKIP_REASONS["photo"] if pm.media == "photo" else "без тексту")
            continue
        plan = plan_text_message(
            pm.text,
            uid=uid,
            menu=menu,
            fallback=fallback,
            day_closed=False,
            allow_orders_when_closed=True,  # адмін просить явно — навіть якщо день уже закрито
            is_own=pm.outgoing,
        )
        if plan.kind == "order":
            orders.append((pm, plan))
        elif plan.kind == "no_match":
            no_match.append((pm, plan))
        elif plan.kind == "payment":
            payments.append((pm, plan))
        elif plan.kind in ("summary", "mega"):
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", "підсумок дня — для нього є «Розібрати поточний день»")
        else:
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", plan.reason)

    if not orders and not payments and not no_match:
        stats.errors.append("У цієї людини за день не знайдено повідомлень, схожих на замовлення чи оплату")
        return {**stats.as_dict(), **extra}

    pid = await db.upsert_participant(uid, name, f"@{src.username}" if src.username else None)
    had_order = await db.has_active_order(day_row.id, pid)

    if orders:
        # останнє розпізнане повідомлення виграє (як у живому режимі: upsert за людиною)
        extra["replaced"] = had_order
        for pm, plan in orders[:-1]:
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", "перекрите пізнішим замовленням цієї людини")
        for pm, plan in no_match:
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", plan.reason)
        pm, plan = orders[-1]
        result = plan.result
        await db.upsert_order(
            day_row.id,
            pid,
            pm.text,
            result.total_uah,
            result.lines,
            source_message_id=pm.id,
            unmatched_text=result.unmatched_text or None,
        )
        stats.orders += 1
        stats.note(
            pm.id, name, pm.text, "order",
            f"не розпізнано: {result.unmatched_text}" if result.unmatched else "",
        )
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
                reply_to_message_id=pm.id,
            )
            extra["notified"] = True
    elif no_match and not had_order:
        # Нічого не збіглось і замовлення в людини ще немає: лишаємо видимий «порожній» рядок
        # з усім, що вона писала, — адмін відкриє «Редагувати», вибере страви (або «Прибрати»).
        recent = no_match[-PLACEHOLDER_MAX_MESSAGES:]
        last_pm, last_plan = recent[-1]
        await db.upsert_order(
            day_row.id,
            pid,
            "\n".join(pm.text for pm, _ in recent),
            0,
            [],
            source_message_id=last_pm.id,
            unmatched_text="; ".join(" ".join(pm.text.split()) for pm, _ in recent),
        )
        stats.orders += 1
        extra["placeholder"] = True
        for pm, plan in no_match[:-PLACEHOLDER_MAX_MESSAGES]:
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", plan.reason)
        for pm, plan in recent:
            stats.note(pm.id, name, pm.text, "order", "не розпізнано — додано порожнім, виправ вручну: " + plan.reason)
    else:
        for pm, plan in no_match:
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", plan.reason + " (наявне замовлення лишено без змін)")

    for pm, plan in payments:
        if await db.payment_source_exists(day_row.id, pm.id):
            stats.skipped += 1
            stats.note(pm.id, name, pm.text, "skipped", "оплата вже врахована")
            continue
        await db.add_payment(day_row.id, pid, plan.payment.amount_uah, pm.text, source_message_id=pm.id)
        stats.payments += 1
        stats.note(pm.id, name, pm.text, "payment")

    return {**stats.as_dict(), **extra}
