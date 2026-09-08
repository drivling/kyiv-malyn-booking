#!/usr/bin/env python3
"""
Отримання повідомлень з Telegram-груп попуток через особистий акаунт (Telethon).
Використовується для /addtelegram в боті та cron-імпорту.

Джерела:
  - PoDoroguem (форум з топіками):
      2:  Малин-Київ
      6:  Малин-Житомир
      108: Малин-Коростень
  - poputka_zhytomyr_kyiv (звичайна група без топіків) — topicId 0

Виклик:
  python3 fetch_telegram_messages.py [--limit N] [--topic ID] [--hours H] [--full]

  --limit N   Кількість повідомлень на топик/групу (за замовч. 50)
  --topic ID  Тільки один топик PoDoroguem (2, 6 або 108). Без цього — всі джерела.
  --hours H   Тільки повідомлення за останні H годин (опційно)
  --full      Ігнорувати TELEGRAM_LAST_IDS — завантажити всі (перший імпорт або скидання)

Змінні середовища:
  TELEGRAM_USER_SESSION_PATH, TELEGRAM_API_ID, TELEGRAM_API_HASH
  TELEGRAM_LAST_IDS — JSON останніх message ID, вкладений по групах:
    {"PoDoroguem":{"2":123,"6":456,"108":789},"poputka_zhytomyr_kyiv":{"0":321}}
    (приймається і старий плоский формат {"2":123,...} — трактується як PoDoroguem)

Вихід: stdout, UTF-8.
  Повідомлення у форматі: SenderName: текст або SenderName|@username: текст
  В кінці: __LAST_IDS__{"PoDoroguem":{...},"poputka_zhytomyr_kyiv":{...}}
"""

import os
import json
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

# Джерела: chat -> {topicId: назва}. topicId 0 = плоска група без топіків.
GROUPS = {
    PODOROGUEM: {2: "Малин-Київ", 6: "Малин-Житомир", 108: "Малин-Коростень"},
    "poputka_zhytomyr_kyiv": {0: "Житомир-Київ"},
    "poputka_zhitomir": {0: "Житомир-Київ"},
}

# Скільки годин історії тягнути при першому запуску групи/топіка (min_id == 0), щоб не
# завалити бекенд бекфілом. --full і --hours цей ліміт не чіпають.
COLD_START_HOURS = 300


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


def get_sender_telegram_username(sender):
    """@username для прив'язки до Person (тільки для User з username)."""
    if sender is None:
        return None
    username = getattr(sender, "username", None)
    if username and isinstance(username, str) and username.strip():
        return f"@{username.strip()}"
    return None


def _empty_last_ids():
    return {chat: {str(t): 0 for t in topics} for chat, topics in GROUPS.items()}


def parse_last_ids(full_fetch=False):
    """TELEGRAM_LAST_IDS з env -> {chat: {topicId(str): min_message_id}}."""
    result = _empty_last_ids()
    if full_fetch:
        return result
    raw = os.environ.get("TELEGRAM_LAST_IDS", "").strip()
    if not raw:
        return result
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return result
    if not isinstance(data, dict):
        return result
    for key, val in data.items():
        if isinstance(val, dict):
            # новий вкладений формат
            chat = key
            if chat not in result:
                continue
            for tk, tv in val.items():
                try:
                    result[chat][str(tk)] = int(tv) if tv else 0
                except (TypeError, ValueError):
                    pass
        else:
            # старий плоский формат {"2": 123, ...} -> PoDoroguem
            try:
                result[PODOROGUEM][str(key)] = int(val) if val else 0
            except (TypeError, ValueError):
                pass
    return result


async def fetch_messages(limit_per_topic=50, only_topic=None, hours=None, full_fetch=False):
    from telethon import TelegramClient

    session_path = get_session_path()
    api_id, api_hash = get_api_credentials()
    last_ids = parse_last_ids(full_fetch)

    client = TelegramClient(session_path, api_id, api_hash)
    try:
        last_err = None
        for attempt in range(5):
            try:
                await client.connect()
                last_err = None
                break
            except Exception as e:
                last_err = e
                msg = str(e).lower()
                if "locked" in msg or "database is locked" in msg:
                    await asyncio.sleep(0.4 * (attempt + 1))
                    continue
                raise
        if last_err is not None:
            raise last_err
        if not await client.is_user_authorized():
            print("Сесія не авторизована. Запустіть auth_session.py", file=sys.stderr)
            sys.exit(2)

        explicit_cutoff = None
        if hours is not None and hours > 0:
            explicit_cutoff = datetime.utcnow() - timedelta(hours=hours)

        lines = []
        seen_ids = set()
        new_last_ids = {c: dict(t) for c, t in last_ids.items()}

        for chat, topics in GROUPS.items():
            for topic_id in topics:
                if only_topic is not None and (chat != PODOROGUEM or topic_id != only_topic):
                    continue

                min_id = last_ids.get(chat, {}).get(str(topic_id), 0)
                topic_max_id = min_id
                # Cold start: перший запуск (min_id==0) без --full/--hours — обмежуємо історію.
                cutoff = explicit_cutoff
                if cutoff is None and not full_fetch and min_id == 0:
                    cutoff = datetime.utcnow() - timedelta(hours=COLD_START_HOURS)

                try:
                    iter_kwargs = {"limit": limit_per_topic, "reverse": False}
                    if topic_id:  # 0 = плоска група, без reply_to
                        iter_kwargs["reply_to"] = topic_id
                    if min_id > 0:
                        iter_kwargs["min_id"] = min_id

                    async for msg in client.iter_messages(chat, **iter_kwargs):
                        if not msg.text or not msg.text.strip():
                            continue
                        if cutoff and msg.date and msg.date.replace(tzinfo=None) < cutoff:
                            continue
                        key = (chat, topic_id, msg.id, msg.text[:80])
                        if key in seen_ids:
                            continue
                        seen_ids.add(key)
                        if msg.id > topic_max_id:
                            topic_max_id = msg.id

                        sender = await msg.get_sender()
                        name = get_sender_display_name(sender)
                        text = msg.text.strip()
                        tg_username = get_sender_telegram_username(sender)
                        if tg_username is not None:
                            lines.append(f"{name}|{tg_username}: {text}")
                        else:
                            lines.append(f"{name}: {text}")
                        lines.append("---")

                    new_last_ids[chat][str(topic_id)] = topic_max_id
                except Exception as e:
                    print(f"Помилка {chat}/{topic_id}: {e}", file=sys.stderr)
                    new_last_ids[chat][str(topic_id)] = last_ids.get(chat, {}).get(str(topic_id), 0)

        if lines:
            sys.stdout.write("\n".join(lines))
            if not lines[-1].endswith("\n"):
                sys.stdout.write("\n")
        sys.stdout.write("__LAST_IDS__" + json.dumps(new_last_ids) + "\n")
        sys.exit(0)

    except Exception as e:
        print(f"Помилка: {e}", file=sys.stderr)
        sys.exit(2)
    finally:
        await client.disconnect()


def main():
    parser = argparse.ArgumentParser(description="Отримати повідомлення з груп попуток")
    parser.add_argument("--limit", type=int, default=50, help="Повідомлень на топик/групу")
    parser.add_argument("--topic", type=int, choices=[2, 6, 108], help="Тільки один топик PoDoroguem")
    parser.add_argument("--hours", type=float, help="Тільки за останні H годин")
    parser.add_argument("--full", action="store_true", help="Завантажити всі (ігнорувати last IDs)")
    args = parser.parse_args()

    asyncio.run(
        fetch_messages(
            limit_per_topic=args.limit,
            only_topic=args.topic,
            hours=args.hours,
            full_fetch=args.full,
        )
    )


if __name__ == "__main__":
    main()
