/**
 * Табло зупинки (/transport/stop/:stopSlug): зупинка з URL — джерело істини; текст у полі не
 * чіпає URL/заголовок/розклад, поки не обрано зупинку зі списку. RouteMap замокано, датасет — MSW.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { invalidateTransportDatasetCache } from '../TransportPage/useTransportDataset';
import { LocalTransportStopBoardPage } from './LocalTransportStopBoardPage';

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
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{location.pathname + location.search}</div>
      <button type="button" onClick={() => navigate('/transport/stop')}>
        probe: to hub
      </button>
    </>
  );
}

function renderBoard(path: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/transport/stop/:stopSlug" element={<LocalTransportStopBoardPage />} />
        <Route path="/transport/stop" element={<LocalTransportStopBoardPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [path] }
  );
}

// Дата в минулому і ранній час: усі рейси мок-датасету видимі, відлік не показується.
const BOARD_URL = '/transport/stop/st_a?d=01.03.26&h=07%3A00';
const location = () => screen.getByTestId('location').textContent ?? '';
const h1 = () => screen.getByRole('heading', { level: 1 });

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

async function openBoard() {
  renderBoard(BOARD_URL);
  await waitFor(() => expect(h1()).toHaveTextContent('Зупинка «Базар»'), { timeout: 5000 });
  const field = screen.getByRole('combobox', { name: 'Зупинка' });
  await waitFor(() => expect(field).toHaveValue('Базар'));
  return field;
}

describe('LocalTransportStopBoardPage: stop from the URL', () => {
  it('direct hit renders the stop, its departures and hands the stop to the planner tab', async () => {
    const field = await openBoard();
    expect(field).toHaveValue('Базар');
    expect(screen.getByRole('link', { name: /Маршрут 2, відправлення 08:30, Лікарня/ })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Маршрути (З → До)' }).getAttribute('href')).toContain('from=st_a');
    expect(document.title).toMatch(/^Зупинка «Базар»/);
  });

  it('typing in the field does not touch the URL, heading or departures; a hint appears', async () => {
    const user = userEvent.setup();
    const field = await openBoard();
    await user.tripleClick(field);
    await user.keyboard('Вок');
    expect(field).toHaveValue('Вок');
    expect(location()).toBe(BOARD_URL);
    expect(h1()).toHaveTextContent('Зупинка «Базар»');
    expect(document.title).toMatch(/^Зупинка «Базар»/);
    expect(screen.getByText('Оберіть зупинку зі списку.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('link', { name: /Маршрут 2, відправлення 08:30/ })).toBeInTheDocument();
    expect(screen.queryByText(/немає розкладу в даних/)).not.toBeInTheDocument();
  });

  it('picking a stop from the list navigates to its board (replace) and updates the heading', async () => {
    const user = userEvent.setup();
    const field = await openBoard();
    await user.tripleClick(field);
    await user.keyboard('Вок');
    await user.click(await screen.findByRole('option', { name: 'Вокзал' }));
    await waitFor(() => expect(location()).toBe('/transport/stop/st_b?d=01.03.26&h=07%3A00'));
    expect(h1()).toHaveTextContent('Зупинка «Вокзал»');
    expect(field).toHaveValue('Вокзал');
    expect(screen.getByRole('link', { name: /Маршрут 2, відправлення 08:34, Лікарня/ })).toBeInTheDocument();
    expect(screen.queryByText('Оберіть зупинку зі списку.')).not.toBeInTheDocument();
  });

  it('the «×» button opens the board without a stop', async () => {
    const user = userEvent.setup();
    await openBoard();
    await user.click(screen.getByRole('button', { name: 'Очистити' }));
    await waitFor(() => expect(location()).toBe('/transport/stop?d=01.03.26&h=07%3A00'));
    expect(h1()).toHaveTextContent('Табло зупинок');
    expect(screen.getByText('Оберіть зупинку, щоб побачити розклад відправлень.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Маршрут 2/ })).not.toBeInTheDocument();
  });

  it('clearing the field with the keyboard keeps the stop, URL and departures', async () => {
    const user = userEvent.setup();
    const field = await openBoard();
    await user.clear(field);
    expect(field).toHaveValue('');
    expect(location()).toBe(BOARD_URL);
    expect(h1()).toHaveTextContent('Зупинка «Базар»');
    expect(screen.getByRole('link', { name: /Маршрут 2, відправлення 08:30/ })).toBeInTheDocument();
  });

  it('navigating to /transport/stop from a stop does not keep the stale stop', async () => {
    const user = userEvent.setup();
    await openBoard();
    await user.click(screen.getByRole('button', { name: 'probe: to hub' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Табло зупинок'));
    expect(screen.queryByRole('link', { name: /Маршрут 2/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Зупинка' })).toHaveValue('');
  });
});
