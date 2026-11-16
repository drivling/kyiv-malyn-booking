"""Парсинг повідомлень про оплату: «оплатив 150», «Оплата 175», «!pay 150»."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


_PAY_RE = re.compile(
    r"(?:"
    # «оплата 175» / «оплатила 90» / «оплачено 50»
    r"оплат(?:а|ив|ила|или|ил|ено)\s*[:=]?\s*"
    r"|сплат(?:а|ив|ила|ил)\s*[:=]?\s*"
    r"|кинув\s*"
    r"|кинула\s*"
    r"|!pay\s*"
    r"|/pay\s*"
    r")"
    r"(\d{1,5})"
    r"(?:\s*(?:грн|uah|₴))?",
    re.IGNORECASE | re.UNICODE,
)

# «150 грн оплатив» / «перевів 150» / «175 оплата»
_PAY_ALT_RE = re.compile(
    r"(?:"
    r"(?:перев(?:ів|ела)|скинув|скинула|відправив|відправила)\s+(\d{1,5})"
    r"|(\d{1,5})\s*(?:грн|uah|₴)?\s*(?:оплат(?:а|ив|ила|или|ил|ено)|сплат(?:а|ив|ила))"
    r")",
    re.IGNORECASE | re.UNICODE,
)


@dataclass
class PaymentParseResult:
    amount_uah: int
    matched: bool


def parse_payment(text: str) -> Optional[PaymentParseResult]:
    t = (text or "").strip()
    if not t:
        return None
    m = _PAY_RE.search(t)
    if m:
        amount = int(m.group(1))
    else:
        m = _PAY_ALT_RE.search(t)
        if not m:
            return None
        amount = int(m.group(1) or m.group(2))
    if amount <= 0:
        return None
    return PaymentParseResult(amount_uah=amount, matched=True)


def looks_like_card_number(text: str) -> Optional[str]:
    """Витягти номер картки (16 цифр), якщо повідомлення виглядає як картка."""
    digits = re.sub(r"\D", "", text or "")
    if len(digits) == 16 and digits.startswith(("4", "5", "6")):
        return digits
    return None


# --- докази оплати без суми в тексті ---

# Посилання на квитанцію monobank. Сторінка малює чек скриптом за капчею, тож суму з неї не дістати:
# знаємо лише, що людина надіслала чек.
_RECEIPT_LINK_RE = re.compile(r"https?://check\.monobank\.ua/p/[\w-]+", re.IGNORECASE)


def receipt_links(text: str) -> list[str]:
    return _RECEIPT_LINK_RE.findall(text or "")


def strip_receipt_links(text: str) -> str:
    return _RECEIPT_LINK_RE.sub(" ", text or "").strip()


# --- «віддам готівкою» ---

# Слово про готівку. «нал» і «кеш» — лише окремим словом: «налисники» й «кешʼю» — це страви.
_CASH_WORD = (
    r"(?:готівк\w*|готівочк\w*|налич\w*|наличк\w*|налик\w*|налом|налу|нал|кешем|кешом|кеш|кэшем|кэш|cash)"
)
_CASH_WORD_RE = re.compile(rf"(?<![\w'ʼ’]){_CASH_WORD}(?![\w'ʼ’])", re.IGNORECASE | re.UNICODE)
# «віддам», «дам», «заплачу», «розрахуюсь», «принесу», «буде»… поруч зі словом про готівку
_CASH_VERB_RE = re.compile(
    r"(?<!\w)(?:від?дам\w*|дам|отдам|заплачу|заплатю|оплачу|сплачу|розрахуюс[ья]|рассчитаюсь|принесу|занесу|"
    r"закину|буде|будет|плачу)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
# Довше речення зі словом «кеш» — зазвичай розмова («є кеш тільки на столову»), а не обіцянка
_CASH_SHORT_WORDS = 3


def _cash_segments(text: str) -> list[tuple[str, bool]]:
    """Текст частинами (рядок / речення) з позначкою, чи це обіцянка готівки."""
    out: list[tuple[str, bool]] = []
    for seg in re.split(r"(\n+|[.;!?]+\s*)", text or ""):
        if not seg:
            continue
        cash = False
        if _CASH_WORD_RE.search(seg):
            words = re.findall(r"[\w'ʼ’]+", seg, re.UNICODE)
            cash = len(words) <= _CASH_SHORT_WORDS or bool(_CASH_VERB_RE.search(seg))
        out.append((seg, cash))
    return out


def is_cash_promise(text: str) -> bool:
    """«Віддам готівкою», «налом», «заплачу наличкой» — людина заплатить готівкою, а не переказом."""
    return any(cash for _seg, cash in _cash_segments(text))


def strip_cash_promise(text: str) -> str:
    """Текст без фрази про готівку — щоб «віддам готівкою» не шукалось серед страв."""
    return "".join(seg for seg, cash in _cash_segments(text) if not cash).strip()
