#!/usr/bin/env python3
"""CLI / spawn: python3 -m lunch.reparse — розібрати повідомлення за сьогодні.

  python3 -m lunch.reparse                  # весь день (скидає замовлення й оплати)
  python3 -m lunch.reparse --user-id 123    # лише одна людина (Telegram user id), чужого не чіпає
  python3 -m lunch.reparse --user-id 123 --no-notify
"""

from __future__ import annotations

import argparse
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

    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", type=int, default=None)
    ap.add_argument("--no-notify", action="store_true")
    args = ap.parse_args()

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
        if args.user_id is not None:
            from lunch.reparse_person import reparse_person

            out = await reparse_person(
                client, entity, db, group_id=group_id, tg_user_id=args.user_id, notify=not args.no_notify
            )
            print(json.dumps({"ok": True, **out}, ensure_ascii=False, default=str))
        else:
            stats = await reparse_day_with_client(client, entity, db, clear_orders=True)
            print(json.dumps({"ok": True, **stats.as_dict()}, ensure_ascii=False))
    finally:
        await db.close()
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
