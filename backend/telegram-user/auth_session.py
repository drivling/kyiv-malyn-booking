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

Вхід по QR (коли Telegram більше не шле код: «all available options ... already used»):
  python3 auth_session.py --qr
  У телефоні: Telegram → Налаштування → Пристрої → Підключити пристрій → навести камеру на QR.
  Ліміт на відправку кодів тут не діє. QR малюється в терміналі, якщо встановлено `pip install qrcode`.

Жорсткий вихід (якщо сесію скомпрометовано):
  python3 auth_session.py --logout
  Відкликає сесію на серверах Telegram і видаляє локальні файли сесії.

API_ID та API_HASH беруться з TELEGRAM_API_ID/TELEGRAM_API_HASH у середовищі
або з файлу .env у backend/ або в поточній директорії.
"""

import asyncio
import os
import sys
from telethon import TelegramClient
from telethon.tl.functions.auth import ResendCodeRequest
from telethon.errors import SessionPasswordNeededError
from telethon.errors.rpcerrorlist import (
    FloodWaitError,
    PhoneCodeExpiredError,
    PhoneCodeInvalidError,
    SendCodeUnavailableError,
)

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

# --qr: вхід через QR замість коду (обходить ліміт на відправку кодів)
QR = "--qr" in sys.argv
if QR:
    sys.argv = [a for a in sys.argv if a != "--qr"]

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


_CODE_DELIVERY = {
    "SentCodeTypeApp": "повідомлення в додатку Telegram (чат «Telegram» на пристрої, де акаунт уже увійшов)",
    "SentCodeTypeSms": "SMS",
    "SentCodeTypeCall": "голосовий дзвінок",
    "SentCodeTypeFlashCall": "flash-дзвінок (код — останні цифри номера, що дзвонить)",
    "SentCodeTypeMissedCall": "пропущений дзвінок (код — останні цифри номера, що дзвонить)",
}


def _describe_sent_code(sent) -> str:
    """Куди Telegram надіслав код і чи можна ще перезапитати — щоб не гадати, де його шукати."""
    kind = type(getattr(sent, "type", None)).__name__
    where = _CODE_DELIVERY.get(kind, kind)
    nxt = getattr(sent, "next_type", None)
    if nxt is None:
        again = "повторна відправка недоступна"
    else:
        again = "далі можна 'retry': " + _CODE_DELIVERY.get(type(nxt).__name__.replace("CodeType", "SentCodeType"), type(nxt).__name__)
    return f"Код надіслано: {where}. ({again})"


def _print_qr(url: str):
    """Малює QR у терміналі, якщо встановлено qrcode; інакше друкує tg://-посилання."""
    try:
        import qrcode  # type: ignore
    except ImportError:
        print("Для QR у терміналі: pip install qrcode  (або згенеруйте QR із цього посилання будь-яким сервісом):")
        print(url)
        return
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.print_ascii(invert=True)


async def _finish(client):
    me = await client.get_me()
    print(f"Успішно авторизовано: {me.first_name} (@{me.username or '—'})")
    print(f"Сесія збережена у: {os.path.abspath(SESSION_NAME)}.session")
    print("На сервері вкажіть TELEGRAM_USER_SESSION_PATH на повний шлях до цього файлу (без .session).")
    await client.disconnect()


async def qr_main():
    """Вхід через QR: Telegram → Налаштування → Пристрої → Підключити пристрій."""
    client = TelegramClient(SESSION_NAME, int(API_ID), API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        print("Відкрийте Telegram на телефоні: Налаштування → Пристрої → Підключити пристрій")
        print("і наведіть камеру на QR нижче. QR діє ~30 с, потім оновиться сам. Ctrl+C — скасувати.")
        print()
        qr = await client.qr_login()
        while True:
            _print_qr(qr.url)
            try:
                await qr.wait()
                break
            except asyncio.TimeoutError:
                print("\nQR застарів, генерую новий...\n")
                await qr.recreate()
            except SessionPasswordNeededError:
                pw = input("Пароль 2FA: ").strip()
                await client.sign_in(password=pw)
                break
    await _finish(client)


async def main():
    # Якщо змінили API_ID/API_HASH — видаліть старі файли сесії
    for p in _session_files(SESSION_NAME):
        if os.path.isfile(p):
            print(f"Існує файл сесії: {p}")
            print("Якщо змінювали API_ID/API_HASH — видаліть його: rm session_telegram_user.session*")
            break

    phone = input("Номер телефону (напр. +380671234567): ").strip()
    if not phone:
        print("Порожній номер.", file=sys.stderr)
        return
    if not phone.startswith("+"):
        phone = "+" + phone

    client = TelegramClient(SESSION_NAME, int(API_ID), API_HASH)
    await client.connect()
    if not await client.is_user_authorized():
        try:
            result = await client.send_code_request(phone)
        except FloodWaitError as e:
            print(f"Telegram просить зачекати {e.seconds} с перед новим запитом коду.", file=sys.stderr)
            print("Не чекаючи: python3 auth_session.py --qr", file=sys.stderr)
            await client.disconnect()
            return
        phone_code_hash = result.phone_code_hash

        print()
        print(_describe_sent_code(result))
        print("Не приходить: 'retry' — запитати наступний канал (SMS → дзвінок), якщо Telegram його дозволяє.")
        print("Варіанти вичерпано: Ctrl+C і `python3 auth_session.py --qr` (вхід по QR без коду).")
        print()

        while True:
            code = input("Код з Telegram (або retry): ").strip()
            # 'call' лишається синонімом: канал обирає Telegram, примусово дзвінок замовити не можна.
            if code.lower() in ("retry", "new", "resend", "повторити", "call", "дзвінок"):
                try:
                    # Те саме робить і send_code_request для вже запитаного номера.
                    result = await client(ResendCodeRequest(phone_number=phone, phone_code_hash=phone_code_hash))
                    phone_code_hash = result.phone_code_hash
                    print(_describe_sent_code(result))
                except SendCodeUnavailableError:
                    print("Telegram: усі канали для цього номера вже використано, нового коду зараз не буде.")
                    print("Код з першого повідомлення ще може діяти — введіть його тут.")
                    print("Інакше Ctrl+C і `python3 auth_session.py --qr`, або спробуйте за кілька годин.")
                except FloodWaitError as e:
                    print(f"Telegram просить зачекати {e.seconds} с.", file=sys.stderr)
                except Exception as e:
                    print(f"Помилка: {e}", file=sys.stderr)
                continue

            if not code:
                print("Введіть код або retry.")
                continue

            try:
                await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
                break
            except SessionPasswordNeededError:
                pw = input("Пароль 2FA: ").strip()
                await client.sign_in(password=pw)
                break
            except PhoneCodeInvalidError:
                print("Невірний код. Спробуйте ще раз або введіть 'retry'.")
            except PhoneCodeExpiredError:
                print("Код застарів. Запустіть скрипт знову або використайте `python3 auth_session.py --qr`.", file=sys.stderr)
                await client.disconnect()
                return

    await _finish(client)


if __name__ == "__main__":
    if LOGOUT:
        asyncio.run(logout_main())
    elif QR:
        asyncio.run(qr_main())
    else:
        asyncio.run(main())
