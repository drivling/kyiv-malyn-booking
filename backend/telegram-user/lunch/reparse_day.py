"""Повторний розбір повідомлень групи за день (без reply у чат)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from .db import LunchDB, today_kyiv
from .parse_order import looks_like_order, parse_order_contextual
from .parse_payment import looks_like_card_number, parse_payment
from .parse_summary import (
    DOZAZAK_DISPLAY_NAME,
    DOZAZAK_TELEGRAM_ID,
    looks_like_day_summary,
    looks_like_mega_personal_order,
    parse_day_summary,
    synthetic_telegram_id,
)

KYIV = ZoneInfo("Europe/Kyiv")


@dataclass
class ReparseStats:
    scanned: int = 0
    orders: int = 0
    payments: int = 0
    cards: int = 0
    summaries: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "scanned": self.scanned,
            "orders": self.orders,
            "payments": self.payments,
            "cards": self.cards,
            "summaries": self.summaries,
            "skipped": self.skipped,
            "errors": self.errors[:20],
        }


def _reply_to_msg_id(msg) -> Optional[int]:
    rid = getattr(msg, "reply_to_msg_id", None)
    if rid:
        return int(rid)
    reply_to = getattr(msg, "reply_to", None)
    if reply_to is not None:
        inner = getattr(reply_to, "reply_to_msg_id", None)
        if inner:
            return int(inner)
    return None


def collect_confirmation_reply_map(messages: list) -> dict[int, int]:
    """sourceMessageId → останній id нашої confirmation-відповіді."""
    out: dict[int, int] = {}
    for msg in messages:
        if not getattr(msg, "out", False):
            continue
        text = (getattr(msg, "message", None) or getattr(msg, "text", None) or "").strip()
        if not text or not is_system_echo(text):
            continue
        source_id = _reply_to_msg_id(msg)
        if source_id:
            out[source_id] = int(msg.id)
    return out


def is_system_echo(text: str) -> bool:
    """Відповіді нашого listener / адмінки — не парсити як замовлення."""
    t = (text or "").strip()
    if not t:
        return True
    prefixes = (
        "Меню на сьогодні:",
        "Прийом замовлень",
        "Картка для оплати",
        "Боргів немає",
        "Хто ще винен:",
        "Зведення обідів",
        "День закрито",
        "День відкрито",
        "Фото отримано",
        "Не вдалося",
        "Помилка OCR",
        "Нові замовлення не приймаються",
    )
    if t.startswith(prefixes):
        return True
    if ", сьогодні немає:" in t.lower():
        return True
    # «Імʼя, заказ:» / «Імʼя: зараховано»
    if ", заказ:" in t.lower() or "заказ:" in t.lower()[:80]:
        return True
    if ": зараховано " in t.lower():
        return True
    if t.startswith("!") and len(t) < 40:
        return True
    return False


def _display_name(sender) -> str:
    if sender is None:
        return "Невідомий"
    parts = []
    if getattr(sender, "first_name", None):
        parts.append(sender.first_name)
    if getattr(sender, "last_name", None):
        parts.append(sender.last_name)
    if parts:
        return " ".join(parts)
    if getattr(sender, "username", None):
        return f"@{sender.username}"
    return str(getattr(sender, "id", "Невідомий"))


async def apply_day_summary(
    db: LunchDB,
    day_id: int,
    text: str,
    *,
    sender_uid: str,
    sender_name: str,
    sender_username: Optional[str],
    source_message_id: Optional[int],
    stats: ReparseStats,
) -> None:
    parsed = parse_day_summary(text)
    if not parsed.ok:
        stats.skipped += 1
        return
    menu = await db.list_menu_items(day_id)
    fallback = await db.get_fallback_menu(day_id)
    for draft in parsed.named:
        sender_first = (sender_name.split()[0].lower() if sender_name else "")
        draft_l = draft.display_name.strip().lower()
        if sender_uid and draft_l in (sender_name.strip().lower(), sender_first):
            pid = await db.upsert_participant(
                sender_uid, draft.display_name, f"@{sender_username}" if sender_username else None
            )
        else:
            existing = await db.find_participant_id_by_display_name(draft.display_name)
            if existing:
                pid = existing
            else:
                pid = await db.upsert_participant(
                    synthetic_telegram_id(draft.display_name),
                    draft.display_name,
                    None,
                )
        result = parse_order_contextual(draft.raw_text, menu, fallback) if (menu or fallback) else None
        await db.upsert_order(
            day_id,
            pid,
            draft.raw_text,
            result.total_uah if result else 0,
            result.lines if result else [],
            source_message_id=source_message_id,
            unmatched_text=(result.unmatched_text if result else draft.raw_text) or None,
        )
        stats.orders += 1

    if parsed.dozazak_raw:
        pid = await db.upsert_participant(DOZAZAK_TELEGRAM_ID, DOZAZAK_DISPLAY_NAME, None)
        result = parse_order_contextual(parsed.dozazak_raw, menu, fallback) if (menu or fallback) else None
        await db.upsert_order(
            day_id,
            pid,
            parsed.dozazak_raw,
            result.total_uah if result else 0,
            result.lines if result else [],
            source_message_id=source_message_id,
            unmatched_text=(result.unmatched_text if result else parsed.dozazak_raw) or None,
        )
        stats.orders += 1

    await db.set_day_status(day_id, "closed")
    stats.summaries += 1


async def process_text_message(
    db: LunchDB,
    *,
    day_id: int,
    text: str,
    uid: str,
    name: str,
    username: Optional[str],
    message_id: int,
    allow_orders_when_closed: bool,
    stats: ReparseStats,
) -> None:
    if is_system_echo(text):
        stats.skipped += 1
        return

    if looks_like_day_summary(text):
        await apply_day_summary(
            db,
            day_id,
            text,
            sender_uid=uid,
            sender_name=name,
            sender_username=username,
            source_message_id=message_id,
            stats=stats,
        )
        return

    card = looks_like_card_number(text)
    if card and len(text.replace(" ", "")) <= 20:
        async with db.pool.acquire() as conn:
            await conn.execute(
                """UPDATE "LunchDay" SET "payeeCard" = $2, "updatedAt" = NOW() WHERE id = $1""",
                day_id,
                card,
            )
        stats.cards += 1
        return

    pay = parse_payment(text)
    if pay:
        if not uid:
            stats.skipped += 1
            return
        pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
        await db.add_payment(day_id, pid, pay.amount_uah, text, source_message_id=message_id)
        stats.payments += 1
        return

    if not looks_like_order(text):
        stats.skipped += 1
        return

    async with db.pool.acquire() as conn:
        status = await conn.fetchval("""SELECT status FROM "LunchDay" WHERE id = $1""", day_id)
    if status == "closed" and not allow_orders_when_closed:
        stats.skipped += 1
        return

    menu = await db.list_menu_items(day_id)
    fallback = await db.get_fallback_menu(day_id)
    if not menu and not fallback:
        stats.skipped += 1
        return

    result = parse_order_contextual(text, menu, fallback)
    if not result.lines:
        stats.skipped += 1
        return

    dish_count = sum(l.qty for l in result.lines)
    if looks_like_mega_personal_order(dish_count):
        # Підсумок без розпізнаних заголовків — не вішати весь дамп на одну людину
        if looks_like_day_summary(text) or _headerish(text):
            await apply_day_summary(
                db,
                day_id,
                text,
                sender_uid=uid,
                sender_name=name,
                sender_username=username,
                source_message_id=message_id,
                stats=stats,
            )
            return
        stats.skipped += 1
        stats.errors.append(f"msg {message_id}: skipped mega-order ({dish_count} dishes) from {name}")
        return

    if not uid:
        stats.skipped += 1
        return

    pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
    await db.upsert_order(
        day_id,
        pid,
        text,
        result.total_uah,
        result.lines,
        source_message_id=message_id,
        unmatched_text=result.unmatched_text or None,
    )
    stats.orders += 1


def _headerish(text: str) -> bool:
    from lunch.parse_summary import _header_count

    return _header_count(text) >= 2


def kyiv_day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime.combine(d, time.min, tzinfo=KYIV)
    end = datetime.combine(d, time.max, tzinfo=KYIV)
    return start, end


async def reparse_day_with_client(
    client,
    entity,
    db: LunchDB,
    *,
    day: Optional[date] = None,
    clear_orders: bool = True,
) -> ReparseStats:
    """
    Завантажити повідомлення групи за день (Europe/Kyiv) і перепарсити.
    Меню не чіпаємо. clear_orders=True — скинути замовлення/оплати за день.
    """
    from telethon.tl.custom.message import Message

    stats = ReparseStats()
    d = day or today_kyiv()
    day_row = await db.get_or_create_day(d)
    if clear_orders:
        await db.clear_day_orders_and_payments(day_row.id)
        await db.set_day_status(day_row.id, "ordering")

    start, end = kyiv_day_bounds(d)
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)

    messages: list = []
    async for msg in client.iter_messages(entity, limit=500):
        if not msg.date:
            continue
        md = msg.date if msg.date.tzinfo else msg.date.replace(tzinfo=timezone.utc)
        if md > end_utc:
            continue
        if md < start_utc:
            break
        messages.append(msg)

    # хронологічно: старі → нові
    messages.reverse()
    reply_by_source = collect_confirmation_reply_map(messages)

    # до появи підсумку дозволяємо замовлення навіть якщо день був closed до clear
    closed_by_summary = False

    for msg in messages:
        stats.scanned += 1
        try:
            if msg.photo and not (msg.message or msg.text):
                # фото меню на reparse пропускаємо (меню вже в БД з адмінки)
                stats.skipped += 1
                continue
            text = (msg.message or msg.text or "").strip()
            if not text:
                stats.skipped += 1
                continue
            sender = await msg.get_sender()
            name = _display_name(sender)
            uid = str(getattr(sender, "id", "")) if sender else ""
            username = getattr(sender, "username", None) if sender else None

            allow = not closed_by_summary
            before_summaries = stats.summaries
            await process_text_message(
                db,
                day_id=day_row.id,
                text=text,
                uid=uid,
                name=name,
                username=username,
                message_id=msg.id,
                allow_orders_when_closed=allow,
                stats=stats,
            )
            if stats.summaries > before_summaries:
                closed_by_summary = True
        except Exception as e:
            stats.errors.append(f"msg {getattr(msg, 'id', '?')}: {e}")

    if reply_by_source:
        try:
            await db.set_reply_ids_by_source(day_row.id, reply_by_source)
        except Exception as e:
            stats.errors.append(f"reply_ids: {e}")

    return stats
