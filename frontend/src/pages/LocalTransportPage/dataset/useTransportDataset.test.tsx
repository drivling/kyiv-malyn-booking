import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { TransportDataset } from '@/api/transportDataset';
import { routeNo } from '@/utils/routeNames';
import { invalidateTransportDatasetCache, useTransportDataset } from './useTransportDataset';
import { readStored, writeStored } from './datasetStore';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';

const DATASET = `${TEST_API_URL}/transport/dataset`;
const SNAPSHOT = `${TEST_API_URL}/transport/dataset.json`;

const sample = (revision: string): TransportDataset =>
  ({
    stops: [{ id: 'st_1', name: 'A', lat: 1, lng: 2 }],
    routes: [{ id: '11', shortName: '11/1' }],
    routeStops: [],
    trips: [],
    segments: [],
    meta: { defaultSec: 120 },
    revision,
  }) as unknown as TransportDataset;

const apiDown = () => http.get(DATASET, () => HttpResponse.json({ error: 'down' }, { status: 500 }));

describe('useTransportDataset', () => {
  beforeEach(() => {
    invalidateTransportDatasetCache();
  });

  it('loads dataset from API and keeps a local copy', async () => {
    const { result } = renderHook(() => useTransportDataset());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('');
    expect(result.current.source).toBe('network');
    expect(result.current.dataset).toEqual(
      expect.objectContaining({
        stops: [],
        routes: [],
        meta: expect.objectContaining({ defaultSec: 120 }),
      })
    );
    expect(readStored()?.dataset.meta).toEqual(expect.objectContaining({ defaultSec: 120 }));
  });

  it('surfaces error when API fails', async () => {
    server.use(apiDown());
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/down|Помилка|500/i);
    expect(result.current.dataset).toBeNull();
    expect(result.current.source).toBeNull();
  });

  it('після невдачі reload() знову йде в API (inflight не застрягає на відхиленій обіцянці)', async () => {
    server.use(http.get(DATASET, () => HttpResponse.json({ error: 'down' }, { status: 500 }), { once: true }));
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.error).toMatch(/down/));
    await act(() => result.current.reload());
    expect(result.current.error).toBe('');
    expect(result.current.dataset).not.toBeNull();
  });

  it('локальна копія показується одразу, свіжа ревізія її замінює й перезаписує', async () => {
    writeStored(sample('r1'), 1_700_000_000_000);
    server.use(http.get(DATASET, () => HttpResponse.json(sample('r2'))));
    const { result } = renderHook(() => useTransportDataset());
    expect(result.current.loading).toBe(false);
    expect(result.current.source).toBe('local');
    expect(result.current.dataset?.revision).toBe('r1');
    expect(result.current.dataAsOf).toBe('r1');
    expect(routeNo('11')).toBe('11/1');
    await waitFor(() => expect(result.current.source).toBe('network'));
    expect(result.current.dataset?.revision).toBe('r2');
    expect(readStored()?.revision).toBe('r2');
  });

  it('та сама ревізія з мережі — той самий об\'єкт датасету (без перерахунку сторінок)', async () => {
    writeStored(sample('r1'));
    server.use(http.get(DATASET, () => HttpResponse.json(sample('r1'))));
    const { result } = renderHook(() => useTransportDataset());
    const first = result.current.dataset;
    await waitFor(() => expect(result.current.source).toBe('network'));
    expect(result.current.dataset).toBe(first);
  });

  it('API мовчить, копія є — копія лишається, помилка показується', async () => {
    writeStored(sample('r1'));
    server.use(apiDown());
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.error).toMatch(/down/));
    expect(result.current.loading).toBe(false);
    expect(result.current.source).toBe('local');
    expect(result.current.dataset?.revision).toBe('r1');
  });

  it('копії нема, API мовчить — знімок збірки, і номери маршрутів із нього', async () => {
    server.use(apiDown(), http.get(SNAPSHOT, () => HttpResponse.json(sample('snap'))));
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.source).toBe('snapshot'));
    expect(result.current.dataset?.revision).toBe('snap');
    expect(result.current.error).toMatch(/down/);
    expect(result.current.dataAsOf).toBe('snap');
    expect(routeNo('11')).toBe('11/1');
    // знімок — не копія: в localStorage нічого не пишемо
    expect(readStored()).toBeNull();
  });

  it('подія online перезавантажує дані', async () => {
    server.use(http.get(DATASET, () => HttpResponse.json({ error: 'down' }, { status: 500 }), { once: true }));
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.error).toMatch(/down/));
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.dataset).not.toBeNull());
    expect(result.current.error).toBe('');
  });
});
