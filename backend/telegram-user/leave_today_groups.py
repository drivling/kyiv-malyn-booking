"""
Вихід з усіх груп і каналів. Личні чати (User, у т.ч. з ботами) не чіпаємо.
Без виводу списку і без підтвердження — знайшли групу/канал → одразу виходимо, пишемо в консоль.
"""
from telethon import TelegramClient
from telethon.tl.types import Chat, Channel
import os

def _load_dotenv():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(base_dir, ".env"),
        os.path.join(base_dir, "..", ".env"),
        os.path.join(os.getcwd(), ".env"),
    ]
    for env_path in candidates:
        if os.path.isfile(env_path):
            with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        key, _, value = line.partition("=")
                        key = key.strip()
                        value = value.strip().strip('"').strip("'")
                        if key and (key not in os.environ or not str(os.environ.get(key, "")).strip()):
                            os.environ[key] = value
            break

_load_dotenv()

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
SESSION = os.environ.get("TELEGRAM_USER_SESSION_PATH", "session_telegram_user")

EXCLUDE_IDS = set()
EXCLUDE_NAMES = set()

client = TelegramClient(SESSION, API_ID, API_HASH)


async def main():
    await client.connect()
    me = await client.get_me()
    print(f"Залогінено як {me.first_name} (@{me.username or '—'}). Вихід з груп/каналів...")

    count = 0
    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if not isinstance(entity, (Chat, Channel)):
            continue
        if dialog.id in EXCLUDE_IDS or (dialog.name and dialog.name.strip() in EXCLUDE_NAMES):
            continue

        await client.delete_dialog(dialog.id)
        label = (dialog.name or str(dialog.id))[:80]
        print(f"Сделали отписку от: {label}")
        count += 1

    print(f"Готово. Всього відписались від {count} груп/каналів.")


if __name__ == "__main__":
    with client:
        client.loop.run_until_complete(main())
