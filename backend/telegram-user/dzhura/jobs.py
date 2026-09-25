"""
Джура · фонові задачі: синхронізація списку діалогів, gap-fill після пауз слухача,
довантаження історії за період (backfill).

Усе через той самий Telethon-клієнт lunch.listener. Нічого не читаємо «за власника»
(жодного send_read_acknowledge) і нічого не пишемо у чати.
"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from telethon.errors import FloodWaitError
from telethon.tl.types import Channel, Chat, User

from dzhura.capture import Capture, log
from dzhura.db import DzhuraDB

KYIV = ZoneInfo("Europe/Kyiv")
GAP_FILL_LIMIT = 500
PROGRESS_EVERY = 100


def kyiv_range_utc(from_str: str, to_str: str) -> tuple[datetime, datetime]:
    """Доби Києва [from 00:00, to+1 00:00) → tz-aware UTC межі."""
    d1 = date.fromisoformat(from_str)
    d2 = date.fromisoformat(to_str)
    if d2 < d1:
        raise ValueError("to < from")
    start = datetime.combine(d1, time.min, tzinfo=KYIV).astimezone(timezone.utc)
    end = datetime.combine(d2 + timedelta(days=1), time.min, tzinfo=KYIV).astimezone(timezone.utc)
    return start, end


def classify_dialog(dialog, me_id: int) -> Optional[dict[str, Any]]:
    """Що це за діалог для DzhuraChat; None — пропустити (боти, канали, forbidden, свій чат)."""
    ent = dialog.entity
    if dialog.id == me_id:
        return None
    if isinstance(ent, User):
        if getattr(ent, "bot", False) or getattr(ent, "deleted", False) or getattr(ent, "is_self", False):
            return None
        kind = "private"
    elif isinstance(ent, Chat):
        if getattr(ent, "left", False) or getattr(ent, "deactivated", False):
            return None
        kind = "group"
    elif isinstance(ent, Channel):
        if getattr(ent, "left", False):
            return None
        if getattr(ent, "broadcast", False) and not getattr(ent, "megagroup", False):
            return None
        kind = "supergroup"
    else:
        return None  # ChatForbidden / ChannelForbidden
    return {
        "tg_chat_id": int(dialog.id),
        "kind": kind,
        "title": dialog.name or dialog.title or str(dialog.id),
        "username": getattr(ent, "username", None),
        "members_count": getattr(ent, "participants_count", None),
        "last_message_at": getattr(dialog, "date", None),
    }


async def sync_dialogs(client, db: DzhuraDB, me_id: int) -> dict[str, int]:
    seen = 0
    stored = 0
    async for dialog in client.iter_dialogs(ignore_migrated=True):
        seen += 1
        info = classify_dialog(dialog, me_id)
        if info is None:
            continue
        await db.upsert_chat_from_dialog(**info)
        stored += 1
    await db.set_dialogs_synced()
    return {"dialogs": seen, "chats": stored}


async def gap_fill_all(cap: Capture) -> None:
    """Після старту/паузи слухача підтягнути пропущене по кожному watched-чату (без дублів у Обране)."""
    for chat in list(cap.watched.values()):
        last_id = chat.get("last_captured_tg_message_id")
        if not last_id:
            continue
        try:
            n = 0
            async for m in cap.client.iter_messages(chat["tg_chat_id"], min_id=int(last_id), reverse=True, wait_time=1):
                if getattr(m, "action", None) is not None:
                    continue
                await cap.store_message(chat, m, source="live", relay=False)
                n += 1
                if n >= GAP_FILL_LIMIT:
                    break
            if n:
                log(f"gap-fill {chat['title']}: {n} message(s)")
        except FloodWaitError as e:
            log(f"gap-fill {chat['title']}: flood wait {e.seconds}s, skipped", err=True)
        except Exception as e:  # noqa: BLE001
            log(f"gap-fill {chat['title']}: {type(e).__name__}: {e}", err=True)


async def backfill(cap: Capture, job: dict[str, Any]) -> dict[str, Any]:
    params = job.get("params") or {}
    chat = await cap.db.get_chat_by_id(int(params["chatId"]))
    if chat is None:
        raise ValueError(f"chat {params.get('chatId')} not found")
    start_utc, end_utc = kyiv_range_utc(str(params["from"]), str(params["to"]))

    scanned = stored = updated = 0
    last_id = 0
    last_date: Optional[str] = None
    done = False
    while not done:
        try:
            kwargs: dict[str, Any] = {"reverse": True, "wait_time": 1}
            if last_id:
                kwargs["min_id"] = last_id
            else:
                kwargs["offset_date"] = start_utc
            async for m in cap.client.iter_messages(chat["tg_chat_id"], **kwargs):
                if m.date is not None and m.date >= end_utc:
                    done = True
                    break
                last_id = int(m.id)
                if getattr(m, "action", None) is not None:
                    continue  # службові (хтось приєднався тощо)
                scanned += 1
                _, inserted = await cap.store_message(chat, m, source="backfill", relay=False)
                if inserted:
                    stored += 1
                else:
                    updated += 1
                if getattr(m, "reactions", None) is not None:
                    row = await cap.db.get_message_by_tg(chat["id"], m.id)
                    if row is not None:
                        await cap.apply_reactions(chat, row, m.id, m.reactions, relay=False)
                if m.date is not None:
                    last_date = m.date.astimezone(KYIV).isoformat()
                if scanned % PROGRESS_EVERY == 0:
                    await cap.db.progress_job(
                        job["id"], {"scanned": scanned, "stored": stored, "updated": updated, "lastDate": last_date}
                    )
            else:
                done = True  # історія вичерпана
        except FloodWaitError as e:
            log(f"backfill {chat['title']}: flood wait {e.seconds}s", err=True)
            await cap.db.progress_job(
                job["id"],
                {"scanned": scanned, "stored": stored, "updated": updated, "lastDate": last_date, "floodWait": e.seconds},
            )
            await asyncio.sleep(int(e.seconds) + 1)
            continue
    return {"scanned": scanned, "stored": stored, "updated": updated, "from": params["from"], "to": params["to"]}
