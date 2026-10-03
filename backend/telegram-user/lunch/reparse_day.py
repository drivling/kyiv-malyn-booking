"""Повторний розбір повідомлень групи за день (без reply у чат)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from typing import Any, Optional, Sequence
from zoneinfo import ZoneInfo

from .db import LunchDB, MenuItemRow, today_kyiv
from .parse_order import OrderParseResult, looks_like_order, parse_order_contextual
from .parse_payment import PaymentParseResult, looks_like_card_number, parse_payment
from .parse_summary import (
    DOZAZAK_DISPLAY_NAME,
    DOZAZAK_TELEGRAM_ID,
    looks_like_day_summary,
    looks_like_mega_personal_order,
    parse_day_summary,
    parse_numbered_summary,
    synthetic_telegram_id,
)

KYIV = ZoneInfo("Europe/Kyiv")


# Скільки рядків «що сталося з повідомленням» віддаємо в адмінку (job result — це текст у БД).
MAX_DETAILS = 120
_SNIPPET_LEN = 140

# Людською мовою, чому повідомлення не стало замовленням (показуємо в адмінці після розбору).
SKIP_REASONS = {
    "echo": "службова відповідь бота",
    "not_order": "не схоже на замовлення (команда, подяка, надто коротко)",
    "closed": "день уже закрито підсумком",
    "no_menu": "на сьогодні немає меню (і вчорашнього теж)",
    "no_match": "жодна страва не збіглась з меню",
    "mega": "забагато страв — схоже на підсумок, а не на особисте замовлення",
    "no_sender": "невідомий відправник",
    "photo": "фото без підпису",
    "summary_unparsed": "схоже на підсумок, але не вдалося розібрати",
    "deleted": "повідомлення видалене",
}


@dataclass
class ReparseStats:
    scanned: int = 0
    orders: int = 0
    payments: int = 0
    cards: int = 0
    summaries: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)
    # Для діагностики «чому повідомлення проігноровано»: [{messageId, name, text, outcome, reason}]
    details: list[dict[str, Any]] = field(default_factory=list)

    def note(
        self,
        message_id: Optional[int],
        name: str,
        text: str,
        outcome: str,
        reason: str = "",
    ) -> None:
        if outcome == "skipped" and reason == SKIP_REASONS["echo"]:
            return  # відповіді бота не цікаві й засмічують звіт
        if len(self.details) >= MAX_DETAILS:
            return
        snippet = " ".join((text or "").split())
        if len(snippet) > _SNIPPET_LEN:
            snippet = snippet[: _SNIPPET_LEN - 1] + "…"
        self.details.append(
            {
                "messageId": message_id,
                "name": name,
                "text": snippet,
                "outcome": outcome,
                "reason": reason,
            }
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "scanned": self.scanned,
            "orders": self.orders,
            "payments": self.payments,
            "cards": self.cards,
            "summaries": self.summaries,
            "skipped": self.skipped,
            "errors": self.errors[:20],
            "details": self.details,
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


@dataclass
class DayContext:
    """Меню дня й вчорашнє меню — читаємо один раз на прохід, а не на кожне повідомлення."""

    menu: Optional[list[MenuItemRow]] = None
    fallback: Optional[list[MenuItemRow]] = None

    async def load(self, db: LunchDB, day_id: int) -> tuple[list[MenuItemRow], list[MenuItemRow]]:
        if self.menu is None:
            self.menu = await db.list_menu_items(day_id)
        if self.fallback is None:
            self.fallback = await db.get_fallback_menu(day_id)
        return self.menu, self.fallback


@dataclass
class MessagePlan:
    """Що робити з текстовим повідомленням (без побічних ефектів — тільки рішення)."""

    kind: str  # echo | summary | card | payment | not_order | closed | no_menu | no_match | mega | no_sender | order
    card: Optional[str] = None
    payment: Optional[PaymentParseResult] = None
    result: Optional[OrderParseResult] = None

    @property
    def reason(self) -> str:
        if self.kind == "no_match" and self.result is not None and self.result.unavailable:
            return "страви немає в сьогоднішньому меню: " + ", ".join(self.result.unavailable)
        if self.kind == "no_match" and self.result is not None and self.result.ambiguous:
            parts = [f"«{raw}» — {' або '.join(opts)}" for raw, opts in self.result.ambiguous.items()]
            return "неоднозначно: " + "; ".join(parts)
        return SKIP_REASONS.get(self.kind, self.kind)


def plan_text_message(
    text: str,
    *,
    uid: str,
    menu: Sequence[MenuItemRow],
    fallback: Sequence[MenuItemRow],
    day_closed: bool,
    allow_orders_when_closed: bool,
    is_own: bool = False,
) -> MessagePlan:
    # «Службова відповідь бота» — це лише повідомлення з нашого акаунта. Раніше фільтр діяв на всіх:
    # чуже «Заказ: пюре, котлета» у розборі дня вважалось ехом бота й тихо губилось (а наживо
    # приймалось) — «розбір дня не бачить» замовлення.
    if is_own and is_system_echo(text):
        return MessagePlan("echo")
    if looks_like_day_summary(text):
        return MessagePlan("summary")
    card = looks_like_card_number(text)
    if card and len(text.replace(" ", "")) <= 20:
        return MessagePlan("card", card=card)
    pay = parse_payment(text)
    if pay:
        return MessagePlan("payment" if uid else "no_sender", payment=pay)
    if not looks_like_order(text):
        return MessagePlan("not_order")
    if day_closed and not allow_orders_when_closed:
        return MessagePlan("closed")
    if not menu and not fallback:
        return MessagePlan("no_menu")
    result = parse_order_contextual(text, menu, fallback)
    if not result.lines:
        return MessagePlan("no_match", result=result)
    if looks_like_mega_personal_order(len(result.lines), sum(l.qty for l in result.lines)):
        return MessagePlan("mega", result=result)
    if not uid:
        return MessagePlan("no_sender", result=result)
    return MessagePlan("order", result=result)


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
    ctx: Optional[DayContext] = None,
    is_own: bool = False,
) -> None:
    status = await db.get_day_status(day_id)
    menu, fallback = await (ctx or DayContext()).load(db, day_id)
    plan = plan_text_message(
        text,
        uid=uid,
        menu=menu,
        fallback=fallback,
        day_closed=status == "closed",
        allow_orders_when_closed=allow_orders_when_closed,
        is_own=is_own,
    )

    if plan.kind == "summary":
        before = stats.orders
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
        stats.note(
            message_id, name, text,
            "summary" if stats.orders > before else "skipped",
            "" if stats.orders > before else SKIP_REASONS["summary_unparsed"],
        )
        return

    if plan.kind == "card" and plan.card:
        await db.set_payee_card(day_id, plan.card)
        stats.cards += 1
        stats.note(message_id, name, text, "card")
        return

    if plan.kind == "payment" and plan.payment:
        pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
        await db.add_payment(day_id, pid, plan.payment.amount_uah, text, source_message_id=message_id)
        stats.payments += 1
        stats.note(message_id, name, text, "payment")
        return

    if plan.kind == "mega":
        # Підсумок без розпізнаних заголовків — не вішати весь дамп на одну людину
        if _headerish(text):
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
            stats.note(message_id, name, text, "summary")
            return
        dish_count = sum(l.qty for l in plan.result.lines) if plan.result else 0
        stats.skipped += 1
        stats.errors.append(f"msg {message_id}: skipped mega-order ({dish_count} dishes) from {name}")
        stats.note(message_id, name, text, "skipped", plan.reason)
        return

    if plan.kind == "order" and plan.result is not None:
        result = plan.result
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
        reason = f"не розпізнано: {result.unmatched_text}" if result.unmatched else ""
        stats.note(message_id, name, text, "order", reason)
        return

    stats.skipped += 1
    stats.note(message_id, name, text, "skipped", plan.reason)


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
    ctx = DayContext()
    numbered_summaries: list[dict[str, Any]] = []
    person_texts: list[str] = []

    for msg in messages:
        stats.scanned += 1
        try:
            if msg.photo and not (msg.message or msg.text):
                # фото меню на reparse пропускаємо (меню вже в БД з адмінки)
                stats.skipped += 1
                stats.note(msg.id, _display_name(await msg.get_sender()), "", "skipped", SKIP_REASONS["photo"])
                continue
            text = (msg.message or msg.text or "").strip()
            if not text:
                stats.skipped += 1
                continue
            sender = await msg.get_sender()
            name = _display_name(sender)
            uid = str(getattr(sender, "id", "")) if sender else ""
            username = getattr(sender, "username", None) if sender else None

            # Нумерований підсумок оператора («1. … 2. …») — звіримо з повідомленнями людей ПІСЛЯ проходу
            # (його правлять протягом дня, у ньому є замовлення, що прийшли пізніше за час повідомлення).
            numbered = parse_numbered_summary(text)
            if numbered and not parse_day_summary(text).ok:
                numbered_summaries.append(
                    {"entries": numbered, "uid": uid, "name": name, "username": username, "msg_id": int(msg.id)}
                )
            elif not (getattr(msg, "out", False) and is_system_echo(text)):
                person_texts.append(text)

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
                ctx=ctx,
                is_own=bool(getattr(msg, "out", False)),
            )
            if stats.summaries > before_summaries:
                closed_by_summary = True
        except Exception as e:
            stats.errors.append(f"msg {getattr(msg, 'id', '?')}: {e}")

    if numbered_summaries:
        try:
            from .summary_owner import attribute_summary_leftover

            last = numbered_summaries[-1]
            menu_now, _fallback = await ctx.load(db, day_row.id)
            info = await attribute_summary_leftover(
                db,
                day_row.id,
                menu_now,
                entries=last["entries"],
                known_texts=person_texts,
                sender_uid=last["uid"],
                sender_name=last["name"],
                sender_username=last["username"],
                source_message_id=last["msg_id"],
                notify=False,  # розбір дня мовчки, як і решта
            )
            if info["status"] == "created":
                stats.orders += 1
                stats.note(
                    last["msg_id"], last["name"], info.get("text", ""), "order",
                    "замовлення автора підсумку (пункт списку без повідомлення людини)",
                )
            else:
                stats.note(last["msg_id"], last["name"], "[підсумок списком]", "skipped", info.get("reason", ""))
        except Exception as e:  # noqa: BLE001
            stats.errors.append(f"numbered summary: {e}")

    if reply_by_source:
        try:
            await db.set_reply_ids_by_source(day_row.id, reply_by_source)
        except Exception as e:
            stats.errors.append(f"reply_ids: {e}")

    return stats
