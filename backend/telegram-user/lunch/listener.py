#!/usr/bin/env python3
"""
Telethon-слухач групи «Обіди для НЕ бідних».

Запуск з каталогу telegram-user:
  python3 -m lunch.listener

Env: DATABASE_URL, TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_USER_SESSION_PATH,
     OPENAI_API_KEY, LUNCH_GROUP_ID (default -5427750954), LUNCH_OPERATOR_IDS (comma)
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional, Set

# Дозволити `python3 -m lunch.listener` з telegram-user/
_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from lunch.db import LunchDB, today_kyiv  # noqa: E402
from lunch.ocr_menu import ocr_menu_from_image_bytes  # noqa: E402
from lunch.parse_order import looks_like_order, parse_order  # noqa: E402
from lunch.parse_payment import looks_like_card_number, parse_payment  # noqa: E402
from lunch.parse_summary import (  # noqa: E402
    DOZAZAK_DISPLAY_NAME,
    DOZAZAK_TELEGRAM_ID,
    looks_like_day_summary,
    parse_day_summary,
    synthetic_telegram_id,
)
from lunch.formatters import (  # noqa: E402
    format_day_closed_from_summary,
    format_debts,
    format_menu,
    format_order_confirm,
    format_payment_reply,
    format_summary,
)
from lunch.util import load_dotenv, split_order_parts  # noqa: E402

load_dotenv()

DEFAULT_GROUP_ID = -5427750954


def _group_id() -> int:
    raw = (os.environ.get("LUNCH_GROUP_ID") or str(DEFAULT_GROUP_ID)).strip()
    return int(raw)


def _operator_ids() -> Set[int]:
    raw = (os.environ.get("LUNCH_OPERATOR_IDS") or "").strip()
    if not raw:
        return set()
    out: Set[int] = set()
    for part in raw.split(","):
        part = part.strip()
        if part:
            out.add(int(part))
    return out


def _session_path() -> str:
    path = (os.environ.get("TELEGRAM_USER_SESSION_PATH") or "").strip()
    if path:
        return path
    default = _ROOT / "session_telegram_user"
    return str(default)


def _api_creds():
    api_id = (os.environ.get("TELEGRAM_API_ID") or "").strip()
    api_hash = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
    if not api_id or not api_hash:
        print("TELEGRAM_API_ID та TELEGRAM_API_HASH мають бути встановлені", file=sys.stderr)
        sys.exit(2)
    return int(api_id), api_hash


def _display_name(sender) -> str:
    if sender is None:
        return "Невідомий"
    parts = []
    if getattr(sender, "first_name", None):
        parts.append(sender.first_name)
    if getattr(sender, "last_name", None):
        parts.append(sender.last_name)
    if parts:
        return " ".join(parts)
    if getattr(sender, "username", None):
        return f"@{sender.username}"
    return str(getattr(sender, "id", "Невідомий"))


def _is_operator(sender, operators: Set[int], me_id: Optional[int]) -> bool:
    if sender is None:
        return False
    uid = int(sender.id)
    if operators and uid in operators:
        return True
    if not operators and me_id is not None and uid == me_id:
        return True
    return False


async def run() -> None:
    from telethon import TelegramClient, events

    group_id = _group_id()
    operators = _operator_ids()
    session = _session_path()
    api_id, api_hash = _api_creds()

    db = await LunchDB.connect()
    client = TelegramClient(session, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        print("Сесія не авторизована. Запустіть auth_session.py", file=sys.stderr)
        await db.close()
        sys.exit(2)

    me = await client.get_me()
    me_id = int(me.id) if me else None
    entity = await client.get_entity(group_id)
    print(f"[lunch] listening group={getattr(entity, 'title', group_id)} id={group_id} me={me_id}")

    async def reply(event, text: str) -> None:
        try:
            await event.reply(text)
        except Exception as e:
            print(f"[lunch] reply failed: {e}", file=sys.stderr)
            await client.send_message(entity, text)

    @client.on(events.NewMessage(chats=group_id))
    async def handler(event):
        msg = event.message
        if not msg:
            return
        # ігноруємо власні службові відповіді з префіксами? — ні, команди від себе ок
        sender = await msg.get_sender()
        name = _display_name(sender)
        uid = str(getattr(sender, "id", "")) if sender else ""
        username = getattr(sender, "username", None) if sender else None
        text = (msg.message or msg.text or "").strip() if (msg.message or msg.text) else ""

        # --- фото меню ---
        if msg.photo:
            print(f"[lunch] photo from {name} id={msg.id}")
            if not (os.environ.get("OPENAI_API_KEY") or "").strip():
                await reply(
                    event,
                    "Фото отримано. OCR вимкнено (немає OPENAI_API_KEY). "
                    "Імпортуй меню через адмінку «Столова» (JSON з ChatGPT).",
                )
                return
            try:
                with tempfile.TemporaryDirectory() as tmp:
                    path = await msg.download_media(file=os.path.join(tmp, "menu.jpg"))
                    if not path:
                        await reply(event, "Не вдалося завантажити фото меню.")
                        return
                    data = Path(path).read_bytes()
                items, raw = await ocr_menu_from_image_bytes(data)
                print("[lunch] OCR items:", items)
                if not items:
                    await reply(event, "Не розпізнав страви з цінами на фото. Спробуй чіткіше фото.")
                    return
                day = await db.get_or_create_day(today_kyiv())
                menu_rows = await db.replace_menu(
                    day.id,
                    items,
                    menu_message_id=msg.id,
                    parsed_raw=raw,
                )
                await reply(event, format_menu(menu_rows))
            except Exception as e:
                print(f"[lunch] OCR error: {e}", file=sys.stderr)
                await reply(event, f"Помилка OCR меню: {e}")
            return

        if not text:
            return

        # --- підсумок дня (цитати Святослава) → закрити прийом ---
        if looks_like_day_summary(text):
            parsed = parse_day_summary(text)
            if not parsed.ok:
                return
            day = await db.get_or_create_day(today_kyiv())
            menu = await db.list_menu_items(day.id)
            preview: list[str] = []
            total_all = 0
            for draft in parsed.named:
                # якщо це реальний відправник підсумку — привʼязати його telegram id
                sender_first = (name.split()[0].lower() if name else "")
                draft_l = draft.display_name.strip().lower()
                if uid and draft_l in (name.strip().lower(), sender_first):
                    pid = await db.upsert_participant(
                        uid, draft.display_name, f"@{username}" if username else None
                    )
                else:
                    existing = await db.find_participant_id_by_display_name(draft.display_name)
                    if existing:
                        pid = existing
                    else:
                        pid = await db.upsert_participant(
                            synthetic_telegram_id(draft.display_name),
                            draft.display_name,
                            None,
                        )
                if menu:
                    result = parse_order(draft.raw_text, menu)
                    await db.upsert_order(
                        day.id,
                        pid,
                        draft.raw_text,
                        result.total_uah,
                        result.lines,
                        source_message_id=msg.id,
                    )
                    total_all += result.total_uah
                    preview.append(f"• {draft.display_name}: {result.total_uah} грн")
                else:
                    await db.upsert_order(
                        day.id,
                        pid,
                        draft.raw_text,
                        0,
                        [],
                        source_message_id=msg.id,
                    )
                    preview.append(f"• {draft.display_name}: (без меню/цін)")

            has_dozazak = False
            if parsed.dozazak_raw:
                has_dozazak = True
                pid = await db.upsert_participant(DOZAZAK_TELEGRAM_ID, DOZAZAK_DISPLAY_NAME, None)
                if menu:
                    result = parse_order(parsed.dozazak_raw, menu)
                    await db.upsert_order(
                        day.id,
                        pid,
                        parsed.dozazak_raw,
                        result.total_uah,
                        result.lines,
                        source_message_id=msg.id,
                    )
                    total_all += result.total_uah
                    preview.append(f"• {DOZAZAK_DISPLAY_NAME}: {result.total_uah} грн")
                else:
                    await db.upsert_order(
                        day.id,
                        pid,
                        parsed.dozazak_raw,
                        0,
                        [],
                        source_message_id=msg.id,
                    )
                    preview.append(f"• {DOZAZAK_DISPLAY_NAME}: (без меню/цін)")

            await db.set_day_status(day.id, "closed")
            await reply(
                event,
                format_day_closed_from_summary(
                    len(parsed.named), has_dozazak, total_all, preview
                ),
            )
            print(
                f"[lunch] day summary closed named={len(parsed.named)} "
                f"dozazak={has_dozazak} total={total_all}"
            )
            return

        # --- картка ---
        card = looks_like_card_number(text)
        if card and len(text.replace(" ", "")) <= 20:
            day = await db.get_or_create_day(today_kyiv())
            async with db.pool.acquire() as conn:
                await conn.execute(
                    """UPDATE "LunchDay" SET "payeeCard" = $2, "updatedAt" = NOW() WHERE id = $1""",
                    day.id,
                    card,
                )
            await reply(event, f"Картка для оплати збережена: {card[:4]}…{card[-4:]}")
            return

        low = text.lower().strip()

        # --- команди ---
        if low.startswith("!"):
            cmd = low.split()[0]
            is_op = _is_operator(sender, operators, me_id)
            day = await db.get_day(today_kyiv())
            if cmd in ("!summary", "!зведення", "!сводка"):
                if not day:
                    await reply(event, "Сьогодні ще немає дня обідів.")
                    return
                rows = await db.summary_rows(day.id)
                await reply(event, format_summary(rows, day.status))
                return
            if cmd in ("!debts", "!борги", "!борг"):
                if not day:
                    await reply(event, "Сьогодні ще немає дня обідів.")
                    return
                await reply(event, format_debts(await db.debts(day.id)))
                return
            if cmd in ("!close", "!закрити"):
                if not is_op:
                    await reply(event, "Тільки оператор може закрити день.")
                    return
                if not day:
                    await reply(event, "Немає відкритого дня.")
                    return
                await db.set_day_status(day.id, "closed")
                await reply(event, "День закрито. Нові замовлення не приймаються.")
                return
            if cmd in ("!open", "!відкрити"):
                if not is_op:
                    return
                day = await db.get_or_create_day(today_kyiv())
                await db.set_day_status(day.id, "ordering")
                await reply(event, "День відкрито для замовлень.")
                return
            if cmd in ("!menu", "!меню"):
                if not day:
                    await reply(event, "Меню ще немає.")
                    return
                items = await db.list_menu_items(day.id)
                await reply(event, format_menu(items))
                return
            if cmd in ("!pay",) or low.startswith("!pay "):
                # handled below as payment
                pass
            else:
                return

        # --- оплата ---
        pay = parse_payment(text)
        if pay:
            day = await db.get_day(today_kyiv())
            if not day:
                await reply(event, "Сьогодні ще немає дня обідів — спочатку меню.")
                return
            if not uid:
                return
            pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
            await db.add_payment(day.id, pid, pay.amount_uah, text, source_message_id=msg.id)
            ordered, paid, debt = await db.participant_balance(day.id, pid)
            await reply(event, format_payment_reply(name, pay.amount_uah, ordered, paid, debt))
            return

        # --- замовлення ---
        if not looks_like_order(text):
            return

        day = await db.get_day(today_kyiv())
        if not day:
            return
        if day.status == "closed":
            await reply(event, "Прийом замовлень закрито.")
            return

        menu = await db.list_menu_items(day.id)
        if not menu:
            return

        result = parse_order(text, menu)
        # якщо нічого не збіглося — ігноруємо як звичайний чат (або відповідаємо якщо схоже на замовлення)
        if not result.lines and result.unmatched:
            # лише якщо виглядає як список страв
            if "|" in text or "," in text or len(split_order_parts(text)) >= 2:
                await reply(event, f"{name}, не розпізнав замовлення. Уточни назви по меню.")
            return

        if not result.lines:
            return

        if not uid:
            return
        pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
        await db.upsert_order(
            day.id,
            pid,
            text,
            result.total_uah,
            result.lines,
            source_message_id=msg.id,
        )
        await reply(
            event,
            format_order_confirm(name, result.lines, result.total_uah, result.unmatched),
        )

    async def outbound_loop() -> None:
        while True:
            try:
                pending = await db.fetch_pending_outbound(limit=5)
                for row in pending:
                    try:
                        await client.send_message(entity, row["text"])
                        await db.mark_outbound_sent(row["id"])
                        print(f"[lunch] outbound sent id={row['id']}")
                    except Exception as e:
                        print(f"[lunch] outbound fail id={row['id']}: {e}", file=sys.stderr)
                        await db.mark_outbound_failed(row["id"], str(e))

                jobs = await db.fetch_pending_jobs(limit=2)
                for job in jobs:
                    if job["type"] == "reparse_today":
                        try:
                            from lunch.reparse_day import reparse_day_with_client

                            print(f"[lunch] job reparse_today id={job['id']}")
                            stats = await reparse_day_with_client(
                                client, entity, db, clear_orders=True
                            )
                            await db.complete_job(job["id"], stats.as_dict())
                            print(f"[lunch] job done id={job['id']} {stats.as_dict()}")
                        except Exception as e:
                            print(f"[lunch] job fail id={job['id']}: {e}", file=sys.stderr)
                            await db.fail_job(job["id"], str(e))
                    else:
                        await db.fail_job(job["id"], f"unknown job type: {job['type']}")
            except Exception as e:
                print(f"[lunch] outbound loop: {e}", file=sys.stderr)
            await asyncio.sleep(2)

    outbound_task = asyncio.create_task(outbound_loop())
    print("[lunch] started (events + outbound queue). Ctrl+C to stop.")
    try:
        await client.run_until_disconnected()
    finally:
        outbound_task.cancel()
        try:
            await outbound_task
        except asyncio.CancelledError:
            pass
        await db.close()
        await client.disconnect()


def main() -> None:
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("\n[lunch] stopped")


if __name__ == "__main__":
    main()
