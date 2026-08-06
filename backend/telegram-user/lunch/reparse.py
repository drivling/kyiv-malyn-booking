#!/usr/bin/env python3
"""CLI / spawn: python3 -m lunch.reparse — розібрати повідомлення за сьогодні."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.db import LunchDB
from lunch.reparse_day import reparse_day_with_client
from lunch.util import load_dotenv

load_dotenv()

DEFAULT_GROUP_ID = -5427750954


async def main() -> None:
    from telethon import TelegramClient

    session = (os.environ.get("TELEGRAM_USER_SESSION_PATH") or "").strip() or str(
        _ROOT / "session_telegram_user"
    )
    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]
    group_id = int((os.environ.get("LUNCH_GROUP_ID") or str(DEFAULT_GROUP_ID)).strip())

    db = await LunchDB.connect()
    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            print(json.dumps({"ok": False, "error": "not authorized"}))
            sys.exit(2)
        entity = await client.get_entity(group_id)
        stats = await reparse_day_with_client(client, entity, db, clear_orders=True)
        print(json.dumps({"ok": True, **stats.as_dict()}, ensure_ascii=False))
    finally:
        await db.close()
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
