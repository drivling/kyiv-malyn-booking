"""
Джура · захват повідомлень з обраних чатів.

Обробники Telethon дешеві: перевірка «чат у watched і не Saved Messages» → dict у asyncio.Queue.
Один writer-корутин послідовно пише в БД (одне з'єднання пулу, порядок нове → edit → реакція
збережено). Реєструвати обробники треба ДО лунч-обробника: Telethon виконує обробники одного
апдейту послідовно в порядку реєстрації.

ГАРАНТІЇ (не порушувати):
  * ніколи не викликати send_read_acknowledge / mark_read — власник читає сам;
  * ніколи не викликати SetTypingRequest / UpdateStatusRequest;
  * жодного send_message у watched-чат — єдиний вихід у Telegram: LunchOutboundMessage
    (target='saved' → «Обране» власника).
"""

from __future__ import annotations

import asyncio
import sys
import time
from typing import Any, Coroutine, Optional

import asyncpg
from telethon import events, utils
from telethon.tl.types import (
    Channel,
    ReactionCustomEmoji,
    ReactionEmoji,
    ReactionPaid,
    UpdateMessageReactions,
    User,
)

from dzhura.db import DzhuraDB
from dzhura.relay import (
    clip_raw_json,
    format_message_relay,
    format_reaction_relay,
    html_escape,
    message_link,
    person_link_html,
    reaction_key,
    reactions_counts,
    plan_reaction_changes,
)

WATCHED_REFRESH_SEC = 5
HEARTBEAT_SEC = 30
DIALOGS_SYNC_SEC = 15 * 60
JOB_POLL_SEC = 3
QUEUE_MAX = 5000
GAP_FILL_LIMIT = 500


def log(msg: str, *, err: bool = False) -> None:
    print(f"[dzhura] {msg}", file=sys.stderr if err else sys.stdout, flush=True)


def _reaction_to_key(reaction: Any) -> Optional[str]:
    if isinstance(reaction, ReactionEmoji):
        return reaction_key("emoji", reaction.emoticon)
    if isinstance(reaction, ReactionCustomEmoji):
        return reaction_key("custom", reaction.document_id)
    if isinstance(reaction, ReactionPaid):
        return reaction_key("paid")
    return None  # ReactionEmpty


def media_kind_of(msg: Any) -> Optional[str]:
    """Тип медіа за предикатами custom.Message; web_preview — це просто текст."""
    if getattr(msg, "media", None) is None or getattr(msg, "web_preview", None):
        return None
    for attr in (
        "photo",
        "video_note",
        "voice",
        "gif",
        "sticker",
        "video",
        "audio",
        "document",
        "contact",
        "geo",
        "poll",
    ):
        try:
            if getattr(msg, attr, None):
                return attr
        except Exception:  # noqa: BLE001
            continue
    return "other"


class Capture:
    def __init__(self, client, db: DzhuraDB, me_id: int, lunch_group_id: int, lunch_group_title: Optional[str]):
        self.client = client
        self.db = db
        self.me_id = int(me_id)
        self.lunch_group_id = int(lunch_group_id)
        self.lunch_group_title = lunch_group_title or str(lunch_group_id)
        self.watched: dict[int, dict[str, Any]] = {}
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
        self.dropped = 0

    # ---------------- Telethon handlers (дешеві) ----------------

    def _is_watched(self, chat_id: Optional[int]) -> bool:
        return chat_id is not None and chat_id != self.me_id and chat_id in self.watched

    def _put(self, item: dict[str, Any]) -> None:
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            self.dropped += 1
            log(f"queue full, dropped {item.get('kind')} chat={item.get('chat_id')} (total {self.dropped})", err=True)

    async def on_new_message(self, event) -> None:
        try:
            chat_id = event.chat_id
            if not self._is_watched(chat_id):
                return
            self._put({"kind": "new", "chat_id": chat_id, "msg": event.message})
        except Exception as e:  # noqa: BLE001
            log(f"on_new_message: {e}", err=True)

    async def on_edited(self, event) -> None:
        try:
            chat_id = event.chat_id
            if not self._is_watched(chat_id):
                return
            self._put({"kind": "edit", "chat_id": chat_id, "msg": event.message})
        except Exception as e:  # noqa: BLE001
            log(f"on_edited: {e}", err=True)

    async def on_raw_reactions(self, update) -> None:
        try:
            if not isinstance(update, UpdateMessageReactions):
                return
            chat_id = utils.get_peer_id(update.peer) if update.peer is not None else None
            if not self._is_watched(chat_id):
                return
            reactions = update.reactions
            if reactions is None or getattr(reactions, "min", False):
                return
            self._put(
                {
                    "kind": "reactions",
                    "chat_id": chat_id,
                    "msg_id": int(update.msg_id),
                    "top_msg_id": getattr(update, "top_msg_id", None),
                    "reactions": reactions,
                }
            )
        except Exception as e:  # noqa: BLE001
            log(f"on_raw_reactions: {e}", err=True)

    async def on_deleted(self, event) -> None:
        try:
            chat_id = event.chat_id  # None для приватних чатів і basic-груп
            if chat_id is not None and not self._is_watched(chat_id):
                return
            ids = [int(x) for x in (event.deleted_ids or [])]
            if not ids:
                return
            self._put({"kind": "deleted", "chat_id": chat_id, "ids": ids})
        except Exception as e:  # noqa: BLE001
            log(f"on_deleted: {e}", err=True)

    # ---------------- writer ----------------

    async def writer(self) -> None:
        while True:
            item = await self.queue.get()
            try:
                await self._handle(item)
            except Exception as e:  # noqa: BLE001
                log(f"writer {item.get('kind')} chat={item.get('chat_id')}: {type(e).__name__}: {e}", err=True)
            finally:
                self.queue.task_done()

    async def _handle(self, item: dict[str, Any]) -> None:
        kind = item["kind"]
        if kind == "deleted":
            await self._handle_deleted(item["chat_id"], item["ids"])
            return
        chat = self.watched.get(item["chat_id"])
        if chat is None:
            return  # галочку зняли, поки повідомлення чекало в черзі
        if kind == "new":
            await self.store_message(chat, item["msg"], source="live", relay=True)
        elif kind == "edit":
            await self._handle_edit(chat, item["msg"])
        elif kind == "reactions":
            await self._handle_reactions(chat, item["msg_id"], item["reactions"])

    # ---------------- messages ----------------

    async def store_message(self, chat: dict[str, Any], msg: Any, *, source: str, relay: bool) -> tuple[int, bool]:
        """Upsert повідомлення (+ автор). Повертає (id, inserted). Relay лише для нових live-повідомлень."""
        sender = None
        try:
            sender = await msg.get_sender()
        except Exception:  # noqa: BLE001
            sender = None

        sender_person_id: Optional[int] = None
        if isinstance(sender, User):
            sender_person_id = await self._upsert_user(sender)

        text = msg.message or ""
        media_kind = media_kind_of(msg)
        file_name = None
        if media_kind == "document":
            try:
                file_name = msg.file.name if msg.file else None
            except Exception:  # noqa: BLE001
                file_name = None

        reply_to_id = msg.reply_to_msg_id
        topic_id = None
        reply_to = getattr(msg, "reply_to", None)
        if reply_to is not None and getattr(reply_to, "forum_topic", False):
            topic_id = getattr(reply_to, "reply_to_top_id", None) or reply_to_id

        fwd = getattr(msg, "fwd_from", None)
        fwd_name = fwd_id = fwd_date = None
        if fwd is not None:
            fwd_name = getattr(fwd, "from_name", None) or None
            if getattr(fwd, "from_id", None) is not None:
                try:
                    fwd_id = utils.get_peer_id(fwd.from_id)
                except Exception:  # noqa: BLE001
                    fwd_id = None
            fwd_date = getattr(fwd, "date", None)

        raw_json = None
        try:
            raw_json = clip_raw_json(msg.to_json())
        except Exception:  # noqa: BLE001
            raw_json = None

        msg_row_id, inserted = await self.db.upsert_message(
            chat_id=chat["id"],
            tg_message_id=msg.id,
            sender_person_id=sender_person_id,
            is_outgoing=bool(msg.out),
            text=text,
            media_kind=media_kind,
            reply_to_tg_message_id=reply_to_id,
            topic_id=topic_id,
            forward_from_name=fwd_name,
            forward_from_tg_id=fwd_id,
            forward_date=fwd_date,
            sent_at=msg.date,
            edited_at=getattr(msg, "edit_date", None),
            source=source,
            raw_json=raw_json,
        )
        await self.db.touch_chat(chat["id"], msg.date, msg.id)

        if relay and inserted and not msg.out and chat.get("relay_to_saved"):
            await self._relay_message(chat, msg, sender, media_kind, file_name, fwd_name)
        return msg_row_id, inserted

    async def _upsert_user(self, user: User) -> int:
        return await self.db.upsert_person(
            tg_user_id=int(user.id),
            first_name=getattr(user, "first_name", None),
            last_name=getattr(user, "last_name", None),
            username=getattr(user, "username", None),
            phone=getattr(user, "phone", None),
            is_bot=bool(getattr(user, "bot", False)),
            is_me=int(user.id) == self.me_id or bool(getattr(user, "is_self", False)),
        )

    def _sender_html(self, sender: Any, sender_id: Optional[int]) -> str:
        if isinstance(sender, User):
            return person_link_html(sender.first_name, sender.last_name, sender.username, sender.id)
        if isinstance(sender, Channel):
            return html_escape(getattr(sender, "title", None) or str(sender_id or ""))
        return html_escape(str(sender_id)) if sender_id else "Невідомий"

    async def _relay_message(
        self,
        chat: dict[str, Any],
        msg: Any,
        sender: Any,
        media_kind: Optional[str],
        file_name: Optional[str],
        fwd_name: Optional[str],
    ) -> None:
        reply_preview = None
        if msg.reply_to_msg_id:
            parent = await self.db.get_message_by_tg(chat["id"], msg.reply_to_msg_id)
            if parent is not None:
                reply_preview = parent["text"] or None
            else:
                try:
                    pm = await msg.get_reply_message()
                    reply_preview = (pm.message or None) if pm is not None else None
                except Exception:  # noqa: BLE001
                    reply_preview = None
        html = format_message_relay(
            chat["title"],
            self._sender_html(sender, msg.sender_id),
            msg.id,
            msg.message,
            media_kind=media_kind,
            file_name=file_name,
            reply_preview=reply_preview,
            link=message_link(chat["kind"], chat["tg_chat_id"], msg.id),
            forward_from=fwd_name,
        )
        await self.db.enqueue_saved(html)

    async def _handle_edit(self, chat: dict[str, Any], msg: Any) -> None:
        existing = await self.db.get_message_by_tg(chat["id"], msg.id)
        if existing is None:
            # Правка повідомлення, якого ще не бачили (до ввімкнення галочки) — зберегти тихо.
            await self.store_message(chat, msg, source="live", relay=False)
            return
        new_text = msg.message or ""
        if new_text != existing["text"]:
            await self.db.apply_edit(existing["id"], existing["text"], new_text, getattr(msg, "edit_date", None))
        elif getattr(msg, "reactions", None) is not None:
            # На старих layer-ах реакції приходили як UpdateEditMessage.
            await self.apply_reactions(chat, existing, msg.id, msg.reactions, relay=True)

    # ---------------- reactions ----------------

    async def _handle_reactions(self, chat: dict[str, Any], tg_msg_id: int, reactions: Any) -> None:
        existing = await self.db.get_message_by_tg(chat["id"], tg_msg_id)
        if existing is None:
            # Реакція на повідомлення, якого нема в БД (старе): підтягнути один раз, без дубля.
            try:
                fetched = await self.client.get_messages(chat["tg_chat_id"], ids=tg_msg_id)
            except Exception as e:  # noqa: BLE001
                log(f"get_messages chat={chat['tg_chat_id']} id={tg_msg_id}: {e}", err=True)
                fetched = None
            if fetched is None:
                return
            await self.store_message(chat, fetched, source="live", relay=False)
            existing = await self.db.get_message_by_tg(chat["id"], tg_msg_id)
            if existing is None:
                return
        await self.apply_reactions(chat, existing, tg_msg_id, reactions, relay=True)

    async def apply_reactions(
        self,
        chat: dict[str, Any],
        msg_row: dict[str, Any],
        tg_msg_id: int,
        reactions: Any,
        *,
        relay: bool,
    ) -> None:
        results: list[tuple[str, int, bool]] = []
        for rc in getattr(reactions, "results", None) or []:
            key = _reaction_to_key(rc.reaction)
            if key:
                results.append((key, int(rc.count or 0), rc.chosen_order is not None))
        recent: list[tuple[int, str, bool, Any]] = []
        for pr in getattr(reactions, "recent_reactions", None) or []:
            key = _reaction_to_key(pr.reaction)
            pid = None
            if getattr(pr, "peer_id", None) is not None:
                try:
                    pid = utils.get_peer_id(pr.peer_id)
                except Exception:  # noqa: BLE001
                    pid = None
            if key and pid is not None and pid > 0:
                recent.append((pid, key, bool(getattr(pr, "my", False)), getattr(pr, "date", None)))

        await self.db.set_reactions_json(msg_row["id"], reactions_counts(results))
        active = await self.db.active_reactions(msg_row["id"])
        private_other = chat["tg_chat_id"] if chat["kind"] == "private" and chat["tg_chat_id"] > 0 else None
        to_add, to_close = plan_reaction_changes(active, recent, results, private_other, self.me_id)
        await self.db.close_reactions(to_close)
        for a in to_add:
            person = None
            person_id = None
            if a["person_tg_id"] is not None:
                person = await self._ensure_person(int(a["person_tg_id"]))
                person_id = person["id"] if person else None
            await self.db.add_reaction(
                message_id=msg_row["id"],
                person_id=person_id,
                emoji=a["emoji"],
                is_mine=bool(a["is_mine"]),
                added_at=a.get("date"),
            )
            if relay and chat.get("relay_to_saved") and not a["is_mine"]:
                await self._relay_reaction(chat, msg_row, tg_msg_id, person, a["emoji"])

    async def _ensure_person(self, tg_user_id: int) -> Optional[dict[str, Any]]:
        person = await self.db.get_person_by_tg(tg_user_id)
        if person is not None:
            return person
        try:
            ent = await self.client.get_entity(tg_user_id)
        except Exception:  # noqa: BLE001
            ent = None
        if isinstance(ent, User):
            await self._upsert_user(ent)
            return await self.db.get_person_by_tg(tg_user_id)
        return None

    async def _relay_reaction(
        self,
        chat: dict[str, Any],
        msg_row: dict[str, Any],
        tg_msg_id: int,
        reactor: Optional[dict[str, Any]],
        emoji: str,
    ) -> None:
        reactor_html = (
            person_link_html(reactor["first_name"], reactor["last_name"], reactor["username"], reactor["tg_user_id"])
            if reactor
            else "Хтось"
        )
        own = bool(msg_row.get("is_outgoing"))
        author_html = None
        if not own and msg_row.get("sender_tg_id"):
            author_html = person_link_html(
                msg_row.get("first_name"), msg_row.get("last_name"), msg_row.get("username"), msg_row["sender_tg_id"]
            )
        html = format_reaction_relay(
            chat["title"],
            reactor_html,
            emoji,
            msg_row.get("text") or None,
            author_html=author_html,
            own=own,
            link=message_link(chat["kind"], chat["tg_chat_id"], tg_msg_id),
        )
        await self.db.enqueue_saved(html)

    # ---------------- deletions ----------------

    async def _handle_deleted(self, chat_id: Optional[int], ids: list[int]) -> None:
        if chat_id is not None:
            chat = self.watched.get(chat_id)
            if chat is None:
                return
            await self.db.mark_deleted(chat["id"], ids)
        else:
            await self.db.mark_deleted_unscoped(ids)

    # ---------------- background loops ----------------

    async def maintenance_loop(self) -> None:
        from dzhura.jobs import gap_fill_all, sync_dialogs

        first = True
        last_heartbeat = 0.0
        last_dialogs = 0.0
        while True:
            try:
                if first:
                    await self.db.ensure_lunch_chat(self.lunch_group_id, self.lunch_group_title)
                    stale = await self.db.fail_stale_running_jobs("listener restarted")
                    if stale:
                        log(f"failed {stale} stale running job(s)")
                self.watched = await self.db.watched_chats()
                now = time.monotonic()
                if first or now - last_heartbeat >= HEARTBEAT_SEC:
                    await self.db.heartbeat(self.me_id)
                    last_heartbeat = now
                if first:
                    log(f"watching {len(self.watched)} chat(s): {', '.join(c['title'] for c in self.watched.values())}")
                    await gap_fill_all(self)
                if first or now - last_dialogs >= DIALOGS_SYNC_SEC:
                    stats = await sync_dialogs(self.client, self.db, self.me_id)
                    last_dialogs = now
                    log(f"dialogs synced: {stats}")
                first = False
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log(f"maintenance: {type(e).__name__}: {e}", err=True)
                first = False
            await asyncio.sleep(WATCHED_REFRESH_SEC)

    async def job_loop(self) -> None:
        from dzhura.jobs import backfill, sync_dialogs

        while True:
            try:
                for job in await self.db.fetch_pending_jobs(limit=1):
                    await self.db.start_job(job["id"])
                    log(f"job {job['type']} id={job['id']} params={job['params']}")
                    try:
                        if job["type"] == "sync_dialogs":
                            result = await sync_dialogs(self.client, self.db, self.me_id)
                        elif job["type"] == "backfill":
                            result = await backfill(self, job)
                        else:
                            raise ValueError(f"unknown job type: {job['type']}")
                        await self.db.complete_job(job["id"], result)
                        log(f"job done id={job['id']} {result}")
                    except asyncio.CancelledError:
                        await self.db.fail_job(job["id"], "listener stopped")
                        raise
                    except Exception as e:  # noqa: BLE001
                        log(f"job fail id={job['id']}: {type(e).__name__}: {e}", err=True)
                        await self.db.fail_job(job["id"], f"{type(e).__name__}: {e}")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log(f"job loop: {type(e).__name__}: {e}", err=True)
            await asyncio.sleep(JOB_POLL_SEC)


def attach(
    client,
    pool: asyncpg.Pool,
    me,
    lunch_group_id: int,
    lunch_group_title: Optional[str] = None,
) -> list[Coroutine[Any, Any, None]]:
    """
    Підключити Джуру до працюючого Telethon-клієнта lunch.listener.
    Викликати ДО реєстрації лунч-обробника; повертає корутини для asyncio.create_task.
    """
    db = DzhuraDB(pool)
    cap = Capture(client, db, int(me.id), int(lunch_group_id), lunch_group_title)
    client.add_event_handler(cap.on_new_message, events.NewMessage())
    client.add_event_handler(cap.on_edited, events.MessageEdited())
    client.add_event_handler(cap.on_raw_reactions, events.Raw(types=[UpdateMessageReactions]))
    client.add_event_handler(cap.on_deleted, events.MessageDeleted())
    try:
        client.flood_sleep_threshold = 300
    except Exception:  # noqa: BLE001
        pass
    log(f"attached me={me.id} lunch_group={lunch_group_id}")
    return [cap.writer(), cap.maintenance_loop(), cap.job_loop()]
