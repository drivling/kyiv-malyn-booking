#!/usr/bin/env python3
"""
Відправка одного повідомлення від вашого Telegram-акаунта по номеру телефону.
Використовується для одноразового промо користувачам, які ще не в боті.

Виклик: python3 send_message.py <phone>
Текст повідомлення читається з stdin (UTF-8).

Тільки пошук імені по номеру (без відправки):
  python3 send_message.py --resolve <phone>
  Виводить у stdout ім'я (first_name + last_name) або порожньо. Код виходу 0 — знайдено, 1 — не знайдено.

Локальна перевірка форматів номерів (без Telegram):
  python3 send_message.py --test

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
    """Нормалізація до міжнародного формату для Telegram: 380XXXXXXXXX (Україна)."""
    digits = "".join(c for c in phone if c.isdigit())
    if not digits:
        return ""
    if digits.startswith("0") and len(digits) == 10:
        # Україна: 0XX XXX XX XX -> 380 XX XXX XX XX
        digits = "380" + digits[1:]
    elif digits.startswith("0"):
        digits = "38" + digits
    elif not digits.startswith("38"):
        digits = "38" + digits
    return digits


def format_phone_telegram_style(phone: str) -> str:
    """Формат +380(XX)XXXXXXX для ResolvePhone (Україна)."""
    digits = "".join(c for c in phone if c.isdigit())
    if not digits.startswith("+"):
        digits = normalize_phone(digits) if digits else ""
    else:
        digits = digits.lstrip("+")
    if len(digits) == 12 and digits.startswith("380"):
        # 380501399910 -> +380(50)1399910
        return f"+380({digits[3:5]}){digits[5:]}"
    return ("+" + digits) if digits else ""


def get_phone_formats_for_resolve(phone_normalized: str):
    """Кілька форматів номера для ResolvePhone — API приймає по-різному залежно від номера."""
    if not phone_normalized or len(phone_normalized) < 12 or not phone_normalized.startswith("380"):
        return [("+" + phone_normalized) if phone_normalized else ""]
    p = phone_normalized
    return [
        "+" + p,  # E.164
        f"+380({p[3:5]}){p[5:]}",  # +380(50)1399910
        f"+380 {p[3:5]} {p[5:8]} {p[8:10]} {p[10:12]}",  # +380 50 139 99 10
    ]


async def resolve_phone_to_name(phone_arg: str) -> str:
    """Пошук контакту в Telegram по номеру; повертає first_name + last_name або порожній рядок."""
    from telethon import TelegramClient
    from telethon.tl.functions.contacts import ResolvePhoneRequest

    session_path = get_session_path()
    api_id, api_hash = get_api_credentials()
    phone = normalize_phone(phone_arg)
    if not phone:
        return ""

    client = TelegramClient(session_path, api_id, api_hash)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            return ""
        result = None
        for phone_for_api in get_phone_formats_for_resolve(phone):
            if not phone_for_api:
                continue
            try:
                result = await client(ResolvePhoneRequest(phone=phone_for_api))
                if result and result.users:
                    break
            except Exception:
                continue
        if not result or not result.users:
            return ""
        user = result.users[0]
        first = getattr(user, "first_name", "") or ""
        last = getattr(user, "last_name", "") or ""
        return f"{first} {last}".strip()
    except Exception:
        return ""
    finally:
        await client.disconnect()


async def main():
    from telethon import TelegramClient
    from telethon.tl.functions.contacts import ResolvePhoneRequest

    if len(sys.argv) < 2:
        print("Використання: send_message.py <phone>", file=sys.stderr)
        sys.exit(2)

    phone_arg = sys.argv[1].strip()
    if not phone_arg:
        sys.exit(2)

    # Режим --resolve: тільки вивести ім'я по номеру
    if phone_arg in ("--resolve", "-r") and len(sys.argv) >= 3:
        resolve_phone = sys.argv[2].strip()
        if not resolve_phone:
            sys.exit(1)
        name = await resolve_phone_to_name(resolve_phone)
        if name:
            print(name)
            sys.exit(0)
        sys.exit(1)

    if phone_arg.startswith("--"):
        # звичайний режим: перший аргумент — номер
        print("Використання: send_message.py <phone> або send_message.py --resolve <phone>", file=sys.stderr)
        sys.exit(2)

    message = sys.stdin.read()
    if not message or not message.strip():
        print("Порожнє повідомлення", file=sys.stderr)
        sys.exit(2)

    session_path = get_session_path()
    api_id, api_hash = get_api_credentials()
    phone = normalize_phone(phone_arg)
    if not phone:
        print("Порожній номер після нормалізації", file=sys.stderr)
        sys.exit(2)

    client = TelegramClient(session_path, api_id, api_hash)

    try:
        await client.connect()
        if not await client.is_user_authorized():
            print("Сесія не авторизована. Запустіть auth_session.py", file=sys.stderr)
            sys.exit(2)

        # Пробуємо кілька форматів — API приймає по-різному (E.164, +380(XX), з пробілами)
        result = None
        for phone_for_api in get_phone_formats_for_resolve(phone):
            if not phone_for_api:
                continue
            try:
                result = await client(ResolvePhoneRequest(phone=phone_for_api))
                if result and result.users:
                    break
            except Exception:
                continue
        if not result or not result.users:
            print("Користувача не знайдено або номер приховано (перепробовано всі формати)", file=sys.stderr)
            sys.exit(1)
        user = result.users[0]
        await client.send_message(user, message, parse_mode="html")
        sys.exit(0)

    except Exception as e:
        if "banned" in str(e).lower():
            print("Номер заблоковано", file=sys.stderr)
        else:
            print(f"Помилка: {e}", file=sys.stderr)
        sys.exit(2)
    finally:
        await client.disconnect()


def test_phone_formats() -> bool:
    """Локальна перевірка normalize_phone та format_phone_telegram_style без Telegram."""
    cases = [
        # (вхід, очікуваний normalize_phone, очікуваний format_telegram)
        ("0501399910", "380501399910", "+380(50)1399910"),
        ("050 139 99 10", "380501399910", "+380(50)1399910"),
        ("+380501399910", "380501399910", "+380(50)1399910"),
        ("380501399910", "380501399910", "+380(50)1399910"),
        ("38 050 139 99 10", "380501399910", "+380(50)1399910"),
        ("0679551952", "380679551952", "+380(67)9551952"),
        ("+380 67 955 19 52", "380679551952", "+380(67)9551952"),
        ("0 50 1 3 9 9 9 1 0", "380501399910", "+380(50)1399910"),
    ]
    ok = 0
    for raw, expected_norm, expected_fmt in cases:
        norm = normalize_phone(raw)
        fmt = format_phone_telegram_style(norm)
        if norm == expected_norm and fmt == expected_fmt:
            ok += 1
            print(f"  OK  {raw!r} -> norm={norm!r} -> api={fmt!r}")
        else:
            print(f"  FAIL {raw!r} -> norm={norm!r} (expected {expected_norm!r}), api={fmt!r} (expected {expected_fmt!r})")
    print(f"\nРезультат: {ok}/{len(cases)} тестів пройдено")
    return ok == len(cases)


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1].strip() in ("--test", "-t"):
        print("Перевірка форматів номерів (normalize_phone, format_phone_telegram_style):\n")
        success = test_phone_formats()
        sys.exit(0 if success else 1)
    asyncio.run(main())
