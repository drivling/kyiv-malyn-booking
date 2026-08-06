"""Політика відповідей listener: менше спаму в чаті після обідів / мемів."""

from __future__ import annotations

from enum import Enum

from .parse_summary import looks_like_mega_personal_order


class PersonalOrderAction(str, Enum):
    """Що робити з текстом, схожим на замовлення."""

    IGNORE = "ignore"  # не обід / нічого не розпізнано — мовчати
    DAY_CLOSED = "day_closed"  # розпізнано як обід, але день закритий
    MEGA = "mega"  # схоже на дамп/підсумок
    ACCEPT = "accept"  # записати і підтвердити


def ocr_enabled(openai_api_key: str | None) -> bool:
    """Чи можна OCR меню з фото (інакше на фото взагалі не відповідаємо)."""
    return bool((openai_api_key or "").strip())


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
    if looks_like_mega_personal_order(dish_qty_total):
        return PersonalOrderAction.MEGA
    return PersonalOrderAction.ACCEPT
