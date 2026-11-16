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
# Прохання до когось іншого («Юрій, скинь кеш») — не обіцянка того, хто пише
_CASH_REQUEST_RE = re.compile(
    r"(?<!\w)(?:скинь(?:те)?|кинь(?:те)?|закинь(?:те)?|дай(?:те)?|поверни(?:те)?|верни(?:те)?|скинеш|даси)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)


def _cash_segments(text: str) -> list[tuple[str, bool]]:
    """Текст частинами (рядок / речення) з позначкою, чи це обіцянка готівки."""
    parts = re.split(r"(\n+|[.;!?]+\s*)", text or "")
    out: list[tuple[str, bool]] = []
    for i, seg in enumerate(parts):
        if not seg:
            continue
        cash = False
        if i % 2 == 0 and _CASH_WORD_RE.search(seg):
            words = re.findall(r"[\w'ʼ’]+", seg, re.UNICODE)
            question = i + 1 < len(parts) and "?" in parts[i + 1]  # «А якщо готівка?» — питання, не обіцянка
            cash = (
                not question
                and not _CASH_REQUEST_RE.search(seg)
                and (len(words) <= _CASH_SHORT_WORDS or bool(_CASH_VERB_RE.search(seg)))
            )
        out.append((seg, cash))
    return out


def is_cash_promise(text: str) -> bool:
    """«Віддам готівкою», «налом», «заплачу наличкой» — людина заплатить готівкою, а не переказом."""
    return any(cash for _seg, cash in _cash_segments(text))


def strip_cash_promise(text: str) -> str:
    """Текст без фрази про готівку — щоб «віддам готівкою» не шукалось серед страв."""
    return "".join(seg for seg, cash in _cash_segments(text) if not cash).strip()


# --- «скинула», «оплатив» без суми й без чека ---

# Людина пише, що вже заплатила, але ні суми, ні чека немає. Як і посилання на чек, це гасить увесь її борг
# (рішення власника, 2026-11-16); в адмінці така оплата підписана «суму не перевірено».
# Лише минулий час від першої особи: «скину» (майбутнє), «скинь» (прохання), «скинути» (питання) — не оплата.
_CLAIM_PAID_RE = re.compile(
    r"(?<!\w)(?:оплатив|оплатила|оплатил|сплатив|сплатила|заплатив|заплатила|заплатил|проплатив|проплатила|"
    r"проплатил|оплачено|сплачено)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
_CLAIM_SENT_RE = re.compile(
    r"(?<!\w)(?:скинув|скинула|скинул|кинув|кинула|кинул|закинув|закинула|закинул|перевів|перевела|перевел|"
    r"перевёл|переказав|переказала|відправив|відправила|отправил|отправила|надіслав|надіслала)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
_CLAIM_MONEY_RE = re.compile(
    r"(?<!\w)(?:гроші|грошики|кошти|деньги|денежку|оплату|оплата|грн|за\s+обід|за\s+обед|на\s+картку|на\s+карту)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
_CLAIM_MAX_WORDS = 5


def _claim_segments(text: str) -> list[tuple[str, bool]]:
    """Текст частинами (рядок / речення) з позначкою «тут людина каже, що вже заплатила»."""
    parts = re.split(r"(\n+|[.;!?]+\s*)", text or "")
    out: list[tuple[str, bool]] = []
    for i, seg in enumerate(parts):
        if not seg:
            continue
        claim = False
        if i % 2 == 0 and not (i + 1 < len(parts) and "?" in parts[i + 1]):
            words = re.findall(r"[\w'ʼ’@]+", seg, re.UNICODE)
            if 0 < len(words) <= _CLAIM_MAX_WORDS and not re.search(r"\d", seg):
                if _CLAIM_PAID_RE.search(seg):
                    claim = True
                elif _CLAIM_SENT_RE.search(seg):
                    # «скинула» саме по собі або з «гроші / за обід»; «закинув Андрію» — комусь іншому, не чіпаємо
                    claim = len(words) <= 2 or bool(_CLAIM_MONEY_RE.search(seg))
        out.append((seg, claim))
    return out


def is_paid_claim(text: str) -> bool:
    """«Скинула гроші», «оплатив» — без суми: людина каже, що вже заплатила."""
    return any(claim for _seg, claim in _claim_segments(text))


def strip_paid_claim(text: str) -> str:
    """Текст без фрази про оплату — щоб «оплатила» під замовленням не шукалось серед страв."""
    return "".join(seg for seg, claim in _claim_segments(text) if not claim).strip()
