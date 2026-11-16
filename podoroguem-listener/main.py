from __future__ import annotations

import asyncio
import base64
import gzip
import os
import signal
import sys
import tempfile
from pathlib import Path

from telethon import TelegramClient, events, utils

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend" / "telegram-user"))

from dzhura.capture import Capture, log  # noqa: E402
from dzhura.db import DzhuraDB  # noqa: E402
from session_lease import AsyncpgLeaseStore, SessionLease  # noqa: E402


CHAT_USERNAME = os.environ.get("PODOROGUEM_USERNAME", "PoDoroguem").lstrip("@")
SESSION_NAME = "podoroguem_account"

# Після цих помилок сесія мертва назавжди: перезапуск лише смикав би Telegram (як у lunch/listener.py).
FATAL_SESSION_EXIT = 78
FATAL_SESSION_ERRORS = {
    "AuthKeyDuplicatedError",
    "AuthKeyUnregisteredError",
    "SessionRevokedError",
    "SessionExpiredError",
    "UserDeactivatedError",
    "UserDeactivatedBanError",
}


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


async def run() -> int:
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not api_id or not api_hash or not database_url:
        raise RuntimeError("TELEGRAM_API_ID, TELEGRAM_API_HASH and DATABASE_URL are required")

    import asyncpg

    loop = asyncio.get_running_loop()
    stop = asyncio.Event()
    exit_code = 0
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    def on_lease_lost() -> None:
        nonlocal exit_code
        exit_code = 1
        stop.set()

    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=4)
    lease = SessionLease(AsyncpgLeaseStore(pool), on_lost=on_lease_lost, log=log)
    client: TelegramClient | None = None
    writer = catch_up = None
    try:
        # Під час деплою новий контейнер стартує, поки старий ще на лінії: з однією сесією з двох IP
        # Telegram анулює ключ назавжди. Тож Telethon відкриваємо лише після оренди.
        if not await lease.acquire(stop):
            return exit_code

        client = TelegramClient(materialize_session(), int(api_id), api_hash)
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
        runner = asyncio.create_task(client.run_until_disconnected())
        stopper = asyncio.create_task(stop.wait())
        try:
            await asyncio.wait({runner, stopper}, return_when=asyncio.FIRST_COMPLETED)
            if runner.done():
                runner.result()  # фатальна помилка Telethon (напр. AuthKeyDuplicatedError) летить нагору
                if not stop.is_set():
                    # З'єднання закрилось саме: ненульовий код, щоб Railway перезапустив сервіс.
                    log("Telegram connection closed unexpectedly", err=True)
                    exit_code = exit_code or 1
            else:
                log("stop requested, disconnecting")
        finally:
            stopper.cancel()
            runner.cancel()
        return exit_code
    finally:
        for task in (writer, catch_up):
            if task is not None:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        if client is not None:
            try:
                await client.disconnect()
            except Exception as e:  # не даємо збою disconnect лишити оренду без звільнення
                log(f"disconnect failed: {e}", err=True)
        # Оренду звільняємо лише після disconnect: інакше новий контейнер підключиться, поки ми ще на лінії.
        await lease.release()
        await pool.close()


def main() -> None:
    try:
        code = asyncio.run(run())
    except Exception as e:
        name = type(e).__name__
        if name in FATAL_SESSION_ERRORS:
            log(
                f"Telegram session of the PoDoroguem account is dead ({name}). Log in again with "
                "`python3 podoroguem-listener/auth.py --fresh --export` (add --qr if no code arrives) and replace "
                "TELEGRAM_USER_SESSION_BASE64 in Railway Variables of this service.",
                err=True,
            )
            sys.exit(FATAL_SESSION_EXIT)
        raise
    sys.exit(code)


if __name__ == "__main__":
    main()
