/**
 * Місто транспорту на фронтенді (Docs/korosten-transport-2026-11.md, фаза 5): для Малина запити й ключі ті
 * самі, що були; інше місто (сайт korosten) має власний ?city=, копію в localStorage, номери й кольори маршрутів,
 * не бачить статей зупинок Малина і позначає свої записи в черзі.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { apiClient } from '@/api/client';
import type { TransportDataset } from '@/api/transportDataset';
import { getStopArticle } from '@/content/stops';
import { DATASET_STORAGE_KEY, datasetStorageKey, readStored, writeStored } from '@/pages/LocalTransportPage/dataset/datasetStore';
import { invalidateTransportDatasetCache, useTransportDataset } from '@/pages/LocalTransportPage/dataset/useTransportDataset';
import { configureRouteColors, routeColor, routeColorStyle, setRouteColorsCity } from '@/pages/LocalTransportPage/routeColors';
import { readOutbox, sendOrQueue } from '@/pwa/outbox';
import { configureRouteNames, routeNo, setRouteNamesCity } from '@/utils/routeNames';
import { DEFAULT_TRANSPORT_CITY, cityField, cityQuery, siteTransportCity, transportProfile } from './transportCity';

const dataset = (stopName: string, extra: Partial<TransportDataset> = {}): TransportDataset =>
  ({
    stops: [{ id: 'st_0001', name: stopName, lat: 50.9, lng: 28.6 }],
    routes: [{ id: '2', fromName: 'А', toName: 'Б', shortName: stopName === 'Вокзал' ? '2-Б' : '' }],
    routeStops: [],
    trips: [],
    segments: [],
    meta: { defaultSec: 120 },
    revision: `rev-${stopName}`,
    ...extra,
  }) as unknown as TransportDataset;

const useSite = (key: 'malyn' | 'korosten') => window.history.replaceState({}, '', key === 'malyn' ? '/' : '/?site=korosten');

beforeEach(() => {
  localStorage.clear();
  invalidateTransportDatasetCache();
  useSite('malyn');
});
afterEach(() => {
  useSite('malyn');
  setRouteNamesCity(DEFAULT_TRANSPORT_CITY);
  setRouteColorsCity(DEFAULT_TRANSPORT_CITY);
  configureRouteNames([], 'Korosten');
  configureRouteColors({}, 'Korosten');
  setRouteNamesCity(DEFAULT_TRANSPORT_CITY);
  setRouteColorsCity(DEFAULT_TRANSPORT_CITY);
  vi.restoreAllMocks();
});

describe('місто сайту', () => {
  it('Малин — без параметрів у запитах; інший сайт — зі своїм містом', () => {
    expect(siteTransportCity()).toBe('Malyn');
    expect([cityQuery('Malyn'), cityQuery(undefined), cityField('Malyn')]).toEqual(['', '', {}]);
    useSite('korosten');
    expect(siteTransportCity()).toBe('Korosten');
    expect([cityQuery('Korosten'), cityQuery('Korosten', '&'), cityField('Korosten')]).toEqual(['?city=Korosten', '&city=Korosten', { city: 'Korosten' }]);
  });

  it('профіль: у Малина схема, статті й старі назви зупинок; у Коростеня — лише схема (фаза 12); у міста без схеми — нічого', () => {
    expect(transportProfile('Malyn')).toMatchObject({ hasScheme: true, hasStopArticles: true, center: [50.768, 29.242] });
    expect(transportProfile('Malyn').legacyStopNames).toContain('Малинівка');
    expect(transportProfile('Korosten')).toMatchObject({ cityCode: 'Korosten', center: [50.9506, 28.6384], hasScheme: true, hasStopArticles: false, legacyStopNames: [] });
    expect(transportProfile('Zhytomyr')).toMatchObject({ hasScheme: false, hasStopArticles: false });
  });

  it('профіль: назви міста у відмінках, домен, відкриті дані, чіпи', () => {
    expect(transportProfile('Malyn')).toMatchObject({
      name: 'Малин',
      nameGenitive: 'Малина',
      nameLocative: 'Малині',
      domain: 'malin.kiev.ua',
      siteUrl: 'https://malin.kiev.ua',
      hasOpenData: true,
      quickNodes: [],
    });
    const k = transportProfile('Korosten');
    expect(k).toMatchObject({ name: 'Коростень', nameGenitive: 'Коростеня', nameLocative: 'Коростені', domain: 'korosten.kiev.ua', siteUrl: 'https://korosten.kiev.ua', hasOpenData: false });
    expect(k.quickNodes.map((n) => n.stopIds[0])).toEqual(['st_1001', 'st_1002', 'st_1003', 'st_1079', 'st_1073', 'st_1015']);
  });
});

describe('датасет по містах', () => {
  it('запит Малина — /transport/dataset без city, Коростеня — з ?city=Korosten', async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.search);
        return HttpResponse.json(dataset(url.searchParams.get('city') === 'Korosten' ? 'Вокзал' : 'Автостанція'));
      }),
    );
    expect((await apiClient.getTransportDataset()).stops[0].name).toBe('Автостанція');
    expect((await apiClient.getTransportDataset({ city: 'Korosten' })).stops[0].name).toBe('Вокзал');
    expect(seen).toEqual(['', '?city=Korosten']);
  });

  it('копія в localStorage: ключ Малина історичний, в іншого міста — свій; копії не змішуються', () => {
    expect(datasetStorageKey()).toBe(DATASET_STORAGE_KEY);
    expect(datasetStorageKey('Korosten')).toBe(`${DATASET_STORAGE_KEY}:Korosten`);
    writeStored(dataset('Автостанція'), 1);
    writeStored(dataset('Вокзал'), 2, 'Korosten');
    expect(readStored()?.dataset.stops[0].name).toBe('Автостанція');
    expect(readStored('Korosten')?.dataset.stops[0].name).toBe('Вокзал');
    expect(localStorage.getItem(DATASET_STORAGE_KEY)).toContain('Автостанція');
  });

  it('хук: на сайті Коростеня вантажить датасет Коростеня; сторінка Малина там само просить Малин явно', async () => {
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, ({ request }) =>
        HttpResponse.json(dataset(new URL(request.url).searchParams.get('city') === 'Korosten' ? 'Вокзал' : 'Автостанція')),
      ),
    );
    useSite('korosten');
    const own = renderHook(() => useTransportDataset());
    await waitFor(() => expect(own.result.current.source).toBe('network'));
    expect(own.result.current.dataset?.stops[0].name).toBe('Вокзал');
    expect(routeNo('2')).toBe('2-Б');

    const malyn = renderHook(() => useTransportDataset(DEFAULT_TRANSPORT_CITY));
    await waitFor(() => expect(malyn.result.current.source).toBe('network'));
    expect(malyn.result.current.dataset?.stops[0].name).toBe('Автостанція');
    expect(routeNo('2')).toBe('2');
    // кеші окремі: датасет Коростеня не затерто
    expect(renderHook(() => useTransportDataset()).result.current.dataset?.stops[0].name).toBe('Вокзал');
    expect(readStored('Korosten')?.dataset.revision).toBe('rev-Вокзал');
    expect(readStored()?.dataset.revision).toBe('rev-Автостанція');
  });

  it('хук: без мережі для іншого міста знімка збірки нема — лишається помилка, а не датасет Малина', async () => {
    const snapshot = vi.fn(() => HttpResponse.json(dataset('Автостанція')));
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json({ error: 'Unknown city' }, { status: 404 })),
      http.get(`${TEST_API_URL}/transport/dataset.json`, snapshot),
    );
    useSite('korosten');
    const { result } = renderHook(() => useTransportDataset());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dataset).toBeNull();
    expect(result.current.error).not.toBe('');
    expect(snapshot).not.toHaveBeenCalled();
  });
});

describe('номери, кольори й статті по містах', () => {
  it('routeNo: той самий id — різні номери в різних містах', () => {
    configureRouteNames([{ id: '11', shortName: '11/1' }], 'Malyn');
    configureRouteNames([{ id: '11', shortName: '11-К' }], 'Korosten');
    expect(routeNo('11')).toBe('11-К');
    setRouteNamesCity('Malyn');
    expect(routeNo('11')).toBe('11/1');
  });

  it('кольори: місто зі схемою — з її легенди; без схеми — з meta.routeColors, номер контрастний', () => {
    const malynColor = routeColor('2');
    expect(malynColor).toMatch(/^#[0-9a-f]{6}$/i);
    // Коростень: легенда схеми (кольори 2019 року) важливіша за meta.routeColors
    configureRouteColors({ routeColors: { '2': { color: '#000001' }, '99': '#123456' } }, 'Korosten');
    expect(routeColor('2')).toBe('#7440A4');
    expect(routeColorStyle('3')).toEqual({ '--lt-route-color': '#A8A0D4', '--lt-route-fg': '#000000' });
    expect(routeColor('99')).toBe('#123456');
    // місто без схеми — лише meta.routeColors
    configureRouteColors({ routeColors: { '2': { color: '#A8A0D4' }, '4': '#242860', bad: { color: 'red' } } }, 'Zhytomyr');
    expect(routeColor('2')).toBe('#A8A0D4');
    expect(routeColorStyle('2')).toEqual({ '--lt-route-color': '#A8A0D4', '--lt-route-fg': '#000000' });
    expect(routeColorStyle('4')).toEqual({ '--lt-route-color': '#242860', '--lt-route-fg': '#ffffff' });
    expect(routeColor('bad')).toBeNull();
    setRouteColorsCity('Malyn');
    expect(routeColor('2')).toBe(malynColor);
    expect(routeColor('4')).toBeNull();
  });

  it('статті зупинок — лише для Малина', () => {
    expect(getStopArticle('st_0001')?.id).toBe('st_0001');
    expect(getStopArticle('st_0001', 'Korosten')).toBeUndefined();
    useSite('korosten');
    expect(getStopArticle('st_0001')).toBeUndefined();
  });
});

describe('записи з табло', () => {
  it('Малин: тіло й ключ як були; інше місто: поле city і ключ із містом', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${TEST_API_URL}/transport/sticker-scans`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ok: true, counted: true }, { status: 201 });
      }),
    );
    await sendOrQueue('sticker-scan', { stopId: 'st_0001', side: 'a' }, 'scan:st_0001-a:2026-11-10');
    useSite('korosten');
    await sendOrQueue('sticker-scan', { stopId: 'st_1001', side: 'a' }, 'scan:st_1001-a:2026-11-10');
    expect(bodies).toEqual([{ stopId: 'st_0001', side: 'a' }, { stopId: 'st_1001', side: 'a', city: 'Korosten' }]);

    // без мережі запис лягає в чергу вже з містом
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await sendOrQueue('sticker-scan', { stopId: 'st_1002', side: 'b' }, 'scan:st_1002-b:2026-11-10');
    expect(readOutbox()[0]).toMatchObject({ key: 'Korosten:scan:st_1002-b:2026-11-10', body: { stopId: 'st_1002', city: 'Korosten' } });
  });
});
