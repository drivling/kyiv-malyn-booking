/**
 * Сторінки транспорту іншого міста (Коростень, фаза 10а плану Docs/korosten-transport-2026-11.md): назви міста й домен —
 * з профілю транспорту, без малинської схеми, мініатюр, «вузлів» схеми й порядку ліній зі схеми. Сайт Коростеня тут —
 * ?site=korosten (так само поводиться перегляд адміна на malin.kiev.ua). RouteMap (Leaflet) замокано; датасет — MSW.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, screen, waitFor } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { invalidateTransportDatasetCache } from './dataset/useTransportDataset';
import { LocalTransportPage } from './LocalTransportPage';
import { LocalTransportStopBoardPage } from './LocalTransportStopBoardPage';
import { LocalTransportSchemePage } from './LocalTransportSchemePage';

vi.mock('./RouteMap', () => ({ RouteMap: () => <div data-testid="route-map" /> }));

const stops = [
  { id: 'st_1001', name: 'Залізничний вокзал', lat: 50.9566, lng: 28.6342 },
  { id: 'st_1002', name: 'Міський центральний ринок', lat: 50.9515, lng: 28.6377 },
  { id: 'st_1015', name: 'Поліське водосховище', lat: 50.9067, lng: 28.5451 },
];
/** №8 раніше за №2 у даних: у Малина порядок ліній на табло — зі схеми (№2, №3, №5, №7, №8…), тут — за номером */
const dataset = {
  stops,
  routes: [
    { id: '8', fromName: 'Залізничний вокзал', toName: 'Міський центральний ринок', scheme: 'city', note: '', sourceUrl: '', schedule: null },
    { id: '1', fromName: 'Залізничний вокзал', toName: 'Поліське водосховище', scheme: 'city', note: '', sourceUrl: '', schedule: null },
    { id: '2b', shortName: '2-Б', fromName: 'Залізничний вокзал', toName: 'Міський центральний ринок', scheme: 'city', note: '', sourceUrl: '', schedule: null },
  ],
  routeStops: [
    { routeId: '1', stopId: 'st_1001', orderThere: 1, orderBack: 3, mapOnly: false },
    { routeId: '1', stopId: 'st_1002', orderThere: 2, orderBack: 2, mapOnly: false },
    { routeId: '1', stopId: 'st_1015', orderThere: 3, orderBack: 1, mapOnly: false },
    { routeId: '8', stopId: 'st_1001', orderThere: 1, orderBack: 2, mapOnly: false },
    { routeId: '8', stopId: 'st_1002', orderThere: 2, orderBack: 1, mapOnly: false },
    { routeId: '2b', stopId: 'st_1001', orderThere: 1, orderBack: 2, mapOnly: false },
    { routeId: '2b', stopId: 'st_1002', orderThere: 2, orderBack: 1, mapOnly: false },
  ],
  trips: [
    { id: '1-101', routeId: '1', serviceId: 'everyday', headsign: 'Поліське водосховище', directionId: '1', departureTime: '06:20:00', blockId: '1-g1' },
    { id: '8-101', routeId: '8', serviceId: 'everyday', headsign: 'Міський центральний ринок', directionId: '1', departureTime: '07:00:00', blockId: '8-g1' },
    { id: '2b-101', routeId: '2b', serviceId: 'everyday', headsign: 'Міський центральний ринок', directionId: '1', departureTime: '07:30:00', blockId: '2b-g1' },
  ],
  segments: [],
  meta: { defaultSec: 120, routeColors: { '1': '#E40C1C', '8': '#F07860', '2b': '#7C6CB4' } },
  revision: 'k-1',
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/transport/route/:routeId" element={<LocalTransportPage />} />
        <Route path="/transport/stop/:stopSlug" element={<LocalTransportStopBoardPage />} />
        <Route path="/transport/scheme" element={<LocalTransportSchemePage />} />
        <Route path="/transport" element={<LocalTransportPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [path] },
  );
}

/** Текст сторінки без єдиної доречної згадки Малина — міжміського напрямку у FAQ («Київ / Житомир / Малин») */
const pageText = () => (document.body.textContent ?? '').replace('Київ / Житомир / Малин', '');

beforeEach(() => {
  window.history.replaceState({}, '', '/?site=korosten');
  invalidateTransportDatasetCache();
  localStorage.clear();
  server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(dataset)));
});
afterEach(() => {
  window.history.replaceState({}, '', '/');
});

describe('сторінки транспорту Коростеня', () => {
  it('хаб: назви Коростеня, свої чіпи, джерело ради, без схеми й без слова «Малин»', async () => {
    renderAt('/transport');
    expect(await screen.findByText('Коростень · місцевий транспорт', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Маршрути Коростеня' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Залізничний вокзал' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Поліське водосховище' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Схема' })).toBeNull();
    expect(screen.queryByText('Уся схема')).toBeNull();
    expect(screen.getByRole('link', { name: 'Розклад: Коростенська міська рада' })).toHaveAttribute('href', expect.stringContaining('korosten-rada.gov.ua'));
    expect(screen.getByText('Як доїхати міським транспортом у Коростені?')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Міжміські попутки й маршрутки Київ / Житомир / Малин — на /mizhgorodski.');
    expect(pageText()).not.toMatch(/Малин|malin\.kiev/);
    await waitFor(() => expect(document.title).toBe('Транспорт Коростеня — розклад маршруток і як доїхати | korosten.kiev.ua'));
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://korosten.kiev.ua/transport');
  });

  it('сторінка маршруту: «Маршрут №1 · Коростень», заголовок і canonical з домену Коростеня', async () => {
    renderAt('/transport/route/1');
    expect(await screen.findByText('Маршрут №1 · Коростень', {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/\| Транспорт Коростеня \| korosten\.kiev\.ua$/));
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://korosten.kiev.ua/transport/route/1');
    expect(pageText()).not.toMatch(/Малин|malin\.kiev/);
  });

  it('табло: тексти Коростеня, лінії за номером (№1, №2-Б, №8), без мініатюри схеми', async () => {
    renderAt('/transport/stop/st_1001');
    expect(await screen.findByText('Коростень · розклад відправлень', {}, { timeout: 5000 })).toBeInTheDocument();
    const chips = await screen.findByRole('group', { name: 'Маршрути через зупинку' });
    expect(chips.textContent?.replace(/\s+/g, '')).toBe('№1№2-Б№8');
    expect(document.querySelector('.lt-scheme-mini')).toBeNull();
    expect(pageText()).not.toMatch(/Малин|malin\.kiev/);
    await waitFor(() => expect(document.title).toBe('Зупинка «Залізничний вокзал» — розклад маршруток Коростеня | korosten.kiev.ua'));
  });

  it('/transport/scheme у міста без схеми веде на планувальник', async () => {
    renderAt('/transport/scheme');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transport'));
  });
});
