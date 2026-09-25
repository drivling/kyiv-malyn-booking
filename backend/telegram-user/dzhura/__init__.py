"""
Джура · фаза 0 — читання обраних чатів Telegram у базу.

Живе всередині процесу lunch.listener (одна Telethon-сесія на акаунт).
Точка входу: `dzhura.attach(client, pool, me, lunch_group_id)` → список корутин
для asyncio.create_task. Див. dzhura/README.md і Docs/dzhura-roadmap.md.

Імпорт capture — лінивий, щоб `python3 -m dzhura.test_relay` бігав без telethon/asyncpg.
"""

from __future__ import annotations


def attach(*args, **kwargs):
    from dzhura.capture import attach as _attach

    return _attach(*args, **kwargs)


__all__ = ["attach"]
