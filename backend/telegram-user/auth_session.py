#!/usr/bin/env python3
"""
Одноразова авторизація вашого Telegram-акаунта для відправки повідомлень по номеру телефону.
Зберігає сесію у файл; цей файл потрібно розмістити на сервері та вказати в TELEGRAM_USER_SESSION_PATH.

Кроки:
  1. Отримайте API_ID та API_HASH на https://my.telegram.org/apps
  2. Встановіть змінні середовища або відредагуйте значення нижче.
  3. Запустіть: python3 auth_session.py
  4. Введіть номер телефону (у міжнародному форматі, напр. +380671234567).
  5. Введіть код з Telegram.
  6. Якщо увімкнено 2FA — введіть пароль.
  7. Файл сесії з’явиться у поточній директорії (або в TELEGRAM_USER_SESSION_PATH).
  8. Завантажте цей файл + session_telegram_user.session-journal (якщо є) на сервер.
"""

import os
import sys
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

# За замовчуванням — поточна директорія; можна задати TELEGRAM_USER_SESSION_PATH
SESSION_NAME = os.environ.get("TELEGRAM_USER_SESSION_PATH", "session_telegram_user").strip()
if not SESSION_NAME:
    SESSION_NAME = "session_telegram_user"

API_ID = os.environ.get("TELEGRAM_API_ID", "").strip()
API_HASH = os.environ.get("TELEGRAM_API_HASH", "").strip()

if not API_ID or not API_HASH:
    print("Встановіть TELEGRAM_API_ID та TELEGRAM_API_HASH (з https://my.telegram.org/apps)")
    print("Або відредагуйте auth_session.py і вставте значення в змінні API_ID, API_HASH.")
    sys.exit(1)

# Якщо передано один аргумент — це шлях до сесії
if len(sys.argv) > 1:
    SESSION_NAME = sys.argv[1]


async def main():
    client = TelegramClient(SESSION_NAME, int(API_ID), API_HASH)
    await client.start(
        phone=lambda: input("Номер телефону (напр. +380671234567): "),
        code_callback=lambda: input("Код з Telegram: "),
        password=lambda: input("Пароль 2FA (якщо є): "),
    )
    me = await client.get_me()
    print(f"Успішно авторизовано: {me.first_name} (@{me.username or '—'})")
    print(f"Сесія збережена у: {os.path.abspath(SESSION_NAME)}.session")
    print("На сервері вкажіть TELEGRAM_USER_SESSION_PATH на повний шлях до цього файлу (без .session).")
    await client.disconnect()


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
