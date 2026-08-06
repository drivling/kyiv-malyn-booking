"""Тексти відповідей і зведень для групи."""

from __future__ import annotations

from typing import Any, Sequence

from .db import MenuItemRow


def format_menu(items: Sequence[MenuItemRow | tuple[str, int]]) -> str:
    lines = ["Меню на сьогодні:"]
    for it in items:
        if isinstance(it, tuple):
            name, price = it
        else:
            name, price = it.name, it.price_uah
        lines.append(f"• {name} — {price} грн")
    if len(lines) == 1:
        lines.append("(порожньо)")
    return "\n".join(lines)


def format_order_confirm(display_name: str, lines: Sequence[Any], total: int, unmatched: Sequence[str]) -> str:
    parts = [f"{display_name}, заказ:"]
    for line in lines:
        raw = getattr(line, "raw_name", None) or line.get("rawName") or line.get("raw_name")
        qty = getattr(line, "qty", None) or line.get("qty", 1)
        unit = getattr(line, "unit_price_uah", None) or line.get("unitPriceUah") or line.get("unit_price_uah")
        lt = getattr(line, "line_total_uah", None) or line.get("lineTotalUah") or line.get("line_total_uah")
        q = f"×{qty} " if qty and int(qty) > 1 else ""
        parts.append(f"• {q}{raw} — {lt} грн ({unit}/шт)")
    parts.append(f"Разом: {total} грн")
    if unmatched:
        parts.append("Не розпізнав: " + ", ".join(unmatched))
        parts.append("Уточни назви по меню.")
    return "\n".join(parts)


def format_payment_reply(display_name: str, amount: int, ordered: int, paid: int, debt: int) -> str:
    lines = [
        f"{display_name}: зараховано {amount} грн.",
        f"Заказ {ordered} грн, оплачено {paid} грн.",
    ]
    if debt > 0:
        lines.append(f"Залишок боргу: {debt} грн.")
    elif debt < 0:
        lines.append(f"Переплата: {-debt} грн.")
    else:
        lines.append("Розраховано повністю.")
    return "\n".join(lines)


def format_summary(rows: Sequence[dict[str, Any]], day_status: str) -> str:
    if not rows:
        return f"Замовлень немає (день: {day_status})."
    lines = [f"Зведення обідів ({day_status}):", ""]
    grand = 0
    paid_total = 0
    for r in rows:
        name = r["display_name"]
        total = r["total_uah"]
        paid = r["paid_uah"]
        debt = r["debt_uah"]
        grand += total
        paid_total += paid
        dish = ", ".join(
            (ln.get("rawName") or ln.get("raw_name") or "?") for ln in r.get("lines") or []
        )
        mark = "✓" if debt <= 0 else f"борг {debt}"
        lines.append(f"• {name}: {dish} = {total} грн [{mark}]")
    lines.append("")
    lines.append(f"Разом до столової: {grand} грн")
    lines.append(f"Оплачено: {paid_total} грн")
    lines.append(f"Борг загалом: {grand - paid_total} грн")
    return "\n".join(lines)


def format_debts(rows: Sequence[dict[str, Any]]) -> str:
    if not rows:
        return "Боргів немає — усі розраховані."
    lines = ["Хто ще винен:"]
    for r in rows:
        lines.append(f"• {r['display_name']}: {r['debt_uah']} грн (заказ {r['total_uah']}, оплачено {r['paid_uah']})")
    return "\n".join(lines)


def format_day_closed_from_summary(
    named_count: int,
    dozazak: bool,
    totals_uah: int,
    preview_lines: Sequence[str],
) -> str:
    lines = [
        "Прийом замовлень закрито (підсумок).",
        f"Зафіксовано людей: {named_count}" + (" + дозаказ без імені" if dozazak else "") + ".",
        f"Разом ≈ {totals_uah} грн.",
    ]
    if preview_lines:
        lines.append("")
        lines.extend(preview_lines[:20])
        if len(preview_lines) > 20:
            lines.append("…")
    lines.append("")
    lines.append("Нові замовлення не приймаються. !debts — борги, !summary — зведення.")
    return "\n".join(lines)


def format_totals_comment(rows: Sequence[dict[str, Any]]) -> str:
    """Коментар у групу: імʼя, страви, сума (без судочків)."""
    if not rows:
        return "Замовлень немає."
    lines: list[str] = []
    grand = 0
    for r in rows:
        name = r.get("display_name") or r.get("displayName") or "?"
        total = int(r.get("total_uah") if r.get("total_uah") is not None else r.get("totalUah") or 0)
        grand += total
        dishes = ", ".join(
            (ln.get("rawName") or ln.get("raw_name") or "?") for ln in (r.get("lines") or [])
        )
        if not dishes:
            dishes = (r.get("raw_text") or r.get("rawText") or "").replace("\n", ", ")
        lines.append(f"{name}: {dishes} — {total} грн")
    lines.append("")
    lines.append(f"Разом: {grand} грн")
    return "\n".join(lines)
