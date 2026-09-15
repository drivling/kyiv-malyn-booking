/**
 * Планувальник «Як доїхати» (/transport/:from/:to): чесний стан форми.
 * RouteMap (Leaflet) замокано; датасет — через MSW.
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
    { id: 't2', routeId: '2', serviceId: 'everyday', headsign: 'Базар', directionId: '0', departureTime: '09:00:00', blockId: null },
  ],
  segments: [
    { routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds: 240 },
    { routeId: '2', fromStopId: 'st_b', toStopId: 'st_c', seconds: 300 },
  ],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPlanner(path: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/transport" element={<LocalTransportPage />} />
        <Route path="/transport/:fromStop/:toStop" element={<LocalTransportPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [path] }
  );
}

const PAIR_URL = '/transport/st_a/st_b?d=16.09.26&h=09%3A12';
const location = () => screen.getByTestId('location').textContent ?? '';

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

async function openPair() {
  renderPlanner(PAIR_URL);
  const heading = await screen.findByText(/З’єднання: Базар → Вокзал/, {}, { timeout: 5000 });
  const from = screen.getByRole('combobox', { name: 'З' });
  const to = screen.getByRole('combobox', { name: 'До' });
  expect(from).toHaveValue('Базар');
  expect(to).toHaveValue('Вокзал');
  return { heading, from, to };
}

describe('LocalTransportPage planner: form state', () => {
  it('shows connecting routes for the pair from the URL; labels are wired to the inputs', async () => {
    await openPair();
    expect(screen.getByText('№2')).toBeInTheDocument();
    expect(screen.queryByText(/немає прямого маршруту/)).not.toBeInTheDocument();
  });

  it('typing in «З» keeps the last results and shows a hint instead of «немає прямого маршруту»', async () => {
    const user = userEvent.setup();
    const { from } = await openPair();
    await user.tripleClick(from);
    await user.keyboard('Ба');
    expect(from).toHaveValue('Ба');
    expect(screen.queryByText(/немає прямого маршруту/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Оберіть зупинку зі списку.');
    expect(screen.getByText('№2')).toBeInTheDocument();
    expect(location()).toBe(PAIR_URL);
  });

  it('backspacing «З» to empty does not navigate and keeps «До»', async () => {
    const user = userEvent.setup();
    const { from, to } = await openPair();
    await user.clear(from);
    expect(from).toHaveValue('');
    expect(to).toHaveValue('Вокзал');
    expect(location()).toBe(PAIR_URL);
    expect(screen.getByText('№2')).toBeInTheDocument();
    expect(screen.queryByText(/Оберіть зупинки «З» та «До»/)).not.toBeInTheDocument();
  });

  it('the «×» button resets the pair but carries «До» in the URL', async () => {
    const user = userEvent.setup();
    const { from, to } = await openPair();
    const fromCell = from.closest('.lt-from-to-cell--from') as HTMLElement;
    await user.click(within(fromCell).getByRole('button', { name: 'Очистити' }));
    await waitFor(() => expect(location()).toBe('/transport?to=st_b&d=16.09.26&h=09%3A12'));
    expect(from).toHaveValue('');
    expect(to).toHaveValue('Вокзал');
    expect(screen.getByText(/Оберіть зупинки «З» та «До»/)).toBeInTheDocument();
    expect(screen.queryByText('№2')).not.toBeInTheDocument();
  });

  it('same stop in both fields shows a dedicated hint, not «немає прямого маршруту»', async () => {
    const user = userEvent.setup();
    const { from } = await openPair();
    await user.tripleClick(from);
    await user.keyboard('Вок');
    await user.click(await screen.findByRole('option', { name: 'Вокзал' }));
    expect(from).toHaveValue('Вокзал');
    expect(screen.getByRole('status')).toHaveTextContent('однакові');
    expect(screen.queryByText(/немає прямого маршруту/)).not.toBeInTheDocument();
  });

  it('a pair without a direct route shows the no-route state once both stops are resolved', async () => {
    // st_d лежить лише на маршруті №3 (st_c ↔ st_d): обидві зупинки резолвляться, спільного маршруту нема.
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () =>
        HttpResponse.json({
          ...dataset,
          stops: [...dataset.stops, { id: 'st_d', name: 'Парк', lat: 50.8, lng: 29.27 }],
          routes: [
            ...dataset.routes,
            { id: '3', fromName: 'Лікарня', toName: 'Парк', scheme: 'city', note: '', sourceUrl: '', schedule: null },
          ],
          routeStops: [
            ...dataset.routeStops,
            { routeId: '3', stopId: 'st_c', orderThere: 1, orderBack: 2, mapOnly: false },
            { routeId: '3', stopId: 'st_d', orderThere: 2, orderBack: 1, mapOnly: false },
          ],
          trips: [
            ...dataset.trips,
            { id: 't3', routeId: '3', serviceId: 'everyday', headsign: 'Парк', directionId: '1', departureTime: '10:00:00', blockId: null },
          ],
        })
      )
    );
    renderPlanner('/transport/st_a/st_d?d=16.09.26&h=09%3A12');
    expect(await screen.findByText(/немає прямого маршруту/, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

describe('LocalTransportPage planner: URL follows the form', () => {
  it('selecting both stops on /transport updates the URL without pressing «Знайти»', async () => {
    const user = userEvent.setup();
    renderPlanner('/transport?d=16.09.26&h=09%3A12');
    const from = await screen.findByRole('combobox', { name: 'З' }, { timeout: 5000 });
    await user.click(from);
    await user.keyboard('Ба');
    await user.click(await screen.findByRole('option', { name: 'Базар' }));
    const to = screen.getByRole('combobox', { name: 'До' });
    await user.click(to);
    await user.keyboard('Вок');
    await user.click(await screen.findByRole('option', { name: 'Вокзал' }));
    await waitFor(() => expect(location()).toBe('/transport/st_a/st_b?d=16.09.26&h=09%3A12'), { timeout: 3000 });
    expect(await screen.findByText(/З’єднання: Базар → Вокзал/)).toBeInTheDocument();
  });

  it('⇅ swaps the pair and the URL follows', async () => {
    const user = userEvent.setup();
    const { from, to } = await openPair();
    await user.click(screen.getByRole('button', { name: 'Поміняти З та До' }));
    await waitFor(() => expect(location()).toBe('/transport/st_b/st_a?d=16.09.26&h=09%3A12'), { timeout: 3000 });
    expect(from).toHaveValue('Вокзал');
    expect(to).toHaveValue('Базар');
    expect(screen.getByText(/З’єднання: Вокзал → Базар/)).toBeInTheDocument();
  });

  it('«Знайти» is enabled only for a resolved pair', async () => {
    const user = userEvent.setup();
    const { from } = await openPair();
    const find = screen.getByRole('button', { name: 'Знайти' });
    expect(find).toBeEnabled();
    await user.clear(from);
    expect(find).toBeDisabled();
  });

  it('the stop board tab carries the chosen «З» stop', async () => {
    await openPair();
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Зупинка (табло)' }).getAttribute('href')).toMatch(
      /^\/transport\/stop\/st_a\?/
    );
  });
});
