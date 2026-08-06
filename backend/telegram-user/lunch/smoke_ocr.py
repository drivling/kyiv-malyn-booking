#!/usr/bin/env python3
"""Завантажити останнє фото меню з групи і прогнати OCR (потрібен OPENAI_API_KEY)."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.ocr_menu import ocr_menu_from_image_bytes
from lunch.util import load_dotenv

load_dotenv()

GROUP_ID = int(os.environ.get("LUNCH_GROUP_ID", "-5427750954"))


async def main() -> None:
    from telethon import TelegramClient

    if not (os.environ.get("OPENAI_API_KEY") or "").strip():
        print("OPENAI_API_KEY не встановлено — OCR пропущено", file=sys.stderr)
        sys.exit(2)

    session = (os.environ.get("TELEGRAM_USER_SESSION_PATH") or "").strip() or str(
        _ROOT / "session_telegram_user"
    )
    api_id = int(os.environ["TELEGRAM_API_ID"])
    api_hash = os.environ["TELEGRAM_API_HASH"]

    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("Сесія не авторизована", file=sys.stderr)
        sys.exit(2)

    entity = await client.get_entity(GROUP_ID)
    photo_msg = None
    async for msg in client.iter_messages(entity, limit=80):
        if msg.photo:
            photo_msg = msg
            break
    if not photo_msg:
        print("Фото не знайдено", file=sys.stderr)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmp:
        path = await photo_msg.download_media(file=os.path.join(tmp, "menu.jpg"))
        data = Path(path).read_bytes()

    items, raw = await ocr_menu_from_image_bytes(data)
    print(f"message_id={photo_msg.id} date={photo_msg.date}")
    print("items:")
    for name, price in items:
        print(f"  {price:4d}  {name}")
    print("raw keys:", list(raw.keys()) if isinstance(raw, dict) else type(raw))
    await client.disconnect()
    sys.exit(0 if items else 1)


if __name__ == "__main__":
    asyncio.run(main())
