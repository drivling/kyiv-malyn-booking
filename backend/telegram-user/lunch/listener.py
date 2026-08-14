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
from lunch.parse_order import looks_like_order, parse_order_contextual  # noqa: E402
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
    format_unavailable,
)
from lunch.order_reply import (  # noqa: E402
    PersonalOrderAction,
    decide_personal_order_action,
    ocr_enabled,
)
from lunch.util import load_dotenv  # noqa: E402

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

    async def reply(event, text: str) -> Optional[int]:
        try:
            sent = await event.reply(text)
            return int(getattr(sent, "id", 0) or 0) or None
        except Exception as e:
            print(f"[lunch] reply failed: {e}", file=sys.stderr)
            try:
                sent = await client.send_message(entity, text)
                return int(getattr(sent, "id", 0) or 0) or None
            except Exception as e2:
                print(f"[lunch] send_message failed: {e2}", file=sys.stderr)
                return None

    @client.on(events.NewMessage(chats=group_id, incoming=True, outgoing=True))
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

        # Власні відповіді listener (антилуп): не парсити як замовлення
        if getattr(msg, "out", False) and text:
            echo_prefixes = (
                "Меню на сьогодні:",
                "Зведення обідів",
                "Прийом замовлень",
                "Хто ще винен:",
                "Боргів немає",
                "День закрито",
                "День відкрито",
                "Картка для оплати",
                "Фото отримано",
                "Зафіксовано людей:",
            )
            if text.startswith(echo_prefixes) or ", заказ:" in text.lower() or ": зараховано " in text.lower() or ", сьогодні немає:" in text.lower():
                return

        # --- фото меню ---
        if msg.photo:
            print(f"[lunch] photo from {name} id={msg.id}")
            # Без OPENAI_API_KEY — мовчки ігноруємо (меми після обіду не спамимо)
            if not ocr_enabled(os.environ.get("OPENAI_API_KEY")):
                print("[lunch] photo ignored (OCR off)")
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
                tray_price = await db.get_tray_price()
                await reply(event, format_menu(menu_rows, tray_price))
                notices = await db.sync_orders_after_menu(day.id)
                for n in notices:
                    await reply(event, format_unavailable(n["display_name"], n["missing_dishes"]))
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
            fallback = await db.get_fallback_menu(day.id)
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
                result = parse_order_contextual(draft.raw_text, menu, fallback)
                await db.upsert_order(
                    day.id,
                    pid,
                    draft.raw_text,
                    result.total_uah,
                    result.lines,
                    source_message_id=msg.id,
                    unmatched_text=result.unmatched_text or None,
                )
                total_all += result.total_uah
                preview.append(f"• {draft.display_name}: {result.total_uah} грн")

            has_dozazak = False
            if parsed.dozazak_raw:
                has_dozazak = True
                pid = await db.upsert_participant(DOZAZAK_TELEGRAM_ID, DOZAZAK_DISPLAY_NAME, None)
                result = parse_order_contextual(parsed.dozazak_raw, menu, fallback)
                await db.upsert_order(
                    day.id,
                    pid,
                    parsed.dozazak_raw,
                    result.total_uah,
                    result.lines,
                    source_message_id=msg.id,
                    unmatched_text=result.unmatched_text or None,
                )
                total_all += result.total_uah
                preview.append(f"• {DOZAZAK_DISPLAY_NAME}: {result.total_uah} грн")

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
            print(f"[lunch] command {cmd!r} from {name} out={getattr(msg, 'out', False)} id={msg.id}")
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
                tray_price = await db.get_tray_price()
                await reply(event, format_menu(items, tray_price))
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

        day = await db.get_or_create_day(today_kyiv())

        today_menu = await db.list_menu_items(day.id)
        fallback = await db.get_fallback_menu(day.id)
        if not today_menu and not fallback:
            return

        # Підсумок інколи приходить без «>» у тексті Telethon — перевірка ще раз
        if looks_like_day_summary(text):
            return

        result = parse_order_contextual(text, today_menu, fallback)
        dish_count = sum(l.qty for l in result.lines)
        if not result.lines and not result.unavailable:
            return
        action = decide_personal_order_action(
            day_status=day.status,
            matched_line_count=max(len(result.lines), 1 if result.unavailable else 0),
            dish_qty_total=dish_count or (1 if result.unavailable else 0),
        )
        if action == PersonalOrderAction.DAY_CLOSED:
            await reply(event, "Прийом замовлень закрито.")
            return
        if action == PersonalOrderAction.MEGA:
            print(f"[lunch] skip mega-order ({dish_count}) from {name} id={msg.id}")
            await reply(
                event,
                f"{name}, схоже на підсумок/дамп ({dish_count} позицій), не записав як особисте замовлення. "
                "Надішли підсумок з цитатами або натисни «Розібрати день» в адмінці.",
            )
            return

        if not uid:
            return

        if result.unavailable and not result.lines:
            await reply(event, format_unavailable(name, result.unavailable))
            return

        pid = await db.upsert_participant(uid, name, f"@{username}" if username else None)
        order_id = await db.upsert_order(
            day.id,
            pid,
            text,
            result.total_uah,
            result.lines,
            source_message_id=msg.id,
            unmatched_text=result.unmatched_text or None,
        )
        for line in result.lines:
            if line.dish_id and line.as_written:
                await db.save_synonym(line.dish_id, line.as_written)
        tray_price = await db.get_tray_price()
        trays, tray_sum, grand = await db.apply_trays_to_lines(result.lines)
        confirm = format_order_confirm(
            name,
            result.lines,
            grand,
            result.unmatched,
            tray_count=trays,
            tray_price_uah=tray_price,
            tray_total_uah=tray_sum,
            unavailable=result.unavailable,
        )
        reply_id = await reply(event, confirm)
        if reply_id:
            await db.set_order_reply_message_id(order_id, reply_id)

    async def outbound_loop() -> None:
        while True:
            try:
                pending = await db.fetch_pending_outbound(limit=5)
                for row in pending:
                    try:
                        kind = row.get("kind") or "send"
                        if kind == "edit" and row.get("telegram_message_id"):
                            await client.edit_message(entity, int(row["telegram_message_id"]), row["text"])
                        elif row.get("reply_to_message_id"):
                            await client.send_message(
                                entity, row["text"], reply_to=int(row["reply_to_message_id"])
                            )
                        else:
                            await client.send_message(entity, row["text"])
                        await db.mark_outbound_sent(row["id"])
                        print(f"[lunch] outbound sent id={row['id']} kind={kind}")
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
