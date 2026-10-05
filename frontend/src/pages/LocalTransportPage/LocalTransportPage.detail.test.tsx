/**
 * Сторінка маршруту (/transport/route/:id): URL — єдине джерело пари «Звідки»/«Куди», напрямку
 * й обраного рейсу. RouteMap (Leaflet) замокано; датасет — через MSW.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { invalidateTransportDatasetCache } from '../TransportPage/useTransportDataset';
import { LocalTransportPage } from './LocalTransportPage';

vi.mock('./RouteMap', () => ({ RouteMap: () => <div data-testid="route-map" /> }));

/** Маршрут №2: Базар → Вокзал → Лікарня; туди 08:30 / 09:40 / 10:55, назад 09:00 / 10:10 */
const dataset = {
  stops: [
    { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
    { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
    { id: 'st_c', name: 'Лікарня', lat: 50.79, lng: 29.26 },
  ],
  routes: [
    { id: '2', fromName: 'Базар', toName: 'Лікарня', scheme: 'city', note: '', sourceUrl: '', schedule: null },
  ],
  routeStops: [
    { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 3, mapOnly: false },
    { routeId: '2', stopId: 'st_b', orderThere: 2, orderBack: 2, mapOnly: false },
    { routeId: '2', stopId: 'st_c', orderThere: 3, orderBack: 1, mapOnly: false },
  ],
  trips: [
    { id: 't1', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '08:30:00', blockId: null },
    { id: 't2', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '09:40:00', blockId: null },
    { id: 't3', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '10:55:00', blockId: null },
    { id: 't4', routeId: '2', serviceId: 'everyday', headsign: 'Базар', directionId: '0', departureTime: '09:00:00', blockId: null },
    { id: 't5', routeId: '2', serviceId: 'everyday', headsign: 'Базар', directionId: '0', departureTime: '10:10:00', blockId: null },
  ],
  segments: [
    { routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds: 240 },
    { routeId: '2', fromStopId: 'st_b', toStopId: 'st_c', seconds: 300 },
    { routeId: '2', fromStopId: 'st_c', toStopId: 'st_b', seconds: 300 },
    { routeId: '2', fromStopId: 'st_b', toStopId: 'st_a', seconds: 240 },
  ],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderRoute(path: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/transport/route/:routeId" element={<LocalTransportPage />} />
        <Route path="*" element={<div data-testid="elsewhere" />} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [path] }
  );
}

const location = () => screen.getByTestId('location').textContent ?? '';
const fromItem = () => document.querySelector('.lt-stop-item--from') as HTMLElement | null;
const toItem = () => document.querySelector('.lt-stop-item--to') as HTMLElement | null;
const selectedRow = () => document.querySelector('.lt-timetable-row--selected') as HTMLElement | null;
const tableHeaders = () => Array.from(document.querySelectorAll('thead th')).map((th) => th.textContent);
const tableRows = () => Array.from(document.querySelectorAll<HTMLElement>('.lt-timetable-row-clickable'));

async function openRoute(path: string) {
  renderRoute(path);
  await screen.findByRole('heading', { level: 1, name: /№2/ }, { timeout: 5000 });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

beforeEach(() => {
  invalidateTransportDatasetCache();
  server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(dataset)));
});

describe('LocalTransportPage route page: the pair comes from the URL', () => {
  it('a pair in the URL marks «Звідки»/«Куди», narrows the table and hides the picker', async () => {
    await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=08%3A00');
    expect(fromItem()).toHaveTextContent('Базар');
    expect(toItem()).toHaveTextContent('Вокзал');
    expect(screen.queryByRole('button', { name: 'Показати розклад' })).toBeNull();
    expect(tableHeaders()).toEqual(['Відправлення (Базар)', 'Прибуття (Вокзал)']);
    // Без `time` обраний найближчий до `h` рейс: 08:30 (а не перший рейс дня чи рейс за поточним часом)
    expect(selectedRow()).toHaveTextContent('08:30');
    expect(selectedRow()).toHaveTextContent('08:34');
    expect(fromItem()).toHaveTextContent('08:30');
  });

  it('«Показати розклад» applies the picker pair in place — stops, badges and table follow', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?d=01.03.26&h=08%3A00');
    expect(fromItem()).toBeNull();
    const from = screen.getByRole('combobox', { name: 'Звідки їдемо?' });
    await user.click(from);
    await user.keyboard('Ба');
    await user.click(await screen.findByRole('option', { name: 'Базар' }));
    const to = screen.getByRole('combobox', { name: 'Куди їдемо?' });
    await user.click(to);
    await user.keyboard('Лік');
    await user.click(await screen.findByRole('option', { name: 'Лікарня' }));
    await user.click(screen.getByRole('button', { name: 'Показати розклад' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?d=01.03.26&h=08%3A00&stop=st_a&to=st_c&dir=there'));
    expect(fromItem()).toHaveTextContent('Базар');
    expect(toItem()).toHaveTextContent('Лікарня');
    expect(screen.queryByRole('button', { name: 'Показати розклад' })).toBeNull();
    expect(tableHeaders()).toEqual(['Відправлення (Базар)', 'Прибуття (Лікарня)']);
  });

  it('`time` is the departure at «Звідки»; a first-stop time from an old link still finds the trip', async () => {
    await openRoute('/transport/route/2?stop=st_b&to=st_c&dir=there&time=09%3A44&d=01.03.26&h=08%3A00');
    expect(selectedRow()).toHaveTextContent('09:44');
    expect(fromItem()).toHaveTextContent('09:44');
    expect(toItem()).toHaveTextContent('09:49');
  });

  it('a first-stop `time` from an old link resolves to the same trip', async () => {
    await openRoute('/transport/route/2?stop=st_b&to=st_c&dir=there&time=09%3A40&d=01.03.26&h=08%3A00');
    expect(selectedRow()).toHaveTextContent('09:44');
  });

  it('a table row pins its departure in the URL and the stop times follow', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_c&d=01.03.26&h=08%3A00');
    expect(tableRows().map((r) => r.textContent)).toEqual(['08:3008:39', '09:4009:49', '10:5511:04']);
    await user.click(tableRows()[2]);
    await waitFor(() => expect(location()).toContain('time=10%3A55'));
    expect(selectedRow()).toHaveTextContent('10:55');
    expect(fromItem()).toHaveTextContent('10:55');
    expect(toItem()).toHaveTextContent('11:04');
  });

  it('«Назад» keeps the pair (swapped) and takes the nearest trip, not the first of the day', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_c&d=01.03.26&h=09%3A30');
    expect(selectedRow()).toHaveTextContent('09:40');
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?stop=st_c&to=st_a&d=01.03.26&h=09%3A30&dir=back'));
    expect(screen.getByRole('button', { name: 'Назад' })).toHaveAttribute('aria-pressed', 'true');
    expect(fromItem()).toHaveTextContent('Лікарня');
    expect(toItem()).toHaveTextContent('Базар');
    // Назад о 09:00 і 10:10 — найближчий до 09:30 рейс 10:10
    expect(selectedRow()).toHaveTextContent('10:10');
    await user.click(screen.getByRole('button', { name: 'Туди' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?stop=st_a&to=st_c&d=01.03.26&h=09%3A30&dir=there'));
    expect(selectedRow()).toHaveTextContent('09:40');
  });

  it('«Назад до пошуку» returns to the planner with the pair, or to the stop board with one stop', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=08%3A00&time=08%3A30');
    await user.click(screen.getByRole('button', { name: 'Назад до пошуку' }));
    await waitFor(() => expect(location()).toBe('/transport/st_a/st_b?d=01.03.26&h=08%3A30'));
  });

  it('with only «Звідки» the back button opens that stop board', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_b&dir=there&d=01.03.26&h=08%3A00');
    expect(fromItem()).toHaveTextContent('Вокзал');
    expect(toItem()).toBeNull();
    expect(within(fromItem()!).getByText('З')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Назад до пошуку' }));
    await waitFor(() => expect(location()).toBe('/transport/stop/st_b?d=01.03.26&h=08%3A00'));
  });
});
