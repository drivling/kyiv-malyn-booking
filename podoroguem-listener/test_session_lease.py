#!/usr/bin/env python3
"""Тести оренди сесії PoDoroguem без Telegram і БД (SQL перевіряється вручну на справжньому Postgres).

Запуск: python3 -m unittest podoroguem-listener/test_session_lease.py  (не входить у `npm test`)
"""

from __future__ import annotations

import asyncio
import sys
import time
import unittest
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from session_lease import SessionLease  # noqa: E402


class FakeStore:
    """Один рядок оренди в пам'яті; така сама логіка, як в INSERT … ON CONFLICT … WHERE з session_lease.py."""

    def __init__(self) -> None:
        self.holder: Optional[str] = None
        self.beat_at = 0.0
        self.fail_heartbeat = False

    async def try_acquire(self, holder: str, stale_s: float) -> bool:
        if self.holder is None or self.holder == holder or self.beat_at < time.monotonic() - stale_s:
            self.holder, self.beat_at = holder, time.monotonic()
            return True
        return False

    async def heartbeat(self, holder: str) -> bool:
        if self.fail_heartbeat:
            raise ConnectionError("db down")
        if self.holder != holder:
            return False
        self.beat_at = time.monotonic()
        return True

    async def release(self, holder: str) -> None:
        if self.holder == holder:
            self.holder = None


def make(store: FakeStore, holder: str, **kw) -> SessionLease:
    opts = dict(stale_s=0.6, heartbeat_s=0.1, retry_s=0.05, settle_s=0.0, log=lambda _line: None)
    opts.update(kw)
    return SessionLease(store, holder=holder, **opts)


class SessionLeaseTest(unittest.IsolatedAsyncioTestCase):
    async def test_free_lease_is_taken_and_released(self) -> None:
        store = FakeStore()
        lease = make(store, "a")
        self.assertTrue(await lease.acquire())
        self.assertEqual(store.holder, "a")
        await lease.release()
        self.assertIsNone(store.holder)
        self.assertFalse(lease.held)

    async def test_second_instance_waits_for_release(self) -> None:
        store = FakeStore()
        old, new = make(store, "old"), make(store, "new")
        await old.acquire()
        waiter = asyncio.create_task(new.acquire())
        await asyncio.sleep(0.3)
        self.assertFalse(waiter.done(), "новий контейнер не має підключатись, поки старий тримає сесію")
        await old.release()
        self.assertTrue(await asyncio.wait_for(waiter, timeout=1))
        self.assertEqual(store.holder, "new")
        await new.release()

    async def test_second_instance_takes_over_after_a_crash_without_release(self) -> None:
        store = FakeStore()
        old, new = make(store, "old"), make(store, "new")
        await old.acquire()
        old._beat_task.cancel()  # SIGKILL: серцебиття зупинилось, рядок лишився
        started = time.monotonic()
        self.assertTrue(await asyncio.wait_for(new.acquire(), timeout=3))
        self.assertGreaterEqual(time.monotonic() - started, 0.4, "треба дочекатись, поки запис застаріє")
        await new.release()

    async def test_settle_pause_after_acquire(self) -> None:
        store = FakeStore()
        lease = make(store, "a", settle_s=0.3)
        started = time.monotonic()
        self.assertTrue(await lease.acquire())
        self.assertGreaterEqual(time.monotonic() - started, 0.29)
        await lease.release()

    async def test_stop_signal_ends_the_wait(self) -> None:
        store = FakeStore()
        await make(store, "old").acquire()
        stop = asyncio.Event()
        waiter = asyncio.create_task(make(store, "new").acquire(stop))
        await asyncio.sleep(0.15)
        stop.set()
        self.assertFalse(await asyncio.wait_for(waiter, timeout=1))
        self.assertEqual(store.holder, "old")

    async def test_lost_lease_calls_on_lost(self) -> None:
        store = FakeStore()
        lost = asyncio.Event()
        lease = make(store, "a", on_lost=lost.set)
        await lease.acquire()
        store.holder = "someone-else"
        await asyncio.wait_for(lost.wait(), timeout=1)
        self.assertFalse(lease.held)
        await lease.release()
        self.assertEqual(store.holder, "someone-else", "чужий запис не видаляємо")

    async def test_database_outage_gives_up_before_the_record_goes_stale(self) -> None:
        store = FakeStore()
        lost = asyncio.Event()
        lease = make(store, "a", stale_s=0.6, heartbeat_s=0.1, on_lost=lost.set)
        await lease.acquire()
        store.fail_heartbeat = True
        started = time.monotonic()
        await asyncio.wait_for(lost.wait(), timeout=2)
        self.assertLess(time.monotonic() - started, 0.6, "зупинитись треба раніше, ніж запис забере інший екземпляр")
        await lease.release()


if __name__ == "__main__":
    unittest.main()
