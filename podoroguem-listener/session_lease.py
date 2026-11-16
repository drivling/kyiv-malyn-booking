"""Оренда Telethon-сесії акаунта PoDoroguem: лише один контейнер тримає її відкритою.

Під час деплою Railway новий контейнер стартує раніше, ніж зупиняється старий (2026-11-16: нова версія
піднялась о 20:29:01, старий контейнер зупинився о 20:29:16). Якщо обидва підключені до Telegram з одним
файлом сесії з різних IP, ключ анулюється назавжди — `AuthKeyDuplicatedError`, потрібен новий вхід в акаунт.
Те саме вже було з сесією власника (2026-10-10), тому бекенд бере оренду в `TelegramSessionLease`
(`backend/src/telegram-session-lease.ts`). Цей сервіс — окремий акаунт, тож бере свій рядок (`LEASE_ID = 2`);
таблиця та сама, міграція не потрібна. Логіка дзеркалить Node-версію: серцебиття, «застарілий» запис,
пауза після захоплення. Час — лише бази даних, без годинників контейнерів.
"""

from __future__ import annotations

import asyncio
import os
import secrets
import socket
import time
from typing import Any, Callable, Optional, Protocol

# id=1 — сесія власника (бекенд). Акаунт PoDoroguem — окремий, тож окремий рядок.
LEASE_ID = 2

_ACQUIRE_SQL = """
INSERT INTO "TelegramSessionLease" ("id", "holder", "heartbeatAt")
VALUES ($1, $2, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
  SET "holder" = EXCLUDED."holder", "heartbeatAt" = CURRENT_TIMESTAMP
  WHERE "TelegramSessionLease"."holder" = EXCLUDED."holder"
     OR "TelegramSessionLease"."heartbeatAt" < CURRENT_TIMESTAMP - make_interval(secs => $3::float8)
RETURNING "holder"
"""
_HEARTBEAT_SQL = """
UPDATE "TelegramSessionLease" SET "heartbeatAt" = CURRENT_TIMESTAMP
WHERE "id" = $1 AND "holder" = $2
"""
_RELEASE_SQL = 'DELETE FROM "TelegramSessionLease" WHERE "id" = $1 AND "holder" = $2'


class LeaseStore(Protocol):
    async def try_acquire(self, holder: str, stale_s: float) -> bool:
        """True — запис тепер наш (вставили, оновили свій або забрали застарілий)."""

    async def heartbeat(self, holder: str) -> bool:
        """True — запис досі наш і серцебиття оновлено."""

    async def release(self, holder: str) -> None: ...


class AsyncpgLeaseStore:
    def __init__(self, pool: Any, lease_id: int = LEASE_ID) -> None:
        self._pool = pool
        self._id = lease_id

    async def try_acquire(self, holder: str, stale_s: float) -> bool:
        row = await self._pool.fetchrow(_ACQUIRE_SQL, self._id, holder, float(stale_s))
        return row is not None and row["holder"] == holder

    async def heartbeat(self, holder: str) -> bool:
        status = await self._pool.execute(_HEARTBEAT_SQL, self._id, holder)
        return status == "UPDATE 1"

    async def release(self, holder: str) -> None:
        await self._pool.execute(_RELEASE_SQL, self._id, holder)


def default_holder() -> str:
    host = os.environ.get("RAILWAY_DEPLOYMENT_ID", "").strip() or socket.gethostname()
    return f"{host}:{os.getpid()}:{secrets.token_hex(3)}"


class SessionLease:
    def __init__(
        self,
        store: LeaseStore,
        *,
        holder: Optional[str] = None,
        stale_s: float = 45.0,
        heartbeat_s: float = 15.0,
        retry_s: float = 5.0,
        settle_s: float = 5.0,
        on_lost: Optional[Callable[[], None]] = None,
        log: Callable[[str], None] = print,
    ) -> None:
        self.holder = holder or default_holder()
        self._store = store
        self._stale_s = stale_s
        self._heartbeat_s = heartbeat_s
        self._retry_s = retry_s
        self._settle_s = settle_s
        self._on_lost = on_lost
        self._log = log
        self.held = False
        self._beat_task: Optional["asyncio.Task[None]"] = None

    async def _sleep(self, seconds: float, stop: Optional[asyncio.Event]) -> bool:
        """Спати, але прокинутись, якщо прийшов сигнал зупинки. True — час вийшов, False — зупинка."""
        if stop is None:
            await asyncio.sleep(seconds)
            return True
        try:
            await asyncio.wait_for(stop.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return True
        return False

    async def acquire(self, stop: Optional[asyncio.Event] = None) -> bool:
        """Чекати оренду. True — можна запускати Telethon; False — зупинили (SIGTERM) або оренду втрачено до старту."""
        waiting_logged = False
        while True:
            if stop is not None and stop.is_set():
                return False
            try:
                ok = await self._store.try_acquire(self.holder, self._stale_s)
            except Exception as e:  # база тимчасово недоступна — пробуємо далі
                self._log(f"[session-lease] acquire failed: {e}")
                ok = False
            if ok:
                break
            if not waiting_logged:
                self._log("[session-lease] waiting: the session is held by another instance (previous deploy?)")
                waiting_logged = True
            if not await self._sleep(self._retry_s, stop):
                return False

        self.held = True
        self._beat_task = asyncio.create_task(self._heartbeat_loop())
        self._log(f"[session-lease] acquired holder={self.holder}; settle {self._settle_s:g}s")
        # Процеси старого контейнера мають встигнути зникнути, перш ніж Telethon відкриє з'єднання.
        if not await self._sleep(self._settle_s, stop):
            return False
        return self.held

    async def _heartbeat_loop(self) -> None:
        last_ok = time.monotonic()
        # Інший екземпляр забере запис, щойно серцебиття старіше за stale_s у базі: зупиняємось із запасом.
        give_up_after = max(self._stale_s - self._heartbeat_s, self._heartbeat_s)
        while True:
            await asyncio.sleep(self._heartbeat_s)
            try:
                if await self._store.heartbeat(self.holder):
                    last_ok = time.monotonic()
                    continue
                self._log("[session-lease] lost: the record belongs to someone else")
            except Exception as e:
                if time.monotonic() - last_ok < give_up_after:
                    self._log(f"[session-lease] heartbeat failed, will retry: {e}")
                    continue
                self._log(f"[session-lease] lost: no heartbeat for {give_up_after:g}s ({e})")
            self.held = False
            if self._on_lost:
                self._on_lost()
            return

    async def release(self) -> None:
        """Звільнити запис. Викликати лише після `client.disconnect()`: інакше новий контейнер
        підключиться, поки ми ще на лінії."""
        task, self._beat_task = self._beat_task, None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        was_held, self.held = self.held, False
        if not was_held:
            return
        try:
            await self._store.release(self.holder)
            self._log(f"[session-lease] released holder={self.holder}")
        except Exception as e:
            self._log(f"[session-lease] release failed (the record will go stale on its own): {e}")
