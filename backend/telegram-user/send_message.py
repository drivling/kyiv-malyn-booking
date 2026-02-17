#!/usr/bin/env python3
"""
Відправка одного повідомлення від вашого Telegram-акаунта по номеру телефону.
Використовується для одноразового промо користувачам, які ще не в боті.

Виклик: python3 send_message.py <phone>
Текст повідомлення читається з stdin (UTF-8).

Змінні середовища:
  TELEGRAM_USER_SESSION_PATH — шлях до файлу сесії (наприклад .../session_telegram_user)
  TELEGRAM_API_ID, TELEGRAM_API_HASH — з https://my.telegram.org/apps

Коди виходу:
  0 — повідомлення надіслано
  1 — користувача не знайдено або номер приховано в приватності
  2 — інша помилка
"""

import os
import sys
import asyncio
from telethon import TelegramClient
from telethon.tl.functions.contacts import ResolvePhoneRequest
from telethon.errors import PhoneNumberInvalidError, NumberBannedError


def get_session_path():
    path = os.environ.get("TELEGRAM_USER_SESSION_PATH", "").strip()
    if not path:
        print("TELEGRAM_USER_SESSION_PATH не встановлено", file=sys.stderr)
        sys.exit(2)
    return path


def get_api_credentials():
    api_id = os.environ.get("TELEGRAM_API_ID", "").strip()
    api_hash = os.environ.get("TELEGRAM_API_HASH", "").strip()
    if not api_id or not api_hash:
        print("TELEGRAM_API_ID та TELEGRAM_API_HASH мають бути встановлені", file=sys.stderr)
        sys.exit(2)
    return int(api_id), api_hash


def normalize_phone(phone: str) -> str:
    """Нормалізація номера до формату для Telegram (наприклад 380671234567)."""
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("0"):
        digits = "38" + digits
    elif not digits.startswith("38"):
        digits = "38" + digits
    return digits


async def main():
    if len(sys.argv) < 2:
        print("Використання: send_message.py <phone>", file=sys.stderr)
        sys.exit(2)

    phone_arg = sys.argv[1].strip()
    if not phone_arg:
        sys.exit(2)

    message = sys.stdin.read()
    if not message or not message.strip():
        print("Порожнє повідомлення", file=sys.stderr)
        sys.exit(2)

    session_path = get_session_path()
    api_id, api_hash = get_api_credentials()
    phone = normalize_phone(phone_arg)

    client = TelegramClient(session_path, api_id, api_hash)

    try:
        await client.connect()
        if not await client.is_user_authorized():
            print("Сесія не авторизована. Запустіть auth_session.py", file=sys.stderr)
            sys.exit(2)

        # Resolve phone -> user (тільки якщо у користувача не приховано номер)
        try:
            result = await client(ResolvePhoneRequest(phone))
        except (PhoneNumberInvalidError, ValueError) as e:
            print(f"Номер недійсний або прихований: {e}", file=sys.stderr)
            sys.exit(1)
        except Exception as e:
            print(f"ResolvePhone помилка: {e}", file=sys.stderr)
            sys.exit(1)

        if not result.users:
            print("Користувача не знайдено", file=sys.stderr)
            sys.exit(1)
        user = result.users[0]
        await client.send_message(user, message, parse_mode="html")
        sys.exit(0)

    except NumberBannedError:
        print("Номер заблоковано", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Помилка: {e}", file=sys.stderr)
        sys.exit(2)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
