from __future__ import annotations

import asyncio
import base64
import gzip
import os
import sys
import tempfile
from pathlib import Path

from telethon import TelegramClient, events, utils

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend" / "telegram-user"))

from dzhura.capture import Capture, log  # noqa: E402
from dzhura.db import DzhuraDB  # noqa: E402


CHAT_USERNAME = os.environ.get("PODOROGUEM_USERNAME", "PoDoroguem").lstrip("@")
SESSION_NAME = "podoroguem_account"


def materialize_session() -> str:
    # auth_session.py uses the established TELEGRAM_USER_SESSION_BASE64 name.
    # Keep the shorter alias too for hand-created secrets.
    encoded = (
        os.environ.get("TELEGRAM_USER_SESSION_BASE64", "").strip()
        or os.environ.get("TELEGRAM_SESSION_BASE64", "").strip()
    )
    if not encoded:
        path = os.environ.get("TELEGRAM_SESSION_PATH", "").strip()
        if not path:
            raise RuntimeError("Set TELEGRAM_USER_SESSION_BASE64 in Railway Variables")
        return path

    raw = base64.b64decode(encoded)
    if raw.startswith(b"\x1f\x8b"):
        raw = gzip.decompress(raw)
    session_file = Path(tempfile.gettempdir()) / f"{SESSION_NAME}.session"
    session_file.write_bytes(raw)
    session_file.chmod(0o600)
    return str(session_file.with_suffix(""))


async def run() -> None:
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not api_id or not api_hash or not database_url:
        raise RuntimeError("TELEGRAM_API_ID, TELEGRAM_API_HASH and DATABASE_URL are required")

    import asyncpg

    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=4)
    client = TelegramClient(materialize_session(), int(api_id), api_hash)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            raise RuntimeError("Telegram session is not authorized; create and export it locally")

        me = await client.get_me()
        entity = await client.get_entity(CHAT_USERNAME)
        chat_id = int(utils.get_peer_id(entity))
        title = getattr(entity, "title", None) or CHAT_USERNAME
        db = DzhuraDB(pool)
        await db.upsert_chat_from_dialog(
            tg_chat_id=chat_id,
            kind="supergroup",
            title=title,
            username=CHAT_USERNAME,
            members_count=getattr(entity, "participants_count", None),
            last_message_at=None,
        )
        async with pool.acquire() as conn:
            await conn.execute(
                'UPDATE "DzhuraChat" SET "captureEnabled" = TRUE, "updatedAt" = NOW() WHERE "tgChatId" = $1',
                chat_id,
            )

        cap = Capture(client, db, int(me.id), 0, title)
        cap.watched = {
            int(k): v for k, v in (await db.watched_chats()).items() if int(k) == chat_id
        }
        if not cap.watched:
            raise RuntimeError(f"Could not enable capture for {CHAT_USERNAME}")
        # The independent listener captures only this group and never relays messages or handles Dzhura jobs.
        cap.watched[chat_id]["relay_to_saved"] = False
        client.add_event_handler(cap.on_new_message, events.NewMessage(chats=entity))
        client.add_event_handler(cap.on_edited, events.MessageEdited(chats=entity))
        client.add_event_handler(cap.on_raw_reactions, events.Raw())
        client.add_event_handler(cap.on_deleted, events.MessageDeleted(chats=entity))

        from dzhura.jobs import gap_fill_all

        await gap_fill_all(cap)
        log(f"PoDoroguem listener online me={me.id} chat={title} id={chat_id}")
        writer = asyncio.create_task(cap.writer())

        async def catch_up_loop() -> None:
            while True:
                await asyncio.sleep(60)
                await gap_fill_all(cap)

        catch_up = asyncio.create_task(catch_up_loop())
        try:
            await client.run_until_disconnected()
        finally:
            writer.cancel()
            catch_up.cancel()
            for task in (writer, catch_up):
                try:
                    await task
                except asyncio.CancelledError:
                    pass
    finally:
        await client.disconnect()
        await pool.close()


if __name__ == "__main__":
    asyncio.run(run())
