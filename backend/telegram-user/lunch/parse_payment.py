"""Парсинг повідомлень про оплату: «оплатив 150», «!pay 150»."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


_PAY_RE = re.compile(
    r"(?:"
    r"оплат(?:ив|ила|или|ив|ил)\s*"
    r"|сплат(?:ив|ила|ил)\s*"
    r"|кинув\s*"
    r"|кинула\s*"
    r"|!pay\s*"
    r"|/pay\s*"
    r")"
    r"(\d{1,5})"
    r"(?:\s*(?:грн|uah|₴))?",
    re.IGNORECASE | re.UNICODE,
)

# «150 грн оплатив» / «перевів 150»
_PAY_ALT_RE = re.compile(
    r"(?:перев(?:ів|ела|ів)|скинув|скинула|відправив|відправила)\s+(\d{1,5})",
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
    if not m:
        m = _PAY_ALT_RE.search(t)
    if not m:
        return None
    amount = int(m.group(1))
    if amount <= 0:
        return None
    return PaymentParseResult(amount_uah=amount, matched=True)


def looks_like_card_number(text: str) -> Optional[str]:
    """Витягти номер картки (16 цифр), якщо повідомлення виглядає як картка."""
    digits = re.sub(r"\D", "", text or "")
    if len(digits) == 16 and digits.startswith(("4", "5", "6")):
        return digits
    return None
