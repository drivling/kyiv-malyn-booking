/**
 * Outbox (Docs/transport-offline-writes-2026-10.md, фаза 1): черга в localStorage, дедуп за ключем, межі,
 * «надіслати або в чергу», повтор на online / при відкритті / при поверненні до вкладки, 4xx — геть, 5xx і
 * мережеві помилки — лишаються до ліміту спроб. jsdom: navigator.onLine підміняється геттером.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import {
  OUTBOX_KEY,
  OUTBOX_MAX_AGE_MS,
  OUTBOX_MAX_ATTEMPTS,
  OUTBOX_MAX_ITEMS,
  enqueueOutbox,
  flushOutbox,
  isRetryableError,
  outboxPending,
  readOutbox,
  sendOrQueue,
  useOutboxPending,
  useOutboxSync,
  type OutboxItem,
} from './outbox';

const prerenderWindow = window as Window & { __MALIN_PRERENDER__?: boolean };

let online = true;
let posted: Array<{ path: string; body: Record<string, unknown> }> = [];
const scan = (stopId: string, side: 'a' | 'b' | 's' = 'a') => ({ stopId, side, clientId: 'abcd-1234-efgh' });
const ret = { stopId: 'st_0015', side: 'a' as const, clientId: 'abcd-1234-efgh', via: 'tab' as const, page: 'transport' };

function handler(path: string, status = 201) {
  return http.post(`${TEST_API_URL}/transport/${path}`, async ({ request }) => {
    posted.push({ path, body: (await request.json()) as Record<string, unknown> });
    return status >= 400
      ? HttpResponse.json({ error: 'nope' }, { status })
      : HttpResponse.json({ ok: true, counted: true, actualTime: null, delayMin: null }, { status });
  });
}

beforeEach(() => {
  online = true;
  posted = [];
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
  server.use(handler('sticker-scans'), handler('sticker-returns'), handler('arrival-reports'));
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'onLine');
  Reflect.deleteProperty(window, 'gtag');
  delete prerenderWindow.__MALIN_PRERENDER__;
});

describe('enqueueOutbox / readOutbox', () => {
  it('той самий ключ — заміна; понад 50 — найстаріші геть; старше 7 днів не читається; сміття — порожньо', () => {
    expect(enqueueOutbox('sticker-scan', scan('st_1'), 'scan:st_1-a:2026-10-15')).toBe(true);
    expect(enqueueOutbox('sticker-scan', scan('st_1', 'b'), 'scan:st_1-a:2026-10-15')).toBe(true);
    expect(readOutbox()).toHaveLength(1);
    expect(readOutbox()[0]).toMatchObject({ kind: 'sticker-scan', key: 'scan:st_1-a:2026-10-15', body: { side: 'b' }, attempts: 0 });
    expect(readOutbox()[0].id).toMatch(/^[A-Za-z0-9-]{8,64}$/);

    for (let i = 0; i < OUTBOX_MAX_ITEMS + 5; i++) enqueueOutbox('sticker-scan', scan(`st_${i}`), `scan:st_${i}-a:d`);
    expect(outboxPending()).toBe(OUTBOX_MAX_ITEMS);
    expect(readOutbox()[0].key).toBe('scan:st_5-a:d');

    localStorage.clear();
    const now = Date.now();
    enqueueOutbox('sticker-scan', scan('old'), 'old', now - OUTBOX_MAX_AGE_MS - 1);
    enqueueOutbox('sticker-scan', scan('fresh'), 'fresh', now - OUTBOX_MAX_AGE_MS + 60_000);
    expect(readOutbox(now).map((i) => i.key)).toEqual(['fresh']);

    localStorage.setItem(OUTBOX_KEY, '{not json');
    expect(readOutbox()).toEqual([]);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ id: 'x' }, { id: 'ok', kind: 'sticker-scan', key: 'k', body: {}, createdAt: now, attempts: 0 }]));
    expect(readOutbox(now).map((i) => i.id)).toEqual(['ok']);
  });

  it('під пререндером нічого не пише і не шле', async () => {
    prerenderWindow.__MALIN_PRERENDER__ = true;
    expect(enqueueOutbox('sticker-scan', scan('st_1'), 'k')).toBe(false);
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([{ id: 'a', kind: 'sticker-scan', key: 'k', body: scan('st_1'), createdAt: Date.now(), attempts: 0 }]));
    await flushOutbox();
    expect(posted).toEqual([]);
  });

  it('isRetryableError: 4xx — ні, решта — так', () => {
    expect(isRetryableError(Object.assign(new Error('x'), { status: 404 }))).toBe(false);
    expect(isRetryableError(Object.assign(new Error('x'), { status: 422 }))).toBe(false);
    expect(isRetryableError(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryableError(undefined)).toBe(true);
  });
});

describe('sendOrQueue', () => {
  it('без мережі — одразу в чергу, без запиту; GA transport_outbox queued', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    online = false;
    await expect(sendOrQueue('sticker-scan', scan('st_1'), 'scan:st_1-a:d')).resolves.toEqual({ queued: true });
    expect(posted).toEqual([]);
    expect(outboxPending()).toBe(1);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_outbox', { kind: 'sticker-scan', result: 'queued' });
  });

  it('з мережею — надсилає; 5xx — у чергу; 4xx — помилка викликачу, не в черзі', async () => {
    await expect(sendOrQueue('sticker-return', ret, 'return:st_0015-a:d')).resolves.toEqual({ queued: false, result: { ok: true, counted: true, actualTime: null, delayMin: null } });
    expect(posted).toEqual([{ path: 'sticker-returns', body: ret }]);
    expect(outboxPending()).toBe(0);

    server.use(handler('sticker-scans', 503));
    await expect(sendOrQueue('sticker-scan', scan('st_1'), 'scan:st_1-a:d')).resolves.toEqual({ queued: true });
    expect(outboxPending()).toBe(1);

    server.use(handler('sticker-scans', 404));
    await expect(sendOrQueue('sticker-scan', scan('st_2'), 'scan:st_2-a:d')).rejects.toMatchObject({ status: 404 });
    expect(outboxPending()).toBe(1);
  });
});

describe('flushOutbox', () => {
  it('шле по порядку і спорожнює чергу; GA sent', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    enqueueOutbox('sticker-scan', scan('st_1'), 'a');
    enqueueOutbox('sticker-return', ret, 'b');
    enqueueOutbox('arrival-report', { kind: 'missed', routeId: '2', tripId: 't1', direction: 'there', stopId: 'st_1', scheduledTime: '08:30', source: 'board' }, 'c');
    await flushOutbox();
    expect(posted.map((p) => p.path)).toEqual(['sticker-scans', 'sticker-returns', 'arrival-reports']);
    expect(outboxPending()).toBe(0);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_outbox', { kind: 'arrival-report', result: 'sent' });
  });

  it('мережева помилка: +1 спроба, прохід зупиняється; наступний прохід досилає; після 10 спроб — геть', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    enqueueOutbox('sticker-scan', scan('st_1'), 'a');
    enqueueOutbox('sticker-return', ret, 'b');
    server.use(http.post(`${TEST_API_URL}/transport/sticker-scans`, () => HttpResponse.error()));
    await flushOutbox();
    expect(posted).toEqual([]);
    expect(readOutbox().map((i) => [i.key, i.attempts])).toEqual([
      ['a', 1],
      ['b', 0],
    ]);

    server.use(handler('sticker-scans'));
    await flushOutbox();
    expect(posted.map((p) => p.path)).toEqual(['sticker-scans', 'sticker-returns']);
    expect(outboxPending()).toBe(0);

    const tired: OutboxItem = { id: 'tired', kind: 'sticker-scan', key: 'a', body: scan('st_1'), createdAt: Date.now(), attempts: OUTBOX_MAX_ATTEMPTS - 1 };
    localStorage.setItem(OUTBOX_KEY, JSON.stringify([tired]));
    server.use(http.post(`${TEST_API_URL}/transport/sticker-scans`, () => HttpResponse.error()));
    await flushOutbox();
    expect(outboxPending()).toBe(0);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_outbox', { kind: 'sticker-scan', result: 'dropped' });
  });

  it('4xx — запис викидається, прохід іде далі; без мережі — нічого', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    enqueueOutbox('sticker-scan', scan('st_bad'), 'a');
    enqueueOutbox('sticker-return', ret, 'b');
    server.use(handler('sticker-scans', 404));
    online = false;
    await flushOutbox();
    expect(posted).toEqual([]);
    online = true;
    await flushOutbox();
    expect(posted.map((p) => p.path)).toEqual(['sticker-scans', 'sticker-returns']);
    expect(outboxPending()).toBe(0);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_outbox', { kind: 'sticker-scan', result: 'rejected' });
  });
});

describe('useOutboxSync / useOutboxPending', () => {
  it('при монтуванні, на online і при поверненні до вкладки шле чергу; лічильник живий', async () => {
    online = false;
    enqueueOutbox('sticker-scan', scan('st_1'), 'a');
    const pending = renderHook(() => useOutboxPending());
    expect(pending.result.current).toBe(1);

    renderHook(() => useOutboxSync());
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toEqual([]);

    online = true;
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(posted).toHaveLength(1));
    await waitFor(() => expect(pending.result.current).toBe(0));

    act(() => {
      enqueueOutbox('sticker-return', ret, 'b');
    });
    expect(pending.result.current).toBe(1);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(posted).toHaveLength(2));
    await waitFor(() => expect(pending.result.current).toBe(0));
    Reflect.deleteProperty(document, 'visibilityState');
  });

  it('монтування з мережею досилає те, що лишилось із минулого разу', async () => {
    enqueueOutbox('sticker-scan', scan('st_1'), 'a');
    renderHook(() => useOutboxSync());
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(outboxPending()).toBe(0);
  });
});
