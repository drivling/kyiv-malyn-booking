"""Страви оператора, яких немає ні в чиємусь повідомленні, — з його ж нумерованого підсумку.

Оператор (Святослав) збирає замовлення групи в один список «1. … 2. … 3. …» для столової. Свої
страви він часто пише просто в цей список, окремим повідомленням — ні, тому система його замовлення
не бачить. Якщо після звірки з повідомленнями людей у списку лишається РІВНО ОДИН пункт, якого
ніхто не писав, — це страви автора підсумку.

Обережність важливіша за повноту (хибна прив'язка = чужі гроші у чужому боргу):
  * пункт «пояснений», якщо збігається з повідомленням людини за текстом, за тими самими словами в іншому
    розбитті («Пюре Биток Київський» = «Пюре\nБиток Київський») АБО за набором страв меню;
  * порожні пункти «5. 6. 7.» (місця на виріст) не рахуються взагалі;
  * зайвих пунктів має бути рівно один, а пояснено — не менше 60% (і щонайменше два);
  * явна дія адміна («Розібрати» людину / день) знає звичку оператора: свої страви він пише ПЕРШИМ пунктом.
    Тож якщо перший пункт нічий — це його замовлення, навіть коли нічиїх більше (решта лишається на ручну
    перевірку), але пояснено має бути хоча б половину інших пунктів;
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
from .util import normalize_dish_name


def _dish_signature(text: str, menu) -> Optional[tuple]:
    r = parse_order(text, menu)
    if not r.lines or r.unmatched or r.ambiguous:
        return None
    return tuple(sorted((l.dish_id or l.menu_item_id, l.qty) for l in r.lines))


def _word_signature(text: str) -> tuple:
    """Слова тексту без роздільників: оператор переписує замовлення в підсумок по-своєму (рядки ↔ пробіли)."""
    return tuple(sorted(t for t in normalize_dish_name(text).split() if len(t) > 1))


def reconcile_entries(
    entries: Sequence[str], known_texts: Sequence[str], menu
) -> tuple[list[int], list[tuple]]:
    """(індекси пунктів без повідомлення людини, підписи повідомлень, що не пояснили жодного пункту)."""
    pool: list[tuple[tuple, tuple, Optional[tuple]]] = []
    for t in known_texts:
        ts = order_signature(t)
        if ts:
            pool.append((ts, _word_signature(t), _dish_signature(t, menu)))
    leftover: list[int] = []
    for i, entry in enumerate(entries):
        ts = order_signature(entry)
        if not ts:
            continue  # порожній пункт «5.» — місце на виріст
        ws = _word_signature(entry)
        ds = _dish_signature(entry, menu)
        hit = next(
            (
                j
                for j, (pts, pws, pds) in enumerate(pool)
                if pts == ts or (ws and pws == ws) or (ds is not None and pds == ds)
            ),
            None,
        )
        if hit is None:
            leftover.append(i)
        else:
            pool.pop(hit)
    return leftover, [pts for pts, _pws, _pds in pool]


def find_unexplained_entries(entries: Sequence[str], known_texts: Sequence[str], menu) -> list[int]:
    """Індекси пунктів підсумку, яких не пояснює жодне повідомлення людей (з урахуванням дублікатів)."""
    return reconcile_entries(entries, known_texts, menu)[0]


def pick_author_entry(
    entries: Sequence[str], known_texts: Sequence[str], menu, *, first_is_author: bool = False
) -> tuple[Optional[int], str]:
    """Який пункт підсумку — страви його автора: (індекс, "") або (None, причина).

    first_is_author — явна дія адміна: перший нічий пункт віддаємо автору, навіть коли нічиїх кілька."""
    leftover, unused = reconcile_entries(entries, known_texts, menu)
    filled = sum(1 for e in entries if order_signature(e))
    if first_is_author and leftover and leftover[0] == 0:
        explained_others = (filled - 1) - (len(leftover) - 1)
        if explained_others < math.ceil(0.5 * (filled - 1)):
            which = ", ".join(str(i + 1) for i in leftover)
            return None, f"підсумок майже не збігається з повідомленнями людей (нічиї пункти: {which})"
        return 0, ""
    if len(leftover) != 1:
        which = ", ".join(str(i + 1) for i in leftover)
        return None, (
            f"у підсумку {len(leftover)} пунктів без повідомлення людини ({which}) — "
            "автоматично приписувати автору можна лише один"
        )
    explained = filled - 1
    if explained < max(2, math.ceil(0.6 * filled)):
        return None, "підсумок майже не збігається з повідомленнями людей"
    # Невикористане повідомлення людини зі спільною стравою — найімовірніше її ж замовлення, яке
    # оператор у підсумку змінив: приписувати це автору підсумку не можна (було б подвійне замовлення).
    parts = set(order_signature(entries[leftover[0]]))
    if any(parts & set(sig) for sig in unused):
        return None, "пункт схожий на змінене замовлення когось із людей — перевір вручну"
    return leftover[0], ""


def parse_author_entry(text: str, menu) -> tuple[Optional[Any], str]:
    """Пункт автора має повністю розпізнатись за меню й бути схожим на особисте замовлення."""
    result = parse_order(text, menu)
    if not result.lines or result.unmatched or result.ambiguous:
        return None, "пункт не розпізнано за сьогоднішнім меню"
    if looks_like_mega_personal_order(len(result.lines), sum(l.qty for l in result.lines)):
        return None, "забагато страв для особистого замовлення"
    return result, ""


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
    first_is_author: bool = False,
) -> dict[str, Any]:
    """Повертає {"status": created|skipped, "reason": ..., "text": ...}. Нічого не кидає й не перезаписує."""
    if not sender_uid or not entries or not menu:
        return {"status": "skipped", "reason": "немає відправника підсумку або меню"}
    idx, reason = pick_author_entry(entries, known_texts, menu, first_is_author=first_is_author)
    if idx is None:
        return {"status": "skipped", "reason": reason}
    text = entries[idx]
    result, reason = parse_author_entry(text, menu)
    if result is None:
        return {"status": "skipped", "reason": reason, "text": text}
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
