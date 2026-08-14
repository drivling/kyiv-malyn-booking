"""Тексти відповідей і зведень для групи."""

from __future__ import annotations

from typing import Any, Sequence

from .db import MenuItemRow


def _line_dish_name(line: Any) -> str:
    """Канонічна назва страви з меню (як у адмінці), не сирий фрагмент замовлення."""
    if isinstance(line, dict):
        return (
            line.get("menuItemName")
            or line.get("menu_item_name")
            or line.get("rawName")
            or line.get("raw_name")
            or "?"
        )
    return (
        getattr(line, "menu_item_name", None)
        or getattr(line, "raw_name", None)
        or "?"
    )


def format_menu(items: Sequence[MenuItemRow | tuple[str, int]], tray_price_uah: int = 5) -> str:
    lines = ["Меню на сьогодні:"]
    for it in items:
        if isinstance(it, tuple):
            name, price = it
        else:
            name, price = it.name, it.price_uah
        lines.append(f"• {name} — {price} грн")
    lines.append(f"• Лоток — {tray_price_uah} грн")
    return "\n".join(lines)


def format_order_confirm(
    display_name: str,
    lines: Sequence[Any],
    total: int,
    unmatched: Sequence[str],
    *,
    tray_count: int = 0,
    tray_price_uah: int = 5,
    tray_total_uah: int = 0,
    unavailable: Sequence[str] = (),
) -> str:
    parts = [f"{display_name}, заказ:"]
    for line in lines:
        name = _line_dish_name(line)
        qty = getattr(line, "qty", None) if not isinstance(line, dict) else line.get("qty", 1)
        if qty is None:
            qty = 1
        unit = (
            getattr(line, "unit_price_uah", None)
            if not isinstance(line, dict)
            else line.get("unitPriceUah") or line.get("unit_price_uah")
        )
        lt = (
            getattr(line, "line_total_uah", None)
            if not isinstance(line, dict)
            else line.get("lineTotalUah") or line.get("line_total_uah")
        )
        q = f"×{qty} " if qty and int(qty) > 1 else ""
        parts.append(f"• {q}{name} — {lt} грн ({unit}/шт)")
    if tray_count > 0:
        parts.append(f"Лотки: {tray_count} × {tray_price_uah} = {tray_total_uah} грн")
    parts.append(f"Разом: {total} грн")
    if unavailable:
        parts.append("Сьогодні немає: " + ", ".join(unavailable) + ".")
    if unmatched:
        parts.append("Не розпізнав: " + ", ".join(unmatched))
        parts.append("Уточни назви по меню.")
    return "\n".join(parts)


def format_unavailable(display_name: str, dishes: Sequence[str]) -> str:
    names = ", ".join(dishes)
    return f"{display_name}, сьогодні немає: {names}."


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
        dish = ", ".join(_line_dish_name(ln) for ln in r.get("lines") or [])
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
    """Коментар у групу: імʼя, страви з меню + ціни, сума (як у адмінці)."""
    if not rows:
        return "Замовлень немає."
    lines: list[str] = []
    grand = 0
    for r in rows:
        name = r.get("display_name") or r.get("displayName") or "?"
        total = int(r.get("total_uah") if r.get("total_uah") is not None else r.get("totalUah") or 0)
        grand += total
        dish_bits: list[str] = []
        for ln in r.get("lines") or []:
            dname = _line_dish_name(ln)
            qty = int(ln.get("qty") or 1)
            lt = ln.get("lineTotalUah")
            if lt is None:
                lt = ln.get("line_total_uah")
            q = f"×{qty} " if qty > 1 else ""
            if lt is not None:
                dish_bits.append(f"{q}{dname} — {lt} грн")
            else:
                dish_bits.append(f"{q}{dname}")
        dishes = ", ".join(dish_bits)
        if not dishes:
            dishes = (r.get("raw_text") or r.get("rawText") or "").replace("\n", ", ")
        trays = int(r.get("tray_count") if r.get("tray_count") is not None else r.get("trayCount") or 0)
        tray_sum = int(
            r.get("tray_total_uah") if r.get("tray_total_uah") is not None else r.get("trayTotalUah") or 0
        )
        tray_bit = f"; лотки {trays} = {tray_sum} грн" if trays > 0 else ""
        lines.append(f"{name}: {dishes}{tray_bit} — {total} грн")
    lines.append("")
    lines.append(f"Разом: {grand} грн")
    return "\n".join(lines)
