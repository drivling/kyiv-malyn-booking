"""Політика відповідей listener: менше спаму в чаті після обідів / мемів."""

from __future__ import annotations

import re
from enum import Enum
from typing import Any

from .formatters import format_order_confirm
from .parse_summary import looks_like_mega_personal_order


class PersonalOrderAction(str, Enum):
    """Що робити з текстом, схожим на замовлення."""

    IGNORE = "ignore"  # не обід / нічого не розпізнано — мовчати
    DAY_CLOSED = "day_closed"  # розпізнано як обід, але день закритий
    MEGA = "mega"  # схоже на дамп/підсумок
    ACCEPT = "accept"  # записати і підтвердити


def ocr_enabled(api_key: str | None) -> bool:
    """Чи можна OCR меню з фото (ANTHROPIC_API_KEY; інакше на фото взагалі не відповідаємо)."""
    return bool((api_key or "").strip())


def decide_personal_order_action(
    *,
    day_status: str,
    matched_line_count: int,
    dish_qty_total: int,
) -> PersonalOrderAction:
    """
    Відповідаємо лише якщо є хоч одна зіставлена страва з меню.
    «Прийом закрито» — тільки для реального розпізнаного замовлення.
    """
    if matched_line_count <= 0:
        return PersonalOrderAction.IGNORE
    if day_status == "closed":
        return PersonalOrderAction.DAY_CLOSED
    # мега = багато різних страв (або дуже багато порцій); «хліб 4 шт» дампом не робить
    if looks_like_mega_personal_order(matched_line_count, dish_qty_total):
        return PersonalOrderAction.MEGA
    return PersonalOrderAction.ACCEPT


async def refresh_order_reply(db: Any, day_id: int, participant_id: int) -> bool:
    """Переписати нашу відповідь на замовлення людини з того, що зараз у БД, з оплатами («✅ Оплатив») —
    правкою, як кнопка «Оплатив» в адмінці. Викликаємо після оплати з чату. False — замовлення чи нашої
    відповіді на нього немає (тоді в групі нічого не міняємо)."""
    order = await db.get_order_for_reply(day_id, participant_id)
    if not order or not order["reply_message_id"]:
        return False
    tray_price = await db.get_tray_price()
    _ordered, paid, _debt = await db.participant_balance(day_id, participant_id)
    lines = [ln for ln in order["lines"] if not ln["unavailable"]]
    text = format_order_confirm(
        order["display_name"],
        lines,
        order["total_uah"],
        [p.strip() for p in re.split(r"[;\n]+", order["unmatched_text"] or "") if p.strip()],
        tray_count=order["tray_count"],
        tray_price_uah=tray_price,
        tray_total_uah=order["tray_total_uah"],
        unavailable=[ln["menuItemName"] for ln in order["lines"] if ln["unavailable"]],
        paid_uah=paid,
    )
    await db.enqueue_outbound(text, kind="edit", telegram_message_id=order["reply_message_id"])
    return True
