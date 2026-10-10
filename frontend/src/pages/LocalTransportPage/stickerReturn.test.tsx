/**
 * Люди з QR-наклейок, що повертаються: перша наклейка запамʼятовується, повернення — після перерви
 * ≥ 30 хв (як сесія GA): відновлена вкладка табло (reload), відкрита вкладка (tab), сайт інакше (direct).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { RETURN_GAP_MS, noteStickerVisit, rememberStickerOrigin, returnPage, useStickerReturn } from './stickerReturn';

let posted: Array<Record<string, unknown>> = [];
let visibility: DocumentVisibilityState = 'visible';

function Probe() {
  useStickerReturn();
  return null;
}
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Probe />
    </MemoryRouter>
  );
const T0 = new Date('2026-10-10T10:00:00Z').getTime();

beforeEach(() => {
  localStorage.clear();
  posted = [];
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  server.use(
    http.post(`${TEST_API_URL}/transport/sticker-returns`, async ({ request }) => {
      posted.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ ok: true, counted: true }, { status: 201 });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'gtag');
});

describe('sticker origin', () => {
  it('keeps the first sticker; a visit within 30 min is the same visit, after it — a return', () => {
    expect(noteStickerVisit(T0)).toBeNull();
    rememberStickerOrigin({ stopId: 'st_0015', side: 'a' }, T0);
    rememberStickerOrigin({ stopId: 'st_0019', side: 's' }, T0 + 1000);
    expect(noteStickerVisit(T0 + 10 * 60 * 1000)).toBeNull();
    expect(noteStickerVisit(T0 + 10 * 60 * 1000 + RETURN_GAP_MS)).toMatchObject({ stopId: 'st_0015', side: 'a' });
    expect(noteStickerVisit(T0 + 10 * 60 * 1000 + RETURN_GAP_MS + 1000)).toBeNull();
  });

  it('returnPage: the first path segment', () => {
    expect(returnPage('/transport/stop/st_1')).toBe('transport');
    expect(returnPage('/')).toBe('home');
    expect(returnPage('/Ünicode')).toBe('other');
  });
});

describe('useStickerReturn', () => {
  it('a restored board tab with utm_source=reload after a break — a «reload» return with the first sticker', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
    rememberStickerOrigin({ stopId: 'st_0015', side: 'a' }, T0 - 2 * 60 * 60 * 1000);
    renderAt('/transport/stop/st_0015?utm_source=reload&utm_medium=qr&utm_campaign=st_0015-a');
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ stopId: 'st_0015', side: 'a', via: 'reload', page: 'transport' });
    expect(String(posted[0].clientId)).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_sticker_return', { stop: 'st_0015', side: 'a', via: 'reload' });
  });

  it('opening the site another way — «direct»; nothing for people without a sticker or within the same visit', async () => {
    renderAt('/mizhgorodski');
    rememberStickerOrigin({ stopId: 'st_0015', side: 'a' }, T0 - 5 * 60 * 1000);
    renderAt('/mizhgorodski');
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toEqual([]);
    rememberStickerOrigin({ stopId: 'st_0015', side: 'a' }, T0 - RETURN_GAP_MS);
    renderAt('/');
    await waitFor(() => expect(posted).toEqual([expect.objectContaining({ via: 'direct', page: 'home' })]));
  });

  it('a new sticker scan is counted by the board, not as a return', async () => {
    rememberStickerOrigin({ stopId: 'st_0015', side: 'a' }, T0 - 2 * 60 * 60 * 1000);
    renderAt('/transport/stop/st_0019?utm_source=sticker&utm_medium=qr&utm_campaign=st_0019-s');
    await new Promise((r) => setTimeout(r, 30));
    expect(posted).toEqual([]);
  });

  it('coming back to the open tab after a break — «tab»', async () => {
    rememberStickerOrigin({ stopId: 'st_0015', side: 'a' }, T0);
    renderAt('/transport');
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    vi.setSystemTime(T0 + RETURN_GAP_MS + 1000);
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(posted).toEqual([expect.objectContaining({ via: 'tab' })]));
  });
});
