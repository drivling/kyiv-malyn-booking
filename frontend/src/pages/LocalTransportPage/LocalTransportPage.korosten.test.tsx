/**
 * Сторінки транспорту іншого міста (Коростень, фази 10а і 12 плану Docs/korosten-transport-2026-11.md): назви міста й домен —
 * з профілю транспорту, схема, мініатюри й порядок ліній — зі схеми Коростеня, нічого малинського. Сайт Коростеня тут —
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
    { id: '1-102', routeId: '1', serviceId: 'weekdays', headsign: 'Поліське водосховище', directionId: '1', departureTime: '16:55:00', blockId: '1-g1' },
    { id: '1-103', routeId: '1', serviceId: 'weekends', headsign: 'Поліське водосховище', directionId: '1', departureTime: '17:10:00', blockId: '1-g1' },
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
  it('хаб: назви Коростеня, свої чіпи, джерело ради, схема Коростеня й без слова «Малин»', async () => {
    renderAt('/transport');
    expect(await screen.findByText('Коростень · місцевий транспорт', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Маршрути Коростеня' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Залізничний вокзал' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Поліське водосховище' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Схема' })).toHaveAttribute('href', expect.stringMatching(/^\/transport\/scheme/));
    expect(screen.getByText('Уся схема')).toBeInTheDocument();
    // міні-схема — коростенська (лінія 2-Б є лише там)
    expect(document.querySelector('.lts-mini [data-route="2b"]')).not.toBeNull();
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

  it('табло: тексти Коростеня, лінії в порядку легенди схеми Коростеня (№1, №2-Б, №8), мініатюра схеми Коростеня', async () => {
    renderAt('/transport/stop/st_1001');
    expect(await screen.findByText('Коростень · розклад відправлень', {}, { timeout: 5000 })).toBeInTheDocument();
    const chips = await screen.findByRole('group', { name: 'Маршрути через зупинку' });
    expect(chips.textContent?.replace(/\s+/g, '')).toBe('№1№2-Б№8');
    expect(document.querySelector('.lts-mini [data-route="2b"]')).not.toBeNull();
    expect(pageText()).not.toMatch(/Малин|malin\.kiev/);
    await waitFor(() => expect(document.title).toBe('Зупинка «Залізничний вокзал» — розклад маршруток Коростеня | korosten.kiev.ua'));
  });

  it('сторінка маршруту: рейси лише по буднях / лише у вихідні — тільки у свій день', async () => {
    const chipsOn = async (d: string) => {
      const view = renderAt(`/transport/route/1?d=${d}&h=06:00`);
      const group = await screen.findByRole('group', { name: 'Відправлення за день' }, { timeout: 5000 });
      const text = group.textContent ?? '';
      view.unmount();
      return text;
    };
    const wednesday = await chipsOn('18.11.26');
    expect(wednesday).toContain('16:55');
    expect(wednesday).not.toContain('17:10');
    const saturday = await chipsOn('21.11.26');
    expect(saturday).not.toContain('16:55');
    expect(saturday).toContain('17:10');
    expect(saturday).toContain('06:20');
  });

  it('табло: стаття Коростеня — вулиця з переліку ради, маршрути з датасету, опис з «у Коростені»', async () => {
    renderAt('/transport/stop/st_1001');
    const article = await screen.findByRole('region', { name: 'Про зупинку' }, { timeout: 5000 });
    expect(article.textContent).toContain('Зупинка «Залізничний вокзал» у Коростені — вул. Героїв небесної сотні.');
    expect(article.textContent).toContain('Адреса — з переліку зупинок Коростенської міської ради.');
    expect(article.textContent?.replace(/\s+/g, '')).toContain('№1№2-Б№8');
    // стаття без координат: точки частини зупинок Коростеня тимчасові
    expect(article.querySelector('.lt-stop-article-coords')).toBeNull();
    await waitFor(() =>
      expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
        'Зупинка «Залізничний вокзал» у Коростені — вул. Героїв небесної сотні. Маршрути: №1, №2-Б, №8.'
      )
    );
  });

  it('/transport/scheme: схема Коростеня, свій плакат, SEO з домену Коростеня, без блоку відкритих даних', async () => {
    renderAt('/transport/scheme');
    expect(await screen.findByText('Коростень · 9 міських маршрутів · не в масштабі', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/transport/scheme');
    expect(document.querySelector('.lts-canvas [data-route="2b"]')).not.toBeNull();
    // чип над схемою і лінія в SVG
    expect(screen.getAllByRole('button', { name: /^Маршрут №2-Б:/ }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('link', { name: 'PDF' })).toHaveAttribute('href', '/transport/scheme/korosten-transit-scheme-poster.pdf');
    expect(document.getElementById('open-data')).toBeNull();
    expect(pageText()).not.toMatch(/Малин|malin\.kiev/);
    await waitFor(() => expect(document.title).toBe('Схема маршрутів Коростеня — міські автобуси | korosten.kiev.ua'));
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://korosten.kiev.ua/transport/scheme');
  });

  it('/transport/scheme у міста без схеми веде на планувальник', async () => {
    window.history.replaceState({}, '', '/?site=zhytomyr');
    renderAt('/transport/scheme');
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/transport'));
  });
});
