import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { getCurrentSite } from './siteConfig';
import { invalidateSiteLocalTransportCache, readRememberedLocalTransport, useSiteLocalTransport } from './useSiteLocalTransport';

const cityCode = getCurrentSite().cityCode;
const KEY = `site-local-transport:${cityCode}`;

describe('useSiteLocalTransport: пам\'ять відповіді (Docs/transport-pwa-2026-10.md, фаза 2)', () => {
  beforeEach(() => {
    invalidateSiteLocalTransportCache();
  });

  it('без пам\'яті чекає API, а відповідь запам\'ятовує', async () => {
    const { result } = renderHook(() => useSiteLocalTransport());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(readRememberedLocalTransport(cityCode)).toBe(result.current.enabled);
    expect(localStorage.getItem(KEY)).toBe(result.current.enabled ? '1' : '0');
  });

  it('із пам\'яттю не показує «Завантаження...» і переживає падіння API', async () => {
    localStorage.setItem(KEY, '1');
    server.use(http.get(`${TEST_API_URL}/trip-points`, () => HttpResponse.json({ error: 'down' }, { status: 500 })));
    const { result } = renderHook(() => useSiteLocalTransport());
    expect(result.current).toEqual({ enabled: true, loading: false });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.enabled).toBe(true);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('пам\'ять «0» означає заглушку без запиту, який би блокував рендер', () => {
    localStorage.setItem(KEY, '0');
    const { result } = renderHook(() => useSiteLocalTransport());
    expect(result.current).toEqual({ enabled: false, loading: false });
  });
});
