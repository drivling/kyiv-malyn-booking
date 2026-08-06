"""Парсинг тексту замовлення → позиції меню + сума."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from .db import MenuItemRow, OrderLineInput
from .util import normalize_dish_name, split_order_parts


@dataclass
class MatchedPart:
    raw: str
    item: Optional[MenuItemRow]
    score: float


@dataclass
class OrderParseResult:
    lines: list[OrderLineInput]
    total_uah: int
    matched: list[MatchedPart]
    unmatched: list[str]

    @property
    def ok(self) -> bool:
        return len(self.lines) > 0 and len(self.unmatched) == 0


def _token_set(s: str) -> set[str]:
    return {t for t in s.split() if len(t) > 1}


def _similarity(a: str, b: str) -> float:
    """Простий score 0..1: containment + overlap токенів."""
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    if a in b or b in a:
        shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
        return 0.75 + 0.25 * (len(shorter) / max(len(longer), 1))
    ta, tb = _token_set(a), _token_set(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    jacc = inter / union if union else 0.0
    # бонус якщо більшість токенів запиту є в меню
    cover = inter / len(ta) if ta else 0.0
    return max(jacc, cover * 0.9)


def match_part_to_menu(part: str, menu: Sequence[MenuItemRow], min_score: float = 0.45) -> MatchedPart:
    norm = normalize_dish_name(part)
    best: Optional[MenuItemRow] = None
    best_score = 0.0
    for item in menu:
        sc = _similarity(norm, item.name_norm)
        if sc > best_score:
            best_score = sc
            best = item
    if best is None or best_score < min_score:
        return MatchedPart(raw=part, item=None, score=best_score)
    return MatchedPart(raw=part, item=best, score=best_score)


def parse_order(text: str, menu: Sequence[MenuItemRow], min_score: float = 0.45) -> OrderParseResult:
    parts = split_order_parts(text)
    matched: list[MatchedPart] = []
    unmatched: list[str] = []
    lines: list[OrderLineInput] = []
    # агрегуємо qty по menu item id
    by_id: dict[int, OrderLineInput] = {}

    for part in parts:
        m = match_part_to_menu(part, menu, min_score=min_score)
        matched.append(m)
        if m.item is None:
            unmatched.append(part)
            continue
        existing = by_id.get(m.item.id)
        if existing:
            existing.qty += 1
            existing.line_total_uah = existing.qty * existing.unit_price_uah
        else:
            line = OrderLineInput(
                menu_item_id=m.item.id,
                raw_name=part.strip(),
                qty=1,
                unit_price_uah=m.item.price_uah,
                line_total_uah=m.item.price_uah,
            )
            by_id[m.item.id] = line
            lines.append(line)

    total = sum(l.line_total_uah for l in lines)
    return OrderParseResult(lines=lines, total_uah=total, matched=matched, unmatched=unmatched)


def looks_like_order(text: str) -> bool:
    """Грубий фільтр: є роздільники або кілька слів страви, не команда."""
    t = (text or "").strip()
    if not t or t.startswith("!"):
        return False
    if len(t) < 3:
        return False
    # підсумок дня обробляється окремо
    from .parse_summary import looks_like_day_summary

    if looks_like_day_summary(t):
        return False
    low = t.lower()
    if low.startswith(("оплат", "скид", "дякую", "спасибо", "бегом", "даша")):
        return False
    if "|" in t or ";" in t or "\n" in t or "," in t:
        return True
    # одне блюдо: мінімум 3 слова (напр. «рис з овочами»)
    return len(t.split()) >= 3
