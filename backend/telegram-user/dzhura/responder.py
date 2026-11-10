"""
Джура · автовідповідь: таймер на чат і надсилання від імені власника.

Правило власника: співрозмовник написав → чекаємо `autoReplyDelaySec` (від його останнього повідомлення).
Власник відповів сам раніше — таймер скасовано, його репліка просто лягає в базу і стає прикладом стилю.
Не відповів — питаємо Claude (`autoreply.generate_reply`) і надсилаємо 1–3 повідомлення.

Це єдине місце, де Джура пише в захоплений чат, і свідомий виняток із її гарантій (див. README):
лише особисті чати з галочкою «Автовідповідь», і лише тут — «прочитано» та «друкує…» перед відповіддю,
інакше відповідь на «непрочитане» повідомлення видає програму.

Telethon тут не імпортується (клієнт — будь-що з send_read_acknowledge / action / send_message),
тож `python3 -m dzhura.test_autoreply` працює без нього.
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
import time
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Optional

from dzhura.autoreply import (
    CONTEXT_MESSAGES,
    KYIV,
    ReplyPlan,
    generate_reply,
    has_text,
    pending_incoming,
    typing_seconds,
)
from dzhura.relay import html_escape, truncate

MIN_DELAY_SEC = 5
MAX_DELAY_SEC = 3600
DEFAULT_DELAY_SEC = 80
# Старе повідомлення, яке Telegram доніс із запізненням (перепідключення), таймер не запускає
STALE_MESSAGE_SEC = 180
# Запобіжник від зациклення (напр. на тому боці теж автовідповідач) і від несподіваних витрат
DEFAULT_DAILY_CAP = 40
READ_PAUSE_SEC = 1.5
ERROR_NOTICE_EVERY_SEC = 600
NOTICE_QUOTE_LIMIT = 200


def log(msg: str, *, err: bool = False) -> None:
    print(f"[dzhura] autoreply {msg}", file=sys.stderr if err else sys.stdout, flush=True)


def autoreply_switch_on() -> bool:
    """DZHURA_AUTOREPLY_ENABLED=0 вимикає автовідповідь усюди, хоч би які галочки стояли."""
    return (os.environ.get("DZHURA_AUTOREPLY_ENABLED") or "1").strip().lower() not in ("0", "false", "no", "off")


def daily_cap() -> int:
    try:
        return max(0, int(os.environ.get("DZHURA_AUTOREPLY_DAILY_CAP") or DEFAULT_DAILY_CAP))
    except ValueError:
        return DEFAULT_DAILY_CAP


def clamp_delay(raw: Any) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_DELAY_SEC
    return min(max(value, MIN_DELAY_SEC), MAX_DELAY_SEC)


def kyiv_day_start_utc(now: Optional[datetime] = None) -> datetime:
    """Початок сьогоднішньої київської доби як naive UTC (так лежить sentAt у базі)."""
    now = now or datetime.now(timezone.utc)
    start = now.astimezone(KYIV).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def format_notice(peer_name: str, incoming: Optional[str], sent: list[str], reason: str) -> str:
    """Звіт власникові в «Обране»: на що і що відповіла Джура (або чому промовчала)."""
    title = "Автовідповідь" if sent else "Автовідповідь промовчала"
    lines = [f"🤖 <b>{title}</b> · {html_escape(peer_name)}"]
    if incoming:
        lines.append(f"← {html_escape(truncate(incoming, NOTICE_QUOTE_LIMIT))}")
    lines.extend(f"→ {html_escape(text)}" for text in sent)
    if reason:
        lines.append(f"<i>{html_escape(reason)}</i>")
    return "\n".join(lines)


class AutoResponder:
    def __init__(
        self,
        client: Any,
        db: Any,
        cap: Any,
        *,
        owner_name: Optional[str] = None,
        generate: Callable[..., Awaitable[ReplyPlan]] = generate_reply,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        rnd: Callable[[], float] = random.random,
        api_key: Optional[str] = None,
    ):
        self.client = client
        self.db = db
        self.cap = cap
        self.owner_name = owner_name
        self._generate = generate
        self._sleep = sleep
        self._rnd = rnd
        key = api_key if api_key is not None else os.environ.get("ANTHROPIC_API_KEY")
        self.available = bool((key or "").strip()) and autoreply_switch_on()
        # чат → задача, що чекає таймер або відповідь моделі (нове вхідне чи репліка власника її скасовує)
        self._timers: dict[int, asyncio.Task] = {}
        # чат → (задача, тексти), поки серія надсилається: наші ж вихідні не мають скасувати самих себе
        self._sending: dict[int, tuple[asyncio.Task, set[str]]] = {}
        self._last_error_notice: dict[int, float] = {}

    # ---------------- подія з Capture.on_new_message (дешево, без await) ----------------

    def on_message(self, chat: dict[str, Any], msg: Any) -> None:
        if not self.available:
            return
        cid = int(chat["tg_chat_id"])
        if chat.get("kind") != "private" or not chat.get("auto_reply"):
            self._cancel_timer(cid)
            return
        if getattr(msg, "out", False):
            sending = self._sending.get(cid)
            if sending is not None:
                if (getattr(msg, "message", None) or "") in sending[1]:
                    return  # це наша власна репліка повернулась подією
                sending[0].cancel()  # власник втрутився посеред серії — решту не надсилаємо
            if self._cancel_timer(cid):
                log(f"chat={chat['id']} власник відповів сам — таймер скасовано")
            return
        sent_at = getattr(msg, "date", None)
        if sent_at is not None:
            if sent_at.tzinfo is None:
                sent_at = sent_at.replace(tzinfo=timezone.utc)
            if (datetime.now(timezone.utc) - sent_at).total_seconds() > STALE_MESSAGE_SEC:
                return
        self._cancel_timer(cid)
        delay = clamp_delay(chat.get("auto_reply_delay_sec"))
        self._timers[cid] = asyncio.create_task(self._run(cid, delay))

    def _cancel_timer(self, cid: int) -> bool:
        task = self._timers.pop(cid, None)
        if task is None or task.done():
            return False
        task.cancel()
        return True

    # ---------------- таймер → рішення → надсилання ----------------

    async def _run(self, cid: int, delay: int) -> None:
        try:
            await self._sleep(delay)
            chat = self.cap.watched.get(cid)
            if chat is None or chat.get("kind") != "private" or not chat.get("auto_reply"):
                return  # галочку зняли, поки чекали
            await self._answer(chat)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — автовідповідь не повинна валити слухача
            log(f"chat-tg={cid}: {type(e).__name__}: {e}", err=True)
            await self._error_notice(cid, f"{type(e).__name__}: {e}")
        finally:
            if self._timers.get(cid) is asyncio.current_task():
                del self._timers[cid]

    async def _drain(self) -> None:
        """Дочекатись, поки writer Джури запише в базу все, що вже прийшло."""
        try:
            await asyncio.wait_for(self.cap.queue.join(), timeout=10)
        except asyncio.TimeoutError:
            pass

    async def _answer(self, chat: dict[str, Any]) -> None:
        await self._drain()
        rows = await self.db.recent_messages(chat["id"], CONTEXT_MESSAGES)
        batch = pending_incoming(rows)
        if not batch:
            log(f"chat={chat['id']} останнє слово вже за власником — мовчимо")
            return
        if not has_text(batch):
            log(f"chat={chat['id']} лише медіа без тексту — мовчимо")
            return
        cap = daily_cap()
        sent_today = await self.db.count_auto_replies_since(chat["id"], kyiv_day_start_utc())
        if sent_today >= cap:
            log(f"chat={chat['id']} денний ліміт {cap} автовідповідей вичерпано")
            return

        plan = await self._generate(
            rows,
            peer_name=chat["title"],
            owner_name=self.owner_name,
            note=chat.get("auto_reply_note"),
        )
        incoming = next((r["text"] for r in reversed(batch) if (r.get("text") or "").strip()), None)
        if not plan.is_reply:
            log(f"chat={chat['id']} модель вирішила промовчати")
            await self.db.enqueue_saved(format_notice(chat["title"], incoming, [], plan.reason))
            return

        # Поки модель думала, власник міг відповісти з іншого пристрою. Подія вже скасувала б цю задачу,
        # але база — другий рубіж (подія могла загубитись на перепідключенні).
        await self._drain()
        if not pending_incoming(await self.db.recent_messages(chat["id"], 10)):
            log(f"chat={chat['id']} власник відповів, поки модель думала — відповідь відкинуто")
            return
        await self._send(chat, int(batch[-1]["tg_message_id"]), plan, incoming)

    async def preview(self, chat_row_id: int) -> dict[str, Any]:
        """Задача `autoreply_preview` з адмінки: що Джура відповіла б зараз. У чат нічого не йде,
        «прочитано» не ставиться — лише запит до моделі з тим самим контекстом."""
        if not self.available:
            raise RuntimeError("автовідповідь вимкнено: немає ANTHROPIC_API_KEY або DZHURA_AUTOREPLY_ENABLED=0")
        chat = next((c for c in self.cap.watched.values() if c["id"] == int(chat_row_id)), None)
        if chat is None or chat.get("kind") != "private":
            raise ValueError("чат не читається або не особистий")
        await self._drain()
        rows = await self.db.recent_messages(chat["id"], CONTEXT_MESSAGES)
        batch = pending_incoming(rows)
        if not batch:
            return {"action": "skip", "messages": [], "reason": "Останнє слово за вами — відповідати нема на що."}
        if not has_text(batch):
            return {"action": "skip", "messages": [], "reason": "Останні повідомлення — лише медіа без тексту."}
        plan = await self._generate(
            rows, peer_name=chat["title"], owner_name=self.owner_name, note=chat.get("auto_reply_note")
        )
        return {
            "action": "reply" if plan.is_reply else "skip",
            "messages": plan.messages if plan.is_reply else [],
            "reason": plan.reason,
        }

    async def _peer(self, chat: dict[str, Any]) -> Any:
        cid = int(chat["tg_chat_id"])
        try:
            return await self.client.get_input_entity(cid)
        except Exception:  # noqa: BLE001 — після деплою кеш сесії порожній; access_hash є в DzhuraPerson
            access_hash = await self.db.person_access_hash(cid)
            if access_hash is None:
                raise
            from telethon.tl.types import InputPeerUser

            return InputPeerUser(cid, int(access_hash))

    async def _send(self, chat: dict[str, Any], last_incoming_tg_id: int, plan: ReplyPlan, incoming: Optional[str]) -> None:
        cid = int(chat["tg_chat_id"])
        task = asyncio.current_task()
        if self._timers.get(cid) is task:
            del self._timers[cid]  # нове вхідне тепер заведе новий таймер, а не обірве цю серію
        self._sending[cid] = (task, set(plan.messages))  # type: ignore[arg-type]
        sent_texts: list[str] = []
        try:
            peer = await self._peer(chat)
            # Виняток із «ніколи не читаємо»: відповідь на непрочитане повідомлення видала б програму.
            await self.client.send_read_acknowledge(peer, max_id=last_incoming_tg_id)
            await self._sleep(READ_PAUSE_SEC)
            for text in plan.messages:
                async with self.client.action(peer, "typing"):
                    await self._sleep(typing_seconds(text, self._rnd()))
                # parse_mode=None: текст як є, без markdown-розбору Telethon
                sent = await self.client.send_message(peer, text, parse_mode=None)
                sent_texts.append(text)
                await self._store(chat, sent)
        finally:
            if self._sending.get(cid, (None,))[0] is task:
                del self._sending[cid]
            if sent_texts:
                log(f"chat={chat['id']} надіслано {len(sent_texts)} з {len(plan.messages)}")
                await self.db.enqueue_saved(format_notice(chat["title"], incoming, sent_texts, plan.reason))

    async def _store(self, chat: dict[str, Any], sent: Any) -> None:
        """Записати нашу репліку одразу і позначити як автовідповідь (подія про неї може й не прийти)."""
        try:
            await self.cap.store_message(chat, sent, source="live", relay=False)
            await self.db.mark_auto_reply(chat["id"], int(sent.id))
        except Exception as e:  # noqa: BLE001 — повідомлення вже в чаті; не зриваємо решту серії
            log(f"chat={chat['id']} не вдалося зберегти репліку: {type(e).__name__}: {e}", err=True)

    async def _error_notice(self, cid: int, error: str) -> None:
        now = time.monotonic()
        if now - self._last_error_notice.get(cid, -ERROR_NOTICE_EVERY_SEC) < ERROR_NOTICE_EVERY_SEC:
            return
        self._last_error_notice[cid] = now
        chat = self.cap.watched.get(cid) or {}
        try:
            await self.db.enqueue_saved(
                f"🤖 <b>Автовідповідь не спрацювала</b> · {html_escape(chat.get('title') or str(cid))}\n"
                f"<i>{html_escape(truncate(error, 300))}</i>"
            )
        except Exception:  # noqa: BLE001
            pass
