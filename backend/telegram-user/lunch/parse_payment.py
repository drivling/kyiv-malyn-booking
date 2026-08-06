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
