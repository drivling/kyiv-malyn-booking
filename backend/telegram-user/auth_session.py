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

Жорсткий вихід (якщо сесію скомпрометовано):
  python3 auth_session.py --logout
  Відкликає сесію на серверах Telegram і видаляє локальні файли сесії.

API_ID та API_HASH беруться з TELEGRAM_API_ID/TELEGRAM_API_HASH у середовищі
або з файлу .env у backend/ або в поточній директорії.
"""

import os
import sys
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

# Завантажити .env з backend/ або telegram-user/ (щоб не експортувати API_ID/API_HASH вручну)
def _load_dotenv():
    for dir_path in (
        os.path.dirname(os.path.abspath(__file__)),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."),
        os.getcwd(),
    ):
        env_path = os.path.join(dir_path, ".env")
        if os.path.isfile(env_path):
            with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key and key not in os.environ:
                            os.environ[key] = value
            break

_load_dotenv()

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

# --logout: жорсткий вихід — відкликати сесію і видалити файли
LOGOUT = "--logout" in sys.argv or "-logout" in sys.argv
if LOGOUT:
    sys.argv = [a for a in sys.argv if a not in ("--logout", "-logout")]

# Якщо передано один аргумент (не --logout) — це шлях до сесії
if len(sys.argv) > 1:
    SESSION_NAME = sys.argv[1]


def _session_files(base: str):
    """Повертає список шляхів до файлів сесії (.session та .session-journal)."""
    base = os.path.abspath(base)
    return [base + ".session", base + ".session-journal"]


def _delete_session_files(base: str) -> int:
    """Видаляє файли сесії. Повертає кількість видалених."""
    deleted = 0
    for p in _session_files(base):
        if os.path.isfile(p):
            try:
                os.remove(p)
                print(f"Видалено: {p}")
                deleted += 1
            except OSError as e:
                print(f"Помилка видалення {p}: {e}", file=sys.stderr)
    return deleted


async def logout_main():
    """Відкликати сесію на серверах Telegram і видалити локальні файли."""
    base = os.path.abspath(SESSION_NAME)
    session_path = base + ".session"
    if not os.path.isfile(session_path):
        print("Файл сесії не знайдено. Видаляю будь-які залишки...")
        deleted = _delete_session_files(SESSION_NAME)
        if deleted == 0:
            print("Нічого видаляти не потрібно.")
        sys.exit(0)

    client = TelegramClient(SESSION_NAME, int(API_ID), API_HASH)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            print("Сесія вже не авторизована (відключена або пошкоджена). Видаляю локальні файли.")
        else:
            await client.log_out()
            print("Сесію відключено на серверах Telegram (цей вхід більше не дійсний).")
    except Exception as e:
        print(f"Помилка при відключенні: {e}", file=sys.stderr)
        print("Видаляю локальні файли сесії, щоб їх не могли використати.")
    finally:
        try:
            await client.disconnect()
        except Exception:
            pass

    deleted = _delete_session_files(SESSION_NAME)
    if deleted > 0:
        print("Локальні файли сесії видалено. Для відправки повідомлень знову запустіть авторизацію без --logout.")
    else:
        print("Рекомендується вручну видалити файли сесії та переавторизуватися.")


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
    if LOGOUT:
        asyncio.run(logout_main())
    else:
        asyncio.run(main())
