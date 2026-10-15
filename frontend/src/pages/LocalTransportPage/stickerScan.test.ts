import { describe, it, expect, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { flushOutbox, readOutbox } from '@/pwa/outbox';
import { getKyivDateString } from './kyivTime';
import { parseStickerCampaign, toReloadMark, useStickerScan } from './stickerScan';

describe('parseStickerCampaign', () => {
  it('код наклейки з utm_campaign лише для utm_source=sticker', () => {
    expect(parseStickerCampaign('?utm_source=sticker&utm_medium=qr&utm_campaign=st_0015-a')).toEqual({ stopId: 'st_0015', side: 'a' });
    expect(parseStickerCampaign('utm_source=sticker&utm_campaign=st_0019-s')).toEqual({ stopId: 'st_0019', side: 's' });
    expect(parseStickerCampaign('?utm_source=facebook&utm_campaign=st_0015-a')).toBeNull();
    expect(parseStickerCampaign('?utm_source=sticker&utm_campaign=st_0015-x')).toBeNull();
    expect(parseStickerCampaign('?utm_source=sticker&utm_medium=qr')).toBeNull();
    expect(parseStickerCampaign('')).toBeNull();
  });
});

describe('toReloadMark', () => {
  it('utm_source=sticker → reload, кампанія й решта параметрів лишаються', () => {
    expect(toReloadMark('?utm_source=sticker&utm_medium=qr&utm_campaign=st_0015-a')).toBe('?utm_source=reload&utm_medium=qr&utm_campaign=st_0015-a');
    expect(toReloadMark('?d=10.10.26&utm_source=sticker&utm_campaign=st_0015-a')).toBe('?d=10.10.26&utm_source=reload&utm_campaign=st_0015-a');
    expect(toReloadMark('?utm_source=facebook')).toBe('?utm_source=facebook');
    expect(toReloadMark('')).toBe('');
  });
});

describe('useStickerScan без мережі (Docs/transport-offline-writes-2026-10.md)', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'onLine');
  });

  it('скан стає в чергу outbox з ключем «наклейка + київська доба» і йде на сервер, коли мережа є', async () => {
    let online = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    const posted: unknown[] = [];
    server.use(
      http.post(`${TEST_API_URL}/transport/sticker-scans`, async ({ request }) => {
        posted.push(await request.json());
        return HttpResponse.json({ ok: true, counted: true }, { status: 201 });
      })
    );
    const search = 'utm_source=sticker&utm_medium=qr&utm_campaign=st_0015-a';
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(MemoryRouter, { initialEntries: [`/transport/stop/st_0015?${search}`] }, children);
    renderHook(() => useStickerScan(search), { wrapper });
    await waitFor(() => expect(readOutbox()).toHaveLength(1));
    expect(readOutbox()[0]).toMatchObject({
      kind: 'sticker-scan',
      key: `scan:st_0015-a:${getKyivDateString()}`,
      body: { stopId: 'st_0015', side: 'a' },
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toEqual([]);

    online = true;
    await flushOutbox();
    expect(posted).toEqual([{ stopId: 'st_0015', side: 'a', clientId: expect.stringMatching(/^[A-Za-z0-9-]{8,64}$/) }]);
    expect(readOutbox()).toEqual([]);
  });
});
