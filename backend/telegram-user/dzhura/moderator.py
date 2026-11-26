"""
Джура · модерація групи: раз на кілька хвилин дивиться в групи з `DzhuraChat.moderationMode = 'drafts'`,
дешевим фільтром шукає повідомлення про адміністрацію і, коли їх назбиралось, питає Claude
(`moderation.decide`), чи втрутитися. Поки лише чернетки: текст відповіді й попередження йде власникові
в «Обране» (черга LunchOutboundMessage, target='saved'), у групу нічого.

Обмеження (як у правилі власника):
  * не одразу — через 12–15 хв: на повідомлення, старші за 12 хв (перевірка раз на 3 хв), і лише якщо
    адміністрація після нього мовчала;
  * одній людині — не частіше разу на київську добу; попередження за флуд — не частіше разу на 3 год на чат;
  * після втручання чат годину не чіпаємо (одна сварка — одна відповідь);
  * уночі (23:00–08:00) не перевіряємо; не більше DZHURA_MODERATION_DAILY_CAP запитів до моделі на чат за добу.

Задача `moderation_preview` {chatId, atTgMessageId} проганяє те саме «як було б» через 13 хв після вказаного
повідомлення — щоб перевірити правило на минулих суперечках. Без журналу, без «Обраного», без лімітів.
"""

from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Optional

from dzhura.moderation import (
    CONTEXT_HOURS,
    CONTEXT_MESSAGES,
    DELAY_MIN,
    SAMPLES_PER_PERSON,
    WINDOW_MIN,
    ModerationPlan,
    as_utc,
    decide,
    eligible_targets,
    format_draft,
    model_name,
    parse_protected,
    quiet_hours,
)
from dzhura.relay import message_link
from dzhura.responder import kyiv_day_start_utc

DEFAULT_CHECK_SEC = 180
DEFAULT_DAILY_CAP = 24
WARNING_COOLDOWN = timedelta(hours=3)
# Після втручання чат годину не чіпаємо: одна сварка — одна відповідь, а не по одній кожному учаснику
CHAT_COOLDOWN = timedelta(hours=1)
MAX_SAMPLED_PEOPLE = 8


def log(msg: str, *, err: bool = False) -> None:
    print(f"[dzhura] moderation {msg}", file=sys.stderr if err else sys.stdout, flush=True)


def moderation_switch_on() -> bool:
    """DZHURA_MODERATION_ENABLED=0 вимикає модерацію всюди, хоч би що стояло в чатах."""
    return (os.environ.get("DZHURA_MODERATION_ENABLED") or "1").strip().lower() not in ("0", "false", "no", "off")


def _env_int(name: str, default: int, low: int = 0) -> int:
    try:
        return max(low, int(os.environ.get(name) or default))
    except ValueError:
        return default


class Moderator:
    def __init__(
        self,
        db: Any,
        cap: Any,
        *,
        decide_fn: Callable[..., Awaitable[ModerationPlan]] = decide,
        api_key: Optional[str] = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ):
        self.db = db
        self.cap = cap
        self._decide = decide_fn
        self._sleep = sleep
        key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY")
        self.available = bool((key or "").strip()) and moderation_switch_on()
        # чат → найновіше повідомлення-кандидат, про яке вже питали модель (щоб не питати двічі)
        self._last_key: dict[int, int] = {}

    # ---------------- цикл ----------------

    async def loop(self) -> None:
        if not self.available:
            return
        every = _env_int("DZHURA_MODERATION_CHECK_SEC", DEFAULT_CHECK_SEC, 30)
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 — модерація не повинна валити слухача
                log(f"tick: {type(e).__name__}: {e}", err=True)
            await self._sleep(every)

    async def tick(self, now: Optional[datetime] = None) -> None:
        now = as_utc(now or datetime.now(timezone.utc))
        if quiet_hours(now):
            return
        for chat in list(self.cap.watched.values()):
            if chat.get("moderation_mode") != "drafts" or chat.get("kind") not in ("group", "supergroup"):
                continue
            try:
                await self.check_chat(chat, now)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log(f"chat={chat.get('id')}: {type(e).__name__}: {e}", err=True)

    # ---------------- спільне: вікно, кандидати, зразки ----------------

    async def _prepare(self, chat: dict[str, Any], now: datetime):
        protected = parse_protected(chat.get("moderation_protected"))
        rows = await self.db.moderation_rows(chat["id"], now, CONTEXT_MESSAGES, CONTEXT_HOURS)
        related, eligible = eligible_targets(rows, protected, now)
        return protected, rows, related, eligible

    async def _ask(self, chat: dict[str, Any], now: datetime, protected, rows, related, eligible) -> ModerationPlan:
        people: list[int] = []
        names: dict[int, str] = {}
        for r in related:
            uid = r.get("sender_tg_id")
            if uid is not None and uid not in names:
                names[uid] = r.get("sender_name") or str(uid)
                people.append(uid)
        raw = await self.db.person_samples(
            chat["id"], people[:MAX_SAMPLED_PEOPLE], now - timedelta(minutes=WINDOW_MIN), SAMPLES_PER_PERSON
        )
        samples = {names[uid]: texts for uid, texts in raw.items() if uid in names}
        return await self._decide(
            rows,
            chat_title=chat.get("title") or "",
            protected=protected,
            note=chat.get("moderation_note"),
            eligible_ids={int(r["tg_message_id"]) for r in eligible},
            samples=samples,
            now=now,
        )

    # ---------------- живий режим чернеток ----------------

    async def check_chat(self, chat: dict[str, Any], now: datetime) -> None:
        protected, rows, related, eligible = await self._prepare(chat, now)
        if not related or not eligible:
            return
        key = max(int(r["tg_message_id"]) for r in eligible)
        if key <= self._last_key.get(chat["id"], 0):
            return
        self._last_key[chat["id"]] = key
        last_draft = await self.db.moderation_last_draft(chat["id"])
        if last_draft is not None and now - as_utc(last_draft) < CHAT_COOLDOWN:
            return
        day_start = kyiv_day_start_utc(now)
        if await self.db.moderation_calls_since(chat["id"], day_start) >= _env_int(
            "DZHURA_MODERATION_DAILY_CAP", DEFAULT_DAILY_CAP
        ):
            log(f"chat={chat['id']}: денний ліміт запитів вичерпано")
            return

        plan = await self._ask(chat, now, protected, rows, related, eligible)
        model = model_name()
        if not plan.intervene:
            await self.db.insert_moderation(chat["id"], "skip", reason=plan.reason, model=model, window_to_tg_message_id=key)
            log(f"chat={chat['id']} skip: {plan.reason}")
            return
        target = next(r for r in eligible if int(r["tg_message_id"]) == plan.target_message_id)
        uid = target.get("sender_tg_id")
        if uid is not None and await self.db.moderation_person_since(chat["id"], uid, day_start):
            await self.db.insert_moderation(
                chat["id"], "skip", reason="цій людині сьогодні вже була відповідь", model=model, window_to_tg_message_id=key
            )
            return
        last_warning = await self.db.moderation_last_warning(chat["id"])
        drop_warning = last_warning is not None and now - as_utc(last_warning) < WARNING_COOLDOWN
        inserted = await self.db.insert_moderation(
            chat["id"],
            "draft",
            reason=plan.reason,
            target_tg_message_id=plan.target_message_id,
            target_tg_user_id=uid,
            hint=plan.hint,
            warning=None if drop_warning else (plan.warning or None),
            model=model,
            window_to_tg_message_id=key,
        )
        if not inserted:
            return
        link = message_link(chat.get("kind") or "", int(chat["tg_chat_id"]), plan.target_message_id)
        await self.db.enqueue_saved(format_draft(chat.get("title") or "", target, plan, link=link, warning_dropped=drop_warning))
        log(f"chat={chat['id']} draft → #{plan.target_message_id}")

    # ---------------- перевірка правила на минулому (задача moderation_preview) ----------------

    async def preview(self, chat_id: int, at_tg_message_id: int) -> dict[str, Any]:
        if not self.available:
            raise RuntimeError("модерація вимкнена (немає ANTHROPIC_API_KEY або DZHURA_MODERATION_ENABLED=0)")
        chat = await self.db.get_chat_by_id(int(chat_id))
        if chat is None:
            raise ValueError(f"chat {chat_id} not found")
        full = next((c for c in self.cap.watched.values() if c["id"] == chat["id"]), None)
        if full is None:
            raise ValueError("чат не читається — увімкніть «Читати»")
        msg = await self.db.get_message_by_tg(chat["id"], int(at_tg_message_id))
        if msg is None:
            raise ValueError(f"повідомлення {at_tg_message_id} немає в журналі")
        now = as_utc(msg["sent_at"]) + timedelta(minutes=DELAY_MIN + 1)
        protected, rows, related, eligible = await self._prepare(full, now)
        result: dict[str, Any] = {
            "simulatedAt": now.isoformat(),
            "related": [int(r["tg_message_id"]) for r in related],
            "eligible": [int(r["tg_message_id"]) for r in eligible],
            "quietHours": quiet_hours(now),
        }
        if not related or not eligible:
            result.update(action="skip", reason="фільтр: ні наїзду на адміністрацію, ні сварки сусідів, або все ще свіже / вже з відповіддю")
            return result
        plan = await self._ask(full, now, protected, rows, related, eligible)
        result.update(
            action=plan.action,
            targetMessageId=plan.target_message_id,
            targetName=plan.target_name,
            hint=plan.hint,
            warning=plan.warning,
            reason=plan.reason,
            case=plan.case,
        )
        return result
