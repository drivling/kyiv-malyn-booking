#!/usr/bin/env python3
"""
Локальна перевірка: в якому форматі Telegram API (contacts.resolvePhone) приймає номер.
Запуск: python3 test_resolve_phone.py <номер>
Приклад: python3 test_resolve_phone.py 0501399910

Використовує ті самі TELEGRAM_USER_SESSION_PATH, TELEGRAM_API_ID, TELEGRAM_API_HASH.
Повідомлення не відправляє — тільки викликає ResolvePhone для різних варіантів формату.
"""

import asyncio
import os
import sys

# Імпорт функцій із send_message (нормалізація та формати)
from send_message import (
    get_session_path,
    get_api_credentials,
    normalize_phone,
    format_phone_telegram_style,
)


def get_format_variants(phone_raw: str):
    """Усі варіанти формату номера для перевірки API (мінімум 2–3 спроби)."""
    norm = normalize_phone(phone_raw)
    if not norm or len(norm) < 12:
        return []
    # Україна 380XXXXXXXXX — перевіряємо всі варіанти, API приймає по-різному
    return [
        ("E.164 з +", "+" + norm),
        ("+380(XX)XXXXXXX", format_phone_telegram_style(norm)),
        ("без + (тільки цифри)", norm),
        ("з пробілами +380 XX XXX XX XX", f"+380 {norm[3:5]} {norm[5:8]} {norm[8:10]} {norm[10:12]}"),
    ]


async def main():
    if len(sys.argv) < 2:
        print("Використання: python3 test_resolve_phone.py <номер>", file=sys.stderr)
        print("Приклад: python3 test_resolve_phone.py 0501399910", file=sys.stderr)
        sys.exit(2)

    phone_raw = sys.argv[1].strip()
    variants = get_format_variants(phone_raw)
    if not variants:
        print("Не вдалося отримати варіанти формату з номера.", file=sys.stderr)
        sys.exit(2)

    session_path = get_session_path()
    api_id, api_hash = get_api_credentials()

    from telethon import TelegramClient
    from telethon.tl.functions.contacts import ResolvePhoneRequest

    client = TelegramClient(session_path, api_id, api_hash)

    try:
        await client.connect()
        if not await client.is_user_authorized():
            print("Сесія не авторизована. Запустіть auth_session.py", file=sys.stderr)
            sys.exit(2)

        print(f"Перевірка ResolvePhone для номера (нормалізовано: {normalize_phone(phone_raw)})\n")
        ok_count = 0
        for name, value in variants:
            try:
                result = await client(ResolvePhoneRequest(phone=value))
                if result.users:
                    user = result.users[0]
                    uname = getattr(user, "first_name", "") or ""
                    ok_count += 1
                    print(f"  OK   [{name}] {value!r} -> знайдено: {uname}")
                else:
                    print(f"  —    [{name}] {value!r} -> users пусто")
            except Exception as e:
                print(f"  FAIL [{name}] {value!r} -> {e}")

        print(f"\nПідсумок: API прийняло {ok_count} з {len(variants)} форматів.")
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
