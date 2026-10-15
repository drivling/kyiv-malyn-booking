/**
 * Outbox: записи з табло, які без мережі губились би (Docs/transport-offline-writes-2026-10.md).
 * Скан QR-наклейки, повернення з наклейки і «факт прибуття» без мережі стають у чергу в localStorage
 * (`transport-outbox:v1`) і йдуть на сервер, щойно вона з'явиться: подія `online`, відкриття сторінки /
 * повернення до вкладки (`useOutboxSync`) і успішний `GET /transport/dataset` (`useTransportDataset`).
 *
 * Черга живе у сторінці, не у service worker: API крос-доменний, воркер не-GET не чіпає, Background Sync
 * не використовуємо. Дедуп на клієнті за `key` (та сама наклейка / той самий рейс за добу — один запис), бо
 * серверний дедуп сканів і повернень — лише в пам'яті процесу. Межі: 50 записів, 7 днів, 10 спроб.
 * Повторювані помилки — мережеві (`TypeError` від fetch, таймаут) і 5xx; 4xx (невалідне, невідомий рейс,
 * поза вікном) — запис викидається. Без localStorage (приватний режим) черги нема.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { apiClient } from '@/api/client';
import { gaTrackEvent } from '@/analytics/googleAnalytics';
import type { ArrivalReportBody, ArrivalReportResult, StickerReturnBody, StickerSide } from '@/types';
import { isPrerendering } from '@/utils/prerender';
import { isOnline } from './useOnline';

export const OUTBOX_KEY = 'transport-outbox:v1';
export const OUTBOX_MAX_ITEMS = 50;
export const OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const OUTBOX_MAX_ATTEMPTS = 10;
const LOCK_NAME = 'transport-outbox';

export type OutboxBodies = {
  'sticker-scan': { stopId: string; side: StickerSide; clientId?: string };
  'sticker-return': StickerReturnBody;
  'arrival-report': ArrivalReportBody;
};
export type OutboxKind = keyof OutboxBodies;
export type OutboxResults = {
  'sticker-scan': { ok: boolean; counted: boolean };
  'sticker-return': { ok: boolean; counted: boolean };
  'arrival-report': ArrivalReportResult;
};
const KINDS: readonly OutboxKind[] = ['sticker-scan', 'sticker-return', 'arrival-report'];

export type OutboxItem<K extends OutboxKind = OutboxKind> = {
  id: string;
  kind: K;
  /** Ключ дедупу: новий запис із тим самим ключем замінює старий у черзі */
  key: string;
  body: OutboxBodies[K];
  createdAt: number;
  attempts: number;
};

export type OutboxResult = 'queued' | 'sent' | 'rejected' | 'dropped';

/** Випадковий id запису (і `clientEventId` звіту про прибуття) */
export function newOutboxId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isItem(v: unknown): v is OutboxItem {
  const i = v as Partial<OutboxItem> | null;
  return (
    !!i &&
    typeof i === 'object' &&
    typeof i.id === 'string' &&
    typeof i.key === 'string' &&
    (KINDS as readonly string[]).includes(String(i.kind)) &&
    !!i.body &&
    typeof i.body === 'object' &&
    Number.isFinite(i.createdAt) &&
    Number.isInteger(i.attempts)
  );
}

/** Черга з localStorage без прострочених записів; порожня без localStorage або при зіпсованому JSON */
export function readOutbox(now = Date.now()): OutboxItem[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem).filter((i) => now - i.createdAt < OUTBOX_MAX_AGE_MS);
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function writeOutbox(items: OutboxItem[]): boolean {
  try {
    if (items.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    return false;
  }
  notify();
  return true;
}

function track(kind: OutboxKind, result: OutboxResult): void {
  gaTrackEvent('transport_outbox', { kind, result });
}

/** Поставити запис у чергу (той самий `key` — заміна); false — без localStorage або під пререндером */
export function enqueueOutbox<K extends OutboxKind>(kind: K, body: OutboxBodies[K], key: string, now = Date.now()): boolean {
  if (isPrerendering()) return false;
  const items = readOutbox(now).filter((i) => i.key !== key);
  items.push({ id: newOutboxId(), kind, key, body, createdAt: now, attempts: 0 });
  while (items.length > OUTBOX_MAX_ITEMS) items.shift();
  if (!writeOutbox(items)) return false;
  track(kind, 'queued');
  return true;
}

/** Скільки записів чекають на мережу */
export function outboxPending(): number {
  return readOutbox().length;
}

/** Зміни черги (ця вкладка — через notify, інші — через подію storage) */
export function subscribeOutbox(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === OUTBOX_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export function useOutboxPending(): number {
  return useSyncExternalStore(subscribeOutbox, outboxPending, () => 0);
}

/**
 * Чи варто повторити: мережева помилка (fetch кидає TypeError без `status`), таймаут, 5xx — так;
 * відповідь 4xx (`apiClient.request` додає `status`) — ні, сервер цей запис не прийме ніколи.
 */
export function isRetryableError(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return !(typeof status === 'number' && status >= 400 && status < 500);
}

function send<K extends OutboxKind>(kind: K, body: OutboxBodies[K]): Promise<OutboxResults[K]> {
  switch (kind) {
    case 'sticker-scan':
      return apiClient.trackStickerScan(body as OutboxBodies['sticker-scan']) as Promise<OutboxResults[K]>;
    case 'sticker-return':
      return apiClient.trackStickerReturn(body as OutboxBodies['sticker-return']) as Promise<OutboxResults[K]>;
    case 'arrival-report':
      return apiClient.reportArrival(body as OutboxBodies['arrival-report']) as Promise<OutboxResults[K]>;
    default:
      return Promise.reject(Object.assign(new Error(`Unknown outbox kind ${String(kind)}`), { status: 400 }));
  }
}

export type SendOrQueueResult<K extends OutboxKind> = { queued: true } | { queued: false; result: OutboxResults[K] };

/**
 * Надіслати зараз або поставити в чергу: без мережі — одразу в чергу; з мережею — спроба, і в чергу лише
 * при повторюваній помилці. 4xx прокидається викликачу; без localStorage кидає помилку «не вдалося зберегти».
 */
export async function sendOrQueue<K extends OutboxKind>(kind: K, body: OutboxBodies[K], key: string): Promise<SendOrQueueResult<K>> {
  const queue = (): SendOrQueueResult<K> => {
    if (!enqueueOutbox(kind, body, key)) throw Object.assign(new Error('Не вдалося зберегти запис'), { outbox: 'unavailable' });
    return { queued: true };
  };
  if (!isOnline()) return queue();
  try {
    return { queued: false, result: await send(kind, body) };
  } catch (e) {
    if (!isRetryableError(e)) throw e;
    return queue();
  }
}

function removeItem(id: string): boolean {
  return writeOutbox(readOutbox().filter((i) => i.id !== id));
}

/** Один прохід по черзі по порядку; повторювана помилка зупиняє прохід — мережі, найімовірніше, нема */
async function flushNow(): Promise<void> {
  for (;;) {
    const item = readOutbox()[0];
    if (!item) return;
    try {
      await send(item.kind, item.body);
    } catch (e) {
      if (!isRetryableError(e)) {
        if (!removeItem(item.id)) return;
        track(item.kind, 'rejected');
        continue;
      }
      const attempts = item.attempts + 1;
      if (attempts >= OUTBOX_MAX_ATTEMPTS) {
        if (!removeItem(item.id)) return;
        track(item.kind, 'dropped');
        continue;
      }
      writeOutbox(readOutbox().map((i) => (i.id === item.id ? { ...i, attempts } : i)));
      return;
    }
    if (!removeItem(item.id)) return;
    track(item.kind, 'sent');
  }
}

async function withLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (locks && typeof locks.request === 'function') {
    await locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await fn();
    });
    return;
  }
  await fn();
}

let flushing: Promise<void> | null = null;

/** Надіслати все, що чекає (single-flight; між вкладками — Web Locks, де є). No-op без мережі й під пререндером */
export function flushOutbox(): Promise<void> {
  if (flushing) return flushing;
  if (isPrerendering() || !isOnline() || outboxPending() === 0) return Promise.resolve();
  flushing = withLock(flushNow).finally(() => {
    flushing = null;
  });
  return flushing;
}

/** У корені застосунку: повтор при відкритті сторінки, на `online` і при поверненні до вкладки */
export function useOutboxSync(): void {
  useEffect(() => {
    if (isPrerendering()) return;
    void flushOutbox();
    const onOnline = () => void flushOutbox();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void flushOutbox();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}
