"""Парсинг підсумкового повідомлення Святослава (цитати + дозаказ)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .util import normalize_dish_name, split_order_parts

# > Диана:  або  > Дар'я Шулдик:
_QUOTE_HEADER_RE = re.compile(r"^>\s*(.+?)\s*:\s*$", re.UNICODE)
# інколи імʼя і текст в одному рядку: > Marta: пюре, голубці
_QUOTE_INLINE_RE = re.compile(r"^>\s*(.+?)\s*:\s*(.+)$", re.UNICODE)


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


def looks_like_day_summary(text: str) -> bool:
    """Підсумок дня: кілька цитат > Імʼя: …"""
    if not text or ">" not in text:
        return False
    headers = 0
    for line in text.splitlines():
        s = line.strip()
        if _QUOTE_HEADER_RE.match(s) or _QUOTE_INLINE_RE.match(s):
            headers += 1
    return headers >= 2


def _name_key(name: str) -> str:
    return normalize_dish_name(name)


def order_signature(text: str) -> tuple[str, ...]:
    """Мультимножина нормалізованих страв (відсортована)."""
    # рядки без ком — теж страви
    parts = split_order_parts(text.replace("\n", ","))
    norms = [_name_key(p) for p in parts if p.strip()]
    return tuple(sorted(n for n in norms if n))


def _split_blocks(body: str) -> list[str]:
    chunks = re.split(r"\n\s*\n+", (body or "").strip())
    return [c.strip() for c in chunks if c.strip()]


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
        raw = line.rstrip()
        s = raw.strip()
        m_h = _QUOTE_HEADER_RE.match(s)
        m_i = _QUOTE_INLINE_RE.match(s) if not m_h else None
        if m_h:
            flush()
            current_name = m_h.group(1).strip()
            current_lines = []
            continue
        if m_i:
            flush()
            current_name = m_i.group(1).strip()
            current_lines = [m_i.group(2).strip()]
            continue
        if current_name is not None:
            # прибрати зайвий префікс > у тілі цитати
            if s.startswith(">"):
                s = s.lstrip(">").strip()
            current_lines.append(s if s or current_lines else "")
        # текст до першої цитати ігноруємо

    flush()
    return [(n, b) for n, b in sections if n]


def parse_day_summary(text: str) -> DaySummaryParse:
    """
    Розбирає підсумок:
    - іменовані цитати → named orders
    - у останньої цитати: перший блок = замовлення людини, наступні блоки = дамп;
      блоки дампу, які не збігаються з уже відомими замовленнями → дозаказ без імені.
    """
    sections = _parse_quote_sections(text)
    if len(sections) < 2:
        return DaySummaryParse()

    named: list[NamedOrderDraft] = []
    remainder_blocks: list[str] = []

    for idx, (name, body) in enumerate(sections):
        is_last = idx == len(sections) - 1
        blocks = _split_blocks(body)
        if not blocks:
            continue
        if is_last and len(blocks) > 1:
            # перший блок — замовлення автора підсумку (Святослав)
            named.append(NamedOrderDraft(display_name=name, raw_text=blocks[0]))
            remainder_blocks.extend(blocks[1:])
        else:
            named.append(NamedOrderDraft(display_name=name, raw_text="\n".join(blocks)))

    # звірки дампу зі відомими замовленнями
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
        # чи вже є таке замовлення серед іменованих (використати один раз)
        matched_i = None
        for i, us in enumerate(used_sigs):
            if us == sig:
                matched_i = i
                break
        if matched_i is not None:
            used_sigs.pop(matched_i)
            continue
        # частковий match: якщо всі страви блоку є в якомусь іменованому — теж skip
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
