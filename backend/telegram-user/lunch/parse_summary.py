"""Парсинг підсумкового повідомлення Святослава (цитати + дозаказ)."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from .util import normalize_dish_name, split_order_parts

# > Диана:  або  > Дар'я Шулдик:
_QUOTE_HEADER_RE = re.compile(r"^>\s*(.+?)\s*:\s*$", re.UNICODE)
_QUOTE_INLINE_RE = re.compile(r"^>\s*(.+?)\s*:\s*(.+)$", re.UNICODE)
# Без «>» — як часто приходить з Telethon / копіпасту
_BARE_HEADER_RE = re.compile(
    r"^([A-Za-zА-Яа-яЁёІіЇїЄєҐґʼ'’\-][A-Za-zА-Яа-яЁёІіЇїЄєҐґʼ'’\-\s]{1,40})\s*:\s*$",
    re.UNICODE,
)
_BARE_INLINE_RE = re.compile(
    r"^([A-Za-zА-Яа-яЁёІіЇїЄєҐґʼ'’\-][A-Za-zА-Яа-яЁёІіЇїЄєҐґʼ'’\-\s]{1,40})\s*:\s+(.+)$",
    re.UNICODE,
)

# Особисте замовлення рідко > 5 позицій; більше — підозра на дамп/підсумок
MAX_PERSONAL_DISHES = 5


@dataclass
class NamedOrderDraft:
    display_name: str
    raw_text: str


@dataclass
class DaySummaryParse:
    named: list[NamedOrderDraft] = field(default_factory=list)
    dozazak_raw: str | None = None
    """Текст дозамовлення без імені (якщо є залишок після звірки)."""

    @property
    def ok(self) -> bool:
        return len(self.named) >= 2


def _header_count(text: str) -> int:
    n = 0
    for line in (text or "").splitlines():
        s = line.strip()
        if (
            _QUOTE_HEADER_RE.match(s)
            or _QUOTE_INLINE_RE.match(s)
            or _is_bare_header(s)
            or _BARE_INLINE_RE.match(s)
        ):
            n += 1
    return n


def _is_bare_header(s: str) -> bool:
    m = _BARE_HEADER_RE.match(s)
    if not m:
        return False
    name = m.group(1).strip().lower()
    # не плутати з «меню:» / короткими службовими
    if name in ("меню", "разом", "итого", "підсумок", "заказ", "замовлення", "суп", "салат"):
        return False
    return len(name) >= 2


def looks_like_day_summary(text: str) -> bool:
    """Підсумок дня: кілька цитат / блоків з іменами."""
    if not text or not text.strip():
        return False
    if _header_count(text) >= 2:
        return True
    # багато блоків через порожній рядок + багато рядків страв
    blocks = _split_blocks(text)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(blocks) >= 4 and len(lines) >= 8:
        return True
    return False


def looks_like_mega_personal_order(dish_count: int) -> bool:
    return dish_count > MAX_PERSONAL_DISHES


def _name_key(name: str) -> str:
    return normalize_dish_name(name)


def order_signature(text: str) -> tuple[str, ...]:
    """Мультимножина нормалізованих страв (відсортована)."""
    parts = split_order_parts(text.replace("\n", ","))
    norms = [_name_key(p) for p in parts if p.strip()]
    return tuple(sorted(n for n in norms if n))


def _split_blocks(body: str) -> list[str]:
    chunks = re.split(r"\n\s*\n+", (body or "").strip())
    return [c.strip() for c in chunks if c.strip()]


def _match_header(s: str) -> tuple[str, str | None] | None:
    """Повертає (name, inline_body|None) або None."""
    m = _QUOTE_HEADER_RE.match(s)
    if m:
        return m.group(1).strip(), None
    m = _QUOTE_INLINE_RE.match(s)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    if _is_bare_header(s):
        m2 = _BARE_HEADER_RE.match(s)
        if m2:
            return m2.group(1).strip(), None
    m = _BARE_INLINE_RE.match(s)
    if m:
        name = m.group(1).strip()
        if name.lower() not in ("меню", "разом", "суп", "салат", "итого", "підсумок"):
            return name, m.group(2).strip()
    return None


def _parse_quote_sections(text: str) -> list[tuple[str, str]]:
    """Повертає [(display_name, body), ...] у порядку появи."""
    lines = (text or "").splitlines()
    sections: list[tuple[str, list[str]]] = []
    current_name: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_name, current_lines
        if current_name is not None:
            body = "\n".join(current_lines).strip()
            sections.append((current_name, body))
        current_name = None
        current_lines = []

    for line in lines:
        s = line.strip()
        hdr = _match_header(s)
        if hdr:
            flush()
            current_name, inline = hdr
            current_lines = [inline] if inline else []
            continue
        if current_name is not None:
            if s.startswith(">"):
                s = s.lstrip(">").strip()
            current_lines.append(s)
        # текст до першої цитати ігноруємо

    flush()
    return [(n, b) for n, b in sections if n]


def _sig_counter(sig: tuple[str, ...]) -> Counter:
    return Counter(sig)


def _rest_covered_by_known(rest_dishes: list[str], known_sigs: list[tuple[str, ...]]) -> bool:
    """Чи решта страв приблизно = обʼєднання відомих заказів (з дублікатами)."""
    if not rest_dishes:
        return True
    rest = _sig_counter(order_signature("\n".join(rest_dishes)))
    if not rest:
        return True
    known = Counter()
    for s in known_sigs:
        known.update(s)
    if not known:
        return False
    # Страви з «запечене» тощо можуть трохи відрізнятись — дозволяємо 2 extra
    extra = sum((rest - known).values())
    # дамп має покривати більшість known або бути його підмножиною
    overlap = sum((rest & known).values())
    return extra <= 2 and overlap >= max(2, int(sum(rest.values()) * 0.6))


def _split_last_body(
    body: str, prior_named: list[NamedOrderDraft]
) -> tuple[str, list[str]]:
    """
    Перший блок / префікс — особисте замовлення останнього (Святослав),
    решта — дамп для столової.
    """
    blocks = _split_blocks(body)
    if len(blocks) > 1:
        return blocks[0], blocks[1:]

    dishes = [ln.strip() for ln in (body or "").splitlines() if ln.strip()]
    if not dishes:
        return "", []

    known_sigs = [order_signature(n.raw_text) for n in prior_named if n.raw_text.strip()]
    # Мало рядків і немає з чим звіряти дамп — усе особисте
    if len(dishes) <= 2 and not known_sigs:
        return "\n".join(dishes), []

    # Prefer larger personal order that still covers dump (2 dishes typical)
    if known_sigs and len(dishes) > 2:
        best_cut = None
        for cut in range(1, min(MAX_PERSONAL_DISHES, len(dishes) - 1) + 1):
            if _rest_covered_by_known(dishes[cut:], known_sigs):
                best_cut = cut  # keep last matching — prefer more personal dishes
        if best_cut is not None:
            personal = "\n".join(dishes[:best_cut])
            dump = dishes[best_cut:]
            return personal, ["\n".join(dump)] if dump else []

    # немає відомих заказів або не вдалося покрити — обрізаємо особисте
    if len(dishes) > MAX_PERSONAL_DISHES:
        personal = "\n".join(dishes[:MAX_PERSONAL_DISHES])
        dump = dishes[MAX_PERSONAL_DISHES:]
        return personal, ["\n".join(dump)] if dump else []
    return "\n".join(dishes), []


def parse_day_summary(text: str) -> DaySummaryParse:
    """
    Розбирає підсумок:
    - іменовані цитати → named orders
    - у останньої цитати: особисте замовлення + дамп;
      блоки дампу, які не збігаються з уже відомими → дозаказ без імені.
    """
    sections = _parse_quote_sections(text)
    if len(sections) < 2:
        return DaySummaryParse()

    named: list[NamedOrderDraft] = []
    remainder_blocks: list[str] = []

    for idx, (name, body) in enumerate(sections):
        is_last = idx == len(sections) - 1
        if not body.strip() and not is_last:
            continue
        if is_last:
            personal, dump_blocks = _split_last_body(body, named)
            if personal.strip():
                named.append(NamedOrderDraft(display_name=name, raw_text=personal))
            remainder_blocks.extend(dump_blocks)
        else:
            blocks = _split_blocks(body)
            named.append(NamedOrderDraft(display_name=name, raw_text="\n".join(blocks) if blocks else body))

    used_sigs: list[tuple[str, ...]] = []
    for n in named:
        sig = order_signature(n.raw_text)
        if sig:
            used_sigs.append(sig)

    dozazak_parts: list[str] = []
    for block in remainder_blocks:
        sig = order_signature(block)
        if not sig:
            continue
        matched_i = None
        for i, us in enumerate(used_sigs):
            if us == sig:
                matched_i = i
                break
        if matched_i is not None:
            used_sigs.pop(matched_i)
            continue
        fuzzy_hit = False
        for i, us in enumerate(used_sigs):
            if set(sig).issubset(set(us)) or set(us).issubset(set(sig)):
                if len(set(sig) & set(us)) >= max(1, min(len(sig), len(us))):
                    used_sigs.pop(i)
                    fuzzy_hit = True
                    break
        if fuzzy_hit:
            continue
        dozazak_parts.append(block)

    dozazak_raw = "\n\n".join(dozazak_parts).strip() if dozazak_parts else None
    return DaySummaryParse(named=named, dozazak_raw=dozazak_raw or None)


def synthetic_telegram_id(display_name: str) -> str:
    """Стабільний id для учасника, відомого лише з цитати."""
    return "name:" + (_name_key(display_name) or "unknown")


DOZAZAK_DISPLAY_NAME = "Дозаказ (без імені)"
DOZAZAK_TELEGRAM_ID = "name:dozazak"
