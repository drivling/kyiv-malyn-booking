import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { apiClient } from './client';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';

describe('apiClient.request: заголовки (Docs/transport-pwa-2026-10.md, фаза 5)', () => {
  it('GET без тіла не шле Content-Type (без зайвого preflight на крос-доменному API)', async () => {
    let contentType: string | null = 'unset';
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, ({ request }) => {
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ stops: [], routes: [], routeStops: [], trips: [], segments: [], meta: {} });
      })
    );
    await apiClient.getTransportDataset();
    expect(contentType).toBeNull();
  });

  it('POST з JSON-тілом — application/json, як і раніше', async () => {
    let contentType: string | null = null;
    server.use(
      http.post(`${TEST_API_URL}/transport/sticker-scans`, ({ request }) => {
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ ok: true, counted: true });
      })
    );
    await apiClient.trackStickerScan({ stopId: 'st_0001', side: 'a' });
    expect(contentType).toBe('application/json');
  });
});
