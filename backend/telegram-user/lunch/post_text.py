#!/usr/bin/env python3
"""Надіслати текст зі stdin у групу обідів (від особистого акаунта)."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.util import load_dotenv

load_dotenv()

DEFAULT_GROUP_ID = -5427750954


async def main() -> None:
    from telethon import TelegramClient

    text = sys.stdin.read()
    if not text.strip():
        print("Порожній текст", file=sys.stderr)
        sys.exit(2)

    session = (os.environ.get("TELEGRAM_USER_SESSION_PATH") or "").strip() or str(
        _ROOT / "session_telegram_user"
    )
    api_id = (os.environ.get("TELEGRAM_API_ID") or "").strip()
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    if not api_id or not api_hash:
        print("TELEGRAM_API_* missing", file=sys.stderr)
        sys.exit(2)

    group_id = int((os.environ.get("LUNCH_GROUP_ID") or str(DEFAULT_GROUP_ID)).strip())
    client = TelegramClient(session, int(api_id), api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            print("not authorized", file=sys.stderr)
            sys.exit(2)
        entity = await client.get_entity(group_id)
        await client.send_message(entity, text)
        print("ok")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
