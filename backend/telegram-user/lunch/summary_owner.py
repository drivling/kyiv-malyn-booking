"""Страви оператора, яких немає ні в чиємусь повідомленні, — з його ж нумерованого підсумку.

Оператор (Святослав) збирає замовлення групи в один список «1. … 2. … 3. …» для столової. Свої
страви він часто пише просто в цей список, окремим повідомленням — ні, тому система його замовлення
не бачить. Якщо після звірки з повідомленнями людей у списку лишається РІВНО ОДИН пункт, якого
ніхто не писав, — це страви автора підсумку.

Обережність важливіша за повноту (хибна прив'язка = чужі гроші у чужому боргу):
  * пункт «пояснений», якщо збігається з повідомленням людини за текстом АБО за набором страв меню;
  * зайвих пунктів має бути рівно один, а пояснено — не менше 60% (і щонайменше два);
  * пункт має повністю розпізнатись за сьогоднішнім меню і мати не більше 5 страв;
  * якщо в автора підсумку вже є замовлення (навіть скасоване) — нічого не робимо;
  * підсумок оператор правлять протягом дня, тому звірка йде вже після розбору всіх повідомлень.
"""

from __future__ import annotations

import math
from typing import Any, Optional, Sequence

from .db import LunchDB
from .formatters import format_order_confirm
from .parse_order import parse_order
from .parse_summary import looks_like_mega_personal_order, order_signature


def _dish_signature(text: str, menu) -> Optional[tuple]:
    r = parse_order(text, menu)
    if not r.lines or r.unmatched or r.ambiguous:
        return None
    return tuple(sorted((l.dish_id or l.menu_item_id, l.qty) for l in r.lines))


def reconcile_entries(
    entries: Sequence[str], known_texts: Sequence[str], menu
) -> tuple[list[int], list[tuple]]:
    """(індекси пунктів без повідомлення людини, підписи повідомлень, що не пояснили жодного пункту)."""
    pool: list[tuple[tuple, Optional[tuple]]] = []
    for t in known_texts:
        ts = order_signature(t)
        if ts:
            pool.append((ts, _dish_signature(t, menu)))
    leftover: list[int] = []
    for i, entry in enumerate(entries):
        ts = order_signature(entry)
        if not ts:
            continue
        ds = _dish_signature(entry, menu)
        hit = next(
            (j for j, (pts, pds) in enumerate(pool) if pts == ts or (ds is not None and pds == ds)),
            None,
        )
        if hit is None:
            leftover.append(i)
        else:
            pool.pop(hit)
    return leftover, [pts for pts, _pds in pool]


def find_unexplained_entries(entries: Sequence[str], known_texts: Sequence[str], menu) -> list[int]:
    """Індекси пунктів підсумку, яких не пояснює жодне повідомлення людей (з урахуванням дублікатів)."""
    return reconcile_entries(entries, known_texts, menu)[0]


async def attribute_summary_leftover(
    db: LunchDB,
    day_id: int,
    menu,
    *,
    entries: Sequence[str],
    known_texts: Sequence[str],
    sender_uid: str,
    sender_name: str,
    sender_username: Optional[str],
    source_message_id: Optional[int],
    notify: bool = True,
) -> dict[str, Any]:
    """Повертає {"status": created|skipped, "reason": ..., "text": ...}. Нічого не кидає й не перезаписує."""
    if not sender_uid or not entries or not menu:
        return {"status": "skipped", "reason": "немає відправника підсумку або меню"}
    leftover, unused = reconcile_entries(entries, known_texts, menu)
    if len(leftover) != 1:
        return {
            "status": "skipped",
            "reason": f"у підсумку {len(leftover)} пунктів без повідомлення людини — "
            "автоматично приписувати автору можна лише один",
        }
    explained = len(entries) - 1
    if explained < max(2, math.ceil(0.6 * len(entries))):
        return {"status": "skipped", "reason": "підсумок майже не збігається з повідомленнями людей"}
    text = entries[leftover[0]]
    # Невикористане повідомлення людини зі спільною стравою — найімовірніше її ж замовлення, яке
    # оператор у підсумку змінив: приписувати це автору підсумку не можна (було б подвійне замовлення).
    parts = set(order_signature(text))
    if any(parts & set(sig) for sig in unused):
        return {
            "status": "skipped",
            "reason": "пункт схожий на змінене замовлення когось із людей — перевір вручну",
            "text": text,
        }
    result = parse_order(text, menu)
    if not result.lines or result.unmatched or result.ambiguous:
        return {"status": "skipped", "reason": "пункт не розпізнано за сьогоднішнім меню", "text": text}
    if looks_like_mega_personal_order(len(result.lines), sum(l.qty for l in result.lines)):
        return {"status": "skipped", "reason": "забагато страв для особистого замовлення", "text": text}
    pid = await db.find_participant_id_by_telegram_id(sender_uid)
    if pid is not None and await db.has_order(day_id, pid):
        return {"status": "skipped", "reason": "у автора підсумку вже є замовлення", "text": text}
    pid = await db.upsert_participant(sender_uid, sender_name, f"@{sender_username}" if sender_username else None)
    trays, tray_sum, grand = await db.apply_trays_to_lines(result.lines)
    await db.upsert_order(
        day_id,
        pid,
        text,
        grand,
        result.lines,
        source_message_id=source_message_id,
        unmatched_text=None,
        tray_count=trays,
        tray_total_uah=tray_sum,
    )
    if notify and source_message_id:
        tray_price = await db.get_tray_price()
        await db.enqueue_outbound(
            format_order_confirm(
                sender_name,
                result.lines,
                grand,
                [],
                tray_count=trays,
                tray_price_uah=tray_price,
                tray_total_uah=tray_sum,
            ),
            reply_to_message_id=source_message_id,
        )
    return {"status": "created", "text": text, "name": sender_name, "total": grand}
