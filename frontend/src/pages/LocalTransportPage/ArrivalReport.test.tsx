/**
 * «Факт прибуття»: довге натискання на час рейсу (чіп стрічки відправлень на сторінці маршруту,
 * картка табло) → ArrivalReportSheet → POST /transport/arrival-reports. Київський час — фіксований
 * (фальшивий лише Date), датасет і POST — MSW, RouteMap замокано.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { invalidateTransportDatasetCache } from '../TransportPage/useTransportDataset';
import { LocalTransportPage } from './LocalTransportPage';
import { LocalTransportStopBoardPage } from './LocalTransportStopBoardPage';
import { arrivalReportWindow, clockDiff, delayLabel, isReportableStopId, minsToHhmm } from './arrivalReport';
import { LONG_PRESS_MS, useLongPress } from './useLongPress';

vi.mock('./RouteMap', () => ({ RouteMap: () => <div data-testid="route-map" /> }));

const dataset = {
  stops: [
    { id: 'st_a', name: 'Базар', lat: 50.77, lng: 29.24 },
    { id: 'st_b', name: 'Вокзал', lat: 50.78, lng: 29.25 },
    { id: 'st_c', name: 'Лікарня', lat: 50.79, lng: 29.26 },
  ],
  routes: [{ id: '2', fromName: 'Базар', toName: 'Лікарня', scheme: 'city', note: '', sourceUrl: '', schedule: null }],
  routeStops: [
    { routeId: '2', stopId: 'st_a', orderThere: 1, orderBack: 3, mapOnly: false },
    { routeId: '2', stopId: 'st_b', orderThere: 2, orderBack: 2, mapOnly: false },
    { routeId: '2', stopId: 'st_c', orderThere: 3, orderBack: 1, mapOnly: false },
  ],
  trips: [
    { id: 't1', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '08:30:00', blockId: null },
    { id: 't2', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '09:40:00', blockId: null },
    { id: 't4', routeId: '2', serviceId: 'everyday', headsign: 'Базар', directionId: '0', departureTime: '09:00:00', blockId: null },
  ],
  segments: [
    { routeId: '2', fromStopId: 'st_a', toStopId: 'st_b', seconds: 240 },
    { routeId: '2', fromStopId: 'st_b', toStopId: 'st_c', seconds: 300 },
    { routeId: '2', fromStopId: 'st_c', toStopId: 'st_b', seconds: 300 },
    { routeId: '2', fromStopId: 'st_b', toStopId: 'st_a', seconds: 240 },
  ],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
};

/** 9 жовтня 2026, 08:33 за Києвом (UTC+3) */
const NOW = new Date('2026-10-09T08:33:00+03:00');
const TODAY = '09.10.26';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}
const location = () => screen.getByTestId('location').textContent ?? '';

function renderAt(path: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/transport/route/:routeId" element={<LocalTransportPage />} />
        <Route path="/transport/stop/:stopSlug" element={<LocalTransportStopBoardPage />} />
      </Routes>
      <LocationProbe />
    </>,
    { initialEntries: [path] }
  );
}

let posted: unknown[] = [];

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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  posted = [];
  invalidateTransportDatasetCache();
  server.use(
    http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(dataset)),
    http.post(`${TEST_API_URL}/transport/arrival-reports`, async ({ request }) => {
      const body = (await request.json()) as { kind: string; minutesAgo?: number };
      posted.push(body);
      return HttpResponse.json(
        body.kind === 'arrived'
          ? { ok: true, counted: true, actualTime: minsToHhmm(8 * 60 + 33 - (body.minutesAgo ?? 0)), delayMin: 3 - (body.minutesAgo ?? 0) }
          : { ok: true, counted: true, actualTime: null, delayMin: null },
        { status: 201 }
      );
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'gtag');
});

describe('arrivalReport helpers', () => {
  it('window: arrived within ±90 min, missed from 5 min before to 3 h after, only today', () => {
    expect(arrivalReportWindow('08:30', 8 * 60 + 33, true)).toEqual({ delta: 3, canArrive: true, canMiss: true });
    expect(arrivalReportWindow('08:30', 8 * 60 + 20, true)).toMatchObject({ canArrive: true, canMiss: false });
    expect(arrivalReportWindow('08:30', 11 * 60, true)).toMatchObject({ canArrive: false, canMiss: true });
    expect(arrivalReportWindow('08:30', 12 * 60, true)).toMatchObject({ canArrive: false, canMiss: false });
    expect(arrivalReportWindow('08:30', 8 * 60 + 33, false)).toMatchObject({ canArrive: false, canMiss: false });
    expect(arrivalReportWindow('23:55', 5, true).delta).toBe(10);
  });

  it('labels and ids', () => {
    expect(delayLabel(0)).toBe('вчасно');
    expect(delayLabel(6)).toBe('запізнення 6 хв');
    expect(delayLabel(-2)).toBe('на 2 хв раніше');
    expect(clockDiff(5, 23 * 60 + 55)).toBe(10);
    expect(isReportableStopId('st_0015')).toBe(true);
    expect(isReportableStopId('Базар')).toBe(false);
    expect(isReportableStopId('')).toBe(false);
  });
});

describe('useLongPress', () => {
  function Probe({ onLong, onClick }: { onLong: () => void; onClick: () => void }) {
    const press = useLongPress();
    return (
      <button type="button" onClick={onClick} {...press(onLong)}>
        hold
      </button>
    );
  }

  it('fires after holding, swallows the click that follows; a short tap is a plain click', () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    const onClick = vi.fn();
    render(<Probe onLong={onLong} onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'hold' });

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(onLong).toHaveBeenCalledTimes(1);
    fireEvent.contextMenu(btn);
    expect(onLong).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();

    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onLong).toHaveBeenCalledTimes(1);
  });

  it('moving the finger (scrolling the strip) cancels; right click / menu key opens', () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    render(<Probe onLong={onLong} onClick={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'hold' });
    fireEvent.pointerDown(btn, { clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerMove(btn, { clientX: 40, clientY: 10, pointerType: 'touch' });
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    expect(onLong).not.toHaveBeenCalled();
    fireEvent.pointerUp(btn);
    fireEvent.contextMenu(btn);
    expect(onLong).toHaveBeenCalledTimes(1);
  });
});

describe('route page: long press on a departure chip', () => {
  it('opens the sheet without pinning the trip and records «Автобус тут» for the «Звідки» stop', async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    renderAt(`/transport/route/2?stop=st_a&dir=there&time=09%3A40&d=${TODAY}&h=08%3A00`);
    const strip = await screen.findByRole('group', { name: 'Відправлення за день' }, { timeout: 5000 });
    expect(screen.getByText(/Утримайте його час/)).toBeInTheDocument();
    const chip = within(strip).getAllByRole('button')[0];
    expect(chip).toHaveTextContent('08:30');
    const before = location();

    fireEvent.contextMenu(chip);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('№2 · 08:30 за розкладом');
    expect(dialog).toHaveTextContent('Зупинка «Базар»');
    expect(location()).toBe(before);

    await user.click(within(dialog).getByRole('button', { name: 'Автобус тут — зараз 08:33' }));
    await within(dialog).findByText(/Записали: автобус приїхав о 08:33 — запізнення 3 хв/);
    expect(posted).toEqual([
      expect.objectContaining({
        kind: 'arrived',
        routeId: '2',
        tripId: 't1',
        direction: 'there',
        stopId: 'st_a',
        scheduledTime: '08:30',
        source: 'route',
        minutesAgo: 0,
      }),
    ]);
    expect(gtag).toHaveBeenCalledWith('event', 'transport_arrival_open', { route_id: '2', source: 'route' });
    expect(gtag).toHaveBeenCalledWith('event', 'transport_arrival_report', { route_id: '2', kind: 'arrived', source: 'route' });
    for (const call of gtag.mock.calls) expect(JSON.stringify(call[2] ?? {})).not.toMatch(/Базар|Вокзал|Лікарня/);

    await user.click(within(dialog).getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('«Був раніше: 5 хв тому» sends minutesAgo', async () => {
    const user = userEvent.setup();
    renderAt(`/transport/route/2?stop=st_a&dir=there&d=${TODAY}&h=08%3A00`);
    const strip = await screen.findByRole('group', { name: 'Відправлення за день' }, { timeout: 5000 });
    fireEvent.contextMenu(within(strip).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '5 хв тому' }));
    await within(dialog).findByText(/приїхав о 08:28 — на 2 хв раніше/);
    expect(posted).toEqual([expect.objectContaining({ kind: 'arrived', minutesAgo: 5 })]);
  });

  it('another date: no hint, and the sheet only explains that today is needed', async () => {
    renderAt('/transport/route/2?stop=st_a&dir=there&d=10.10.26&h=08%3A00');
    const strip = await screen.findByRole('group', { name: 'Відправлення за день' }, { timeout: 5000 });
    expect(screen.queryByText(/Утримайте його час/)).not.toBeInTheDocument();
    fireEvent.contextMenu(within(strip).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('лише для сьогоднішніх рейсів');
    expect(within(dialog).queryByRole('button', { name: /Автобус тут/ })).not.toBeInTheDocument();
  });

  it('a trip far from now: neither action, Escape closes', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date('2026-10-09T13:00:00+03:00'));
    renderAt(`/transport/route/2?stop=st_a&dir=there&d=${TODAY}&h=08%3A00`);
    const strip = await screen.findByRole('group', { name: 'Відправлення за день' }, { timeout: 5000 });
    fireEvent.contextMenu(within(strip).getAllByRole('button')[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('надто далеко від поточного часу');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('stop board: long press on a departure card', () => {
  it('does not follow the link and records «автобуса не було» with the waiting time', async () => {
    const user = userEvent.setup();
    renderAt(`/transport/stop/st_a?d=${TODAY}&h=08%3A00`);
    const card = await screen.findByRole('link', { name: /Маршрут 2, відправлення 08:30/ }, { timeout: 5000 });
    expect(screen.getByText(/Утримайте картку/)).toBeInTheDocument();
    const before = location();

    fireEvent.contextMenu(card);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('№2 · 08:30 за розкладом');
    expect(dialog).toHaveTextContent('→ Лікарня');
    expect(location()).toBe(before);

    await user.click(within(dialog).getByRole('button', { name: 'Чекав(-ла), автобуса не було' }));
    await user.click(within(dialog).getByRole('button', { name: '20 хв' }));
    await within(dialog).findByText(/Записали, що автобуса не було/);
    expect(posted).toEqual([
      expect.objectContaining({
        kind: 'missed',
        routeId: '2',
        tripId: 't1',
        direction: 'there',
        stopId: 'st_a',
        scheduledTime: '08:30',
        source: 'board',
        waitedMin: 20,
      }),
    ]);
    await waitFor(() => expect(location()).toBe(before));
  });

  it('a server error is shown and the sheet stays open', async () => {
    const user = userEvent.setup();
    server.use(http.post(`${TEST_API_URL}/transport/arrival-reports`, () => HttpResponse.json({ error: 'boom' }, { status: 500 })));
    renderAt(`/transport/stop/st_a?d=${TODAY}&h=08%3A00`);
    const card = await screen.findByRole('link', { name: /Маршрут 2, відправлення 08:30/ }, { timeout: 5000 });
    fireEvent.contextMenu(card);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Автобус тут — зараз 08:33' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Не вдалося надіслати');
  });
});
