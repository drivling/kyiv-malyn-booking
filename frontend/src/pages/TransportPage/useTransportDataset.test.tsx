import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  invalidateTransportDatasetCache,
  useTransportDataset,
} from '@/pages/TransportPage/useTransportDataset';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';

describe('useTransportDataset', () => {
  beforeEach(() => {
    invalidateTransportDatasetCache();
  });

  it('loads dataset from API', async () => {
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('');
    expect(result.current.dataset).toEqual(
      expect.objectContaining({
        stops: [],
        routes: [],
        meta: expect.objectContaining({ defaultSec: 120 }),
      })
    );
  });

  it('surfaces error when API fails', async () => {
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () =>
        HttpResponse.json({ error: 'down' }, { status: 500 })
      )
    );
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/down|Помилка|500/i);
    expect(result.current.dataset).toBeNull();
  });
});
