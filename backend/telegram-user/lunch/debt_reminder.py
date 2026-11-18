"""«Иду в столовую. Кидайте деньги» → нагадати боржникам дня.

Гроші в столову несе одна людина (Андрій Кравченко). Перед виходом він пише в групу «Иду в столовую. Кидайте
деньги» або схоже — з історії групи: «Иду. Бросайте деньги», «В столовой, кидайте гроши», «Иду в столовую. Кидайте 🫰»,
«Иду в столовую.». Тоді слухач відповідає на це повідомлення списком тих, хто ще не розрахувався за сьогодні
(з @-згадкою, щоб Telegram їм сповістив), і сумою.

Правила:
  * реагуємо лише на тих, хто несе гроші (`LUNCH_COLLECTOR_IDS`, за замовч. Андрій); на чужі «кидайте гроші» — ні;
  * сам збирач у списку боржників не стоїть (він платить столовій сам), «Дозаказ без імені» — теж;
  * дня чи замовлень немає — мовчимо; боргів немає — так і кажемо («усі розраховані»);
  * одне нагадування на одне повідомлення і не частіше за `COOLDOWN_SEC` (кілька «кидайте» поспіль — одна відповідь);
  * слухач пропустив повідомлення (пауза під ексклюзивну сесію) — дозбір нагадає, якщо воно свіже (`CATCH_UP_WINDOW`).

Нагадування йде звичайною чергою `LunchOutboundMessage` (reply на повідомлення збирача): так дубль відсікає
сама база, навіть після перезапуску слухача.
"""

from __future__ import annotations

import os
import re
from datetime import timedelta
from typing import Any, Optional, Sequence

from .db import today_kyiv
from .formatters import DEBT_REMINDER_HEADER, format_debt_reminder
from .parse_summary import DOZAZAK_TELEGRAM_ID

# Андрій Кравченко — несе гроші в столову (Telegram user id з групи обідів)
DEFAULT_COLLECTOR_IDS = ("5040092113",)
# Друге «кидайте гроші» за 10 хвилин — та сама прогулянка до столової, другий список не потрібен
COOLDOWN_SEC = 600
# Дозбір після паузи слухача нагадує лише на свіже повідомлення: через годину список уже нікому не потрібен
CATCH_UP_WINDOW = timedelta(minutes=20)


def collector_ids() -> set[str]:
    """Telegram id тих, хто несе гроші в столову: `LUNCH_COLLECTOR_IDS` через кому (порожньо = за замовч.)."""
    raw = (os.environ.get("LUNCH_COLLECTOR_IDS") or "").strip()
    if not raw:
        return set(DEFAULT_COLLECTOR_IDS)
    return {p.strip() for p in raw.split(",") if p.strip()}


# --- розпізнавання фрази ---

_GOING_RE = re.compile(
    r"(?<!\w)(?:иду|йду|іду|пошел|пошла|пішов|пішла|ушел|ушла|выхожу|виходжу|выдвигаюсь|выдвигаюся)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
# «в столовую», «в столовой», «у їдальню», «столовка»
_CANTEEN_RE = re.compile(r"(?<!\w)(?:столов\w*|їдальн\w*|ідальн\w*)", re.IGNORECASE | re.UNICODE)
# прохання до всіх (множина): «кидайте», «бросайте», «скидайте»… «скинь» — комусь одному, це не заклик
_SEND_RE = re.compile(
    r"(?<!\w)(?:кидайте|киньте|бросайте|бросьте|скидайте|скиньте|скидываем|скидуємо|закидайте|закиньте|"
    r"перекидайте|перекиньте|переводите|переведите|переказуйте|перекажіть|надсилайте|сдаем|сдаём|здаємо|"
    r"здаем)(?!\w)",
    re.IGNORECASE | re.UNICODE,
)
_MONEY_RE = re.compile(
    r"(?:(?<!\w)(?:деньги|денег|деньгу|гроші|гроши|грошi|грошики|бабки|кеш|оплату)(?!\w)|🫰|💰|💸|💵|💴)",
    re.IGNORECASE | re.UNICODE,
)
# «Кто забыл скинуть за обед?», «хто ще не скинув?»
_WHO_NOT_PAID_RE = re.compile(
    r"(?<!\w)(?:кто|хто)(?!\w).{0,20}?(?:(?<!\w)не\s+(?:скинул|скинув|скинула|оплатил|оплатив|перевел|переказав)|"
    r"(?<!\w)(?:забыл|забыла|забув|забула)\s+(?:скинуть|скинути|оплатить|оплатити|перевести))",
    re.IGNORECASE | re.UNICODE,
)
# не сьогодні або не йде: «завтра иду в столовую», «не иду в столовую»
_NOT_NOW_RE = re.compile(
    r"(?<!\w)(?:завтра|вчера|вчора|не\s+(?:иду|йду|іду|пойду|піду|пошел|пішов))(?!\w)",
    re.IGNORECASE | re.UNICODE,
)


def is_canteen_call(text: str) -> bool:
    """«Иду в столовую. Кидайте деньги» і схожі: збирач іде в столову й просить скинути гроші."""
    t = (text or "").replace("ё", "е").replace("Ё", "Е").strip()
    if not t or len(t) > 200 or _NOT_NOW_RE.search(t):
        return False
    if _WHO_NOT_PAID_RE.search(t):
        return True
    going = bool(_GOING_RE.search(t))
    canteen = bool(_CANTEEN_RE.search(t))
    if going and canteen:
        return True
    # «кидайте» саме по собі буває й про замовлення («кидайте заказы») — потрібні гроші, «иду» або столова
    return bool(_SEND_RE.search(t)) and (going or canteen or bool(_MONEY_RE.search(t)))


# --- нагадування ---


def debtor_rows(rows: Sequence[dict[str, Any]], *, exclude_ids: set[str]) -> tuple[list[dict[str, Any]], bool]:
    """(боржники, чи є взагалі замовлення інших людей). Збирача й «Дозаказ без імені» не рахуємо."""
    skip = set(exclude_ids) | {DOZAZAK_TELEGRAM_ID}
    others = [r for r in rows if str(r.get("telegram_user_id") or "") not in skip]
    return [r for r in others if int(r.get("debt_uah") or 0) > 0], bool(others)


def is_debt_reminder(text: str) -> bool:
    return (text or "").startswith(DEBT_REMINDER_HEADER)


async def remind_debtors(db, *, trigger_message_id: int, collector_uid: Optional[str] = None) -> str:
    """Поставити в чергу нагадування боржникам — reply на повідомлення збирача.

    Повертає: queued | duplicate (на це повідомлення вже нагадали або щойно нагадували) | no_day | no_orders."""
    day = await db.get_day(today_kyiv())
    if day is None:
        return "no_day"
    exclude = collector_ids()
    if collector_uid:
        exclude.add(str(collector_uid))
    debtors, any_orders = debtor_rows(await db.summary_rows(day.id), exclude_ids=exclude)
    if not any_orders:
        return "no_orders"
    queued = await db.enqueue_outbound_once(
        format_debt_reminder(debtors),
        reply_to_message_id=int(trigger_message_id),
        marker=DEBT_REMINDER_HEADER,
        cooldown_sec=COOLDOWN_SEC,
    )
    return "queued" if queued else "duplicate"
