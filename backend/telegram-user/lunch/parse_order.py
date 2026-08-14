"""Парсинг тексту замовлення → позиції меню + сума."""

from __future__ import annotations

from dataclasses import dataclass, field
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
    unavailable: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return len(self.lines) > 0 and len(self.unmatched) == 0 and len(self.unavailable) == 0

    @property
    def unmatched_text(self) -> str:
        return "; ".join(self.unmatched)


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
        return 0.72 + 0.28 * (len(shorter) / max(len(longer), 1))
    ta, tb = _token_set(a), _token_set(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    jacc = inter / union if union else 0.0
    cover_a = inter / len(ta) if ta else 0.0
    cover_b = inter / len(tb) if tb else 0.0
    # якщо більшість слів запиту є в назві меню (навіть якщо меню довше)
    return max(jacc, cover_a * 0.92, min(cover_a, cover_b) * 0.95)


def match_part_to_menu(part: str, menu: Sequence[MenuItemRow], min_score: float = 0.42) -> MatchedPart:
    norm = normalize_dish_name(part)
    best: Optional[MenuItemRow] = None
    best_score = 0.0
    for item in menu:
        candidates = [item.name_norm, *getattr(item, "synonym_norms", ())]
        for cand in candidates:
            if not cand:
                continue
            sc = _similarity(norm, cand)
            if sc > best_score:
                best_score = sc
                best = item
    if best is None or best_score < min_score:
        return MatchedPart(raw=part, item=None, score=best_score)
    return MatchedPart(raw=part, item=best, score=best_score)


def _try_split_hard_unmatched(part: str) -> list[str]:
    """Додатковий розпил нерозпізнаного фрагмента."""
    # «бифштекс с яйцом печень оладьи» без подвійних пробілів — евристика по ключових словах
    low = normalize_dish_name(part)
    markers = [
        "біфштекс",
        "бифштекс",
        "печінкові",
        "печень",
        "оладки",
        "оладьи",
        "котлети",
        "філе",
        "суп",
        "салат",
        "пюре",
        "гречка",
        "рис",
        "овочі",
        "сирники",
        "вареники",
    ]
    # якщо є 2+ маркери — ріжемо перед другим і далі
    positions: list[tuple[int, str]] = []
    for m in markers:
        idx = low.find(m)
        if idx >= 0:
            positions.append((idx, m))
    positions.sort()
    if len(positions) < 2:
        return [part]
    # розрізати оригінал пропорційно? простіше: split по знайдених маркерах у norm і map назад — важко.
    # Ріжемо low і беремо шматки як окремі parts (вже нормалізовані тексти ок для match)
    cuts = [p[0] for p in positions]
    pieces: list[str] = []
    for i, start in enumerate(cuts):
        end = cuts[i + 1] if i + 1 < len(cuts) else len(low)
        piece = low[start:end].strip()
        if piece:
            pieces.append(piece)
    return pieces if len(pieces) >= 2 else [part]


def parse_order(text: str, menu: Sequence[MenuItemRow], min_score: float = 0.42) -> OrderParseResult:
    parts = split_order_parts(text)
    matched: list[MatchedPart] = []
    unmatched: list[str] = []
    lines: list[OrderLineInput] = []
    by_id: dict[int, OrderLineInput] = {}

    def add_match(m: MatchedPart) -> None:
        matched.append(m)
        if m.item is None:
            unmatched.append(m.raw)
            return
        key = getattr(m.item, "dish_id", None) or m.item.id
        existing = by_id.get(key)
        if existing:
            existing.qty += 1
            existing.line_total_uah = existing.qty * existing.unit_price_uah
        else:
            line = OrderLineInput(
                menu_item_id=m.item.id,
                dish_id=getattr(m.item, "dish_id", None),
                # Канонічна назва з меню (як у ручному редагуванні в адмінці)
                raw_name=m.item.name,
                as_written=m.raw,
                qty=1,
                unit_price_uah=m.item.price_uah,
                line_total_uah=m.item.price_uah,
                tray_role=getattr(m.item, "tray_role", None) or "second",
            )
            by_id[key] = line
            lines.append(line)

    for part in parts:
        m = match_part_to_menu(part, menu, min_score=min_score)
        if m.item is not None:
            add_match(m)
            continue
        # друга спроба: розпил «яйцом  печень» / «яйцом печень оладьи»
        refined = False
        for sub in _try_split_hard_unmatched(part):
            if sub.strip() == part.strip():
                continue
            m2 = match_part_to_menu(sub, menu, min_score=min_score)
            if m2.item is not None:
                add_match(MatchedPart(raw=sub, item=m2.item, score=m2.score))
                refined = True
            else:
                add_match(MatchedPart(raw=sub, item=None, score=m2.score))
                refined = True
        if not refined:
            add_match(m)

    total = sum(l.line_total_uah for l in lines)
    # прибрати з unmatched порожні / дублікати після успішного match того ж raw
    unmatched = [u for u in unmatched if u and u.strip()]
    return OrderParseResult(lines=lines, total_uah=total, matched=matched, unmatched=unmatched)


def parse_order_contextual(
    text: str,
    today_menu: Sequence[MenuItemRow],
    fallback_menu: Sequence[MenuItemRow] | None = None,
    *,
    today_published: bool = True,
    min_score: float = 0.42,
) -> OrderParseResult:
    """
    Сьогоднішнє меню + fallback (вчора).
    Якщо сьогоднішнього ще немає — тихо приймаємо з вчорашнього.
    Якщо сьогодні вже є, а страва лише з вчора — unavailable (не в заказ).
    """
    fallback_menu = fallback_menu or []
    if today_menu:
        today_published = True
        result = parse_order(text, today_menu, min_score=min_score)
        if not fallback_menu:
            return result
        leftover = list(result.unmatched)
        if not leftover:
            return result
        unavailable: list[str] = []
        still_unmatched: list[str] = []
        extra_matched: list[MatchedPart] = []
        for part in leftover:
            extra = parse_order(part, fallback_menu, min_score=min_score)
            extra_matched.extend(extra.matched)
            if extra.lines:
                unavailable.extend(ln.raw_name for ln in extra.lines)
            still_unmatched.extend(extra.unmatched)
        return OrderParseResult(
            lines=result.lines,
            total_uah=result.total_uah,
            matched=result.matched + extra_matched,
            unmatched=still_unmatched,
            unavailable=unavailable,
        )

    if fallback_menu:
        # Меню сьогодні ще немає — тихо з вчорашнього
        return parse_order(text, fallback_menu, min_score=min_score)

    return parse_order(text, [], min_score=min_score)


def looks_like_order(text: str) -> bool:
    """Грубий фільтр: є роздільники або кілька слів страви, не команда."""
    t = (text or "").strip()
    if not t or t.startswith("!"):
        return False
    if len(t) < 3:
        return False
    from .parse_summary import looks_like_day_summary

    if looks_like_day_summary(t):
        return False
    low = t.lower()
    if low.startswith(("оплат", "скид", "дякую", "спасибо", "бегом", "даша")):
        return False
    if "|" in t or ";" in t or "\n" in t or "," in t:
        return True
    return len(t.split()) >= 3
