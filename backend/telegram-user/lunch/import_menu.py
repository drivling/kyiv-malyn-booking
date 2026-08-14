#!/usr/bin/env python3
"""
Імпорт меню з JSON (відповідь ChatGPT) → Postgres + повідомлення в групу.

  python3 -m lunch.import_menu menu.json
  pbpaste | python3 -m lunch.import_menu
  python3 -m lunch.import_menu --no-post menu.json   # тільки БД

Env: DATABASE_URL, TELEGRAM_* (для посту), LUNCH_GROUP_ID
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

from lunch.db import LunchDB, today_kyiv
from lunch.formatters import format_menu
from lunch.ocr_menu import _extract_json, parse_menu_items_payload
from lunch.util import load_dotenv

load_dotenv()

DEFAULT_GROUP_ID = -5427750954


def _read_raw(path: str | None) -> str:
    if path and path != "-":
        return Path(path).read_text(encoding="utf-8")
    return sys.stdin.read()


def _parse_items(raw: str) -> tuple[list[tuple[str, int]], dict]:
    text = raw.strip()
    if not text:
        raise SystemExit("Порожній ввід — потрібен JSON меню")
    try:
        data = _extract_json(text)
    except json.JSONDecodeError as e:
        # інколи ChatGPT додає текст до/після JSON
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            data = _extract_json(text[start : end + 1])
        else:
            raise SystemExit(f"Не валідний JSON: {e}") from e
    items = parse_menu_items_payload(data)
    if not items:
        raise SystemExit("У JSON немає items з name+price")
    return items, data if isinstance(data, dict) else {"items": items}


async def _post_to_group(text: str) -> None:
    from telethon import TelegramClient

    session = (os.environ.get("TELEGRAM_USER_SESSION_PATH") or "").strip() or str(
        _ROOT / "session_telegram_user"
    )
    api_id = (os.environ.get("TELEGRAM_API_ID") or "").strip()
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    if not api_id or not api_hash:
        raise SystemExit("TELEGRAM_API_ID / TELEGRAM_API_HASH потрібні для посту в групу")
    group_id = int((os.environ.get("LUNCH_GROUP_ID") or str(DEFAULT_GROUP_ID)).strip())

    client = TelegramClient(session, int(api_id), api_hash)
    await client.connect()
    try:
        if not await client.is_user_authorized():
            raise SystemExit("Сесія не авторизована")
        entity = await client.get_entity(group_id)
        await client.send_message(entity, text)
        print(f"[import_menu] posted to group {group_id}")
    finally:
        await client.disconnect()


async def run(raw: str, *, post: bool) -> None:
    items, data = _parse_items(raw)
    print("[import_menu] parsed:")
    for name, price in items:
        print(f"  {price:4d}  {name}")

    db = await LunchDB.connect()
    try:
        day = await db.get_or_create_day(today_kyiv())
        rows = await db.replace_menu(day.id, items, parsed_raw=data)
        notices = await db.sync_orders_after_menu(day.id)
        tray_price = await db.get_tray_price()
        msg = format_menu(rows, tray_price)
        print("[import_menu] saved day_id=", day.id, "items=", len(rows))
        if notices:
            print("[import_menu] unavailable notices:", notices)
    finally:
        await db.close()

    if post:
        await _post_to_group(msg)
    else:
        print("[import_menu] --no-post: повідомлення в групу не надсилалось")
        print("---")
        print(msg)


def main() -> None:
    parser = argparse.ArgumentParser(description="Імпорт меню JSON → БД + група")
    parser.add_argument(
        "file",
        nargs="?",
        default="-",
        help="файл JSON або - (stdin)",
    )
    parser.add_argument(
        "--no-post",
        action="store_true",
        help="тільки записати в БД, не писати в Telegram",
    )
    args = parser.parse_args()
    raw = _read_raw(None if args.file == "-" else args.file)
    asyncio.run(run(raw, post=not args.no_post))


if __name__ == "__main__":
    main()
