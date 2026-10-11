/**
 * Оренда Telethon-сесії: два екземпляри бекенду (старий і новий контейнер деплою) ніколи не
 * тримають її одночасно; новий бере її після звільнення або коли серцебиття старого застаріло.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TelegramSessionLease,
  awaitTelegramSession,
  fatalTelegramSessionError,
  setTelegramSessionLease,
  type TelegramSessionLeaseStore,
} from './telegram-session-lease';

/** Та сама семантика, що й SQL у createPrismaTelegramSessionLeaseStore, з годинником Date.now */
function memoryStore() {
  let row: { holder: string; beatAt: number } | null = null;
  let failing = false;
  const store: TelegramSessionLeaseStore = {
    async tryAcquire(holder, staleMs) {
      if (failing) throw new Error('db down');
      const now = Date.now();
      if (!row || row.holder === holder || row.beatAt < now - staleMs) {
        row = { holder, beatAt: now };
        return true;
      }
      return false;
    },
    async heartbeat(holder) {
      if (failing) throw new Error('db down');
      if (row?.holder !== holder) return false;
      row.beatAt = Date.now();
      return true;
    },
    async release(holder) {
      if (row?.holder === holder) row = null;
    },
  };
  return {
    store,
    holder: () => row?.holder ?? null,
    steal: (holder: string) => {
      row = { holder, beatAt: Date.now() };
    },
    setFailing: (v: boolean) => {
      failing = v;
    },
  };
}

const opts = { staleMs: 45_000, heartbeatMs: 15_000, retryMs: 5_000, settleMs: 5_000, log: () => {} };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  setTelegramSessionLease(null);
  vi.useRealTimers();
});

describe('TelegramSessionLease', () => {
  it('перший екземпляр бере оренду лише після паузи settle', async () => {
    const db = memoryStore();
    const a = new TelegramSessionLease(db.store, { ...opts, holder: 'old' });
    a.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(db.holder()).toBe('old');
    expect(a.isHeld()).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(a.isHeld()).toBe(true);
    await a.stop();
  });

  it('деплой: новий чекає, поки старий працює; після SIGTERM (release) бере оренду', async () => {
    const db = memoryStore();
    const oldLease = new TelegramSessionLease(db.store, { ...opts, holder: 'old' });
    oldLease.start();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(oldLease.isHeld()).toBe(true);

    const newLease = new TelegramSessionLease(db.store, { ...opts, holder: 'new' });
    newLease.start();
    const waited = newLease.waitUntilHeld(120_000);
    // хвилину обидва живі: старий б'є серцебиттям, новий лише чекає
    await vi.advanceTimersByTimeAsync(60_000);
    expect(newLease.isHeld()).toBe(false);
    expect(db.holder()).toBe('old');

    await oldLease.stop();
    expect(oldLease.isHeld()).toBe(false);
    // наступна спроба (≤ retryMs) + settle
    await vi.advanceTimersByTimeAsync(10_001);
    expect(newLease.isHeld()).toBe(true);
    await expect(waited).resolves.toBe(true);
    await newLease.stop();
  });

  it('старий упав без release — новий бере оренду, коли серцебиття застаріло', async () => {
    const db = memoryStore();
    db.steal('crashed');
    const lease = new TelegramSessionLease(db.store, { ...opts, holder: 'new' });
    lease.start();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(lease.isHeld()).toBe(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(db.holder()).toBe('new');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lease.isHeld()).toBe(true);
    await lease.stop();
  });

  it('запис забрали — onLost, Telethon зупиняється; база недоступна недовго — тримаємо', async () => {
    const db = memoryStore();
    const onLost = vi.fn();
    const lease = new TelegramSessionLease(db.store, { ...opts, holder: 'me', onLost });
    lease.start();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(lease.isHeld()).toBe(true);

    db.setFailing(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lease.isHeld()).toBe(true);
    expect(onLost).not.toHaveBeenCalled();
    db.setFailing(false);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(lease.isHeld()).toBe(true);

    db.steal('other');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onLost).toHaveBeenCalledTimes(1);
    expect(lease.isHeld()).toBe(false);
    await lease.stop();
  });

  it('awaitTelegramSession: без оренди — одразу так; з орендою — чекає не довше таймауту', async () => {
    await expect(awaitTelegramSession(10)).resolves.toBe(true);
    const db = memoryStore();
    db.steal('other');
    const lease = new TelegramSessionLease(db.store, { ...opts, holder: 'me' });
    setTelegramSessionLease(lease);
    lease.start();
    const p = awaitTelegramSession(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(p).resolves.toBe(false);
    await lease.stop();
  });
});

describe('fatalTelegramSessionError', () => {
  it('впізнає мертву сесію в тексті помилки Telethon', () => {
    expect(
      fatalTelegramSessionError(
        'telethon.errors.rpcerrorlist.AuthKeyDuplicatedError: The authorization key (session file) was used under two different IP addresses'
      )
    ).toBe('AuthKeyDuplicatedError');
    expect(fatalTelegramSessionError('[lunch] FATAL_SESSION SessionNotAuthorized: …')).toBe('SessionNotAuthorized');
    expect(fatalTelegramSessionError('FloodWaitError: A wait of 30 seconds is required')).toBeNull();
  });
});
