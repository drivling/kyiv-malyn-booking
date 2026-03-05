#!/usr/bin/env python3
"""
Отримання повідомлень з Telegram групи PoDoroguem (https://t.me/PoDoroguem)
через особистий акаунт (Telethon). Використовується для /addtelegram в боті.

Потоки (topics):
  - 2:  Малин-Київ
  - 6:  Малин-Житомир
  - 108: Малин-Коростень

Виклик:
  python3 fetch_telegram_messages.py [--limit N] [--topic ID] [--hours H]

  --limit N   Кількість повідомлень на топик (за замовч. 30)
  --topic ID  Тільки один топик (2, 6 або 108). Без цього — всі три.
  --hours H   Тільки повідомлення за останні H годин (опційно)

Вихід: stdout, UTF-8. Кожне повідомлення у форматі:
  SenderName: текст повідомлення
  ---

Змінні середовища: TELEGRAM_USER_SESSION_PATH, TELEGRAM_API_ID, TELEGRAM_API_HASH
"""

import os
import sys
import asyncio
import argparse
from datetime import datetime, timedelta

# Завантажити .env
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

PODOROGUEM = "PoDoroguem"
TOPICS = {
    2: "Малин-Київ",
    6: "Малин-Житомир",
    108: "Малин-Коростень",
}


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


def get_sender_display_name(sender):
    """Ім'я відправника для виводу."""
    if sender is None:
        return "Невідомий"
    if hasattr(sender, "first_name"):
        parts = []
        if sender.first_name:
            parts.append(sender.first_name)
        if getattr(sender, "last_name", None):
            parts.append(sender.last_name)
        if parts:
            return " ".join(parts)
        if getattr(sender, "username", None):
            return f"@{sender.username}"
    return "Невідомий"


async def fetch_messages(limit_per_topic=30, topic_ids=None, hours=None):
    from telethon import TelegramClient

    session_path = get_session_path()
    api_id, api_hash = get_api_credentials()

    client = TelegramClient(session_path, api_id, api_hash)
    try:
        await client.connect()
        if not await client.is_user_authorized():
            print("Сесія не авторизована. Запустіть auth_session.py", file=sys.stderr)
            sys.exit(2)

        topics_to_fetch = topic_ids if topic_ids else list(TOPICS.keys())
        cutoff_date = None
        if hours is not None and hours > 0:
            cutoff_date = datetime.utcnow() - timedelta(hours=hours)

        lines = []
        seen_ids = set()

        for topic_id in topics_to_fetch:
            try:
                async for msg in client.iter_messages(
                    PODOROGUEM,
                    reply_to=topic_id,
                    limit=limit_per_topic,
                    reverse=False,
                ):
                    if not msg.text or not msg.text.strip():
                        continue
                    if cutoff_date and msg.date and msg.date.replace(tzinfo=None) < cutoff_date:
                        continue
                    # Уникаємо дублікати (одне й те саме в кількох топиках)
                    key = (msg.id, msg.text[:100])
                    if key in seen_ids:
                        continue
                    seen_ids.add(key)

                    sender = await msg.get_sender()
                    name = get_sender_display_name(sender)
                    text = msg.text.strip()
                    lines.append(f"{name}: {text}")
                    lines.append("---")
            except Exception as e:
                print(f"Помилка топику {topic_id}: {e}", file=sys.stderr)

        if lines:
            sys.stdout.write("\n".join(lines))
            if not lines[-1].endswith("\n"):
                sys.stdout.write("\n")
        sys.exit(0)

    except Exception as e:
        print(f"Помилка: {e}", file=sys.stderr)
        sys.exit(2)
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Отримати повідомлення з PoDoroguem")
    parser.add_argument("--limit", type=int, default=30, help="Повідомлень на топик")
    parser.add_argument("--topic", type=int, choices=[2, 6, 108], help="Тільки один топик")
    parser.add_argument("--hours", type=float, help="Тільки за останні H годин")
    args = parser.parse_args()

    topic_ids = [args.topic] if args.topic else None
    asyncio.run(fetch_messages(
        limit_per_topic=args.limit,
        topic_ids=topic_ids,
        hours=args.hours,
    ))


if __name__ == "__main__":
    main()
