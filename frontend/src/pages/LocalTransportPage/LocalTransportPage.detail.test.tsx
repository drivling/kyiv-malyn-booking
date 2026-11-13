/**
 * Сторінка маршруту (/transport/route/:id): URL — єдине джерело пари «Звідки»/«Куди», напрямку
 * й обраного рейсу. RouteMap (Leaflet) замокано; датасет — через MSW.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { invalidateTransportDatasetCache } from './dataset/useTransportDataset';
import { tomorrowDateUrl } from './dateUrl';
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
  it('a pair in the URL marks «Звідки»/«Куди» on the timeline and narrows the table', async () => {
    await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=08%3A00');
    expect(fromItem()).toHaveTextContent('Базар');
    expect(within(fromItem()!).getByText('Звідки')).toBeInTheDocument();
    expect(toItem()).toHaveTextContent('Вокзал');
    expect(within(toItem()!).getByText('Куди')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Скинути' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Табло зупинки «Вокзал»' })).toHaveAttribute(
      'href',
      '/transport/stop/st_b?d=01.03.26&h=08%3A00'
    );
    expect(tableHeaders()).toEqual(['Відправлення (Базар)', 'Прибуття (Вокзал)']);
    // Без `time` обраний найближчий до `h` рейс: 08:30 (а не перший рейс дня чи рейс за поточним часом)
    expect(selectedRow()).toHaveTextContent('08:30');
    expect(selectedRow()).toHaveTextContent('08:34');
    expect(fromItem()).toHaveTextContent('08:30');
  });

  it('timeline taps: the first stop is «Звідки», the second «Куди», the next one starts over; «Скинути» clears', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?d=01.03.26&h=08%3A00');
    expect(fromItem()).toBeNull();
    expect(screen.getByText('Торкніться зупинки: спершу «Звідки», потім «Куди»')).toBeInTheDocument();
    expect(tableHeaders()).toEqual(['Відправлення', 'Прибуття']);

    await user.click(screen.getByRole('button', { name: 'Базар' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?d=01.03.26&h=08%3A00&stop=st_a&dir=there'));
    expect(fromItem()).toHaveTextContent('Базар');
    expect(toItem()).toBeNull();
    expect(screen.getByRole('button', { name: 'Базар' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Лікарня' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?d=01.03.26&h=08%3A00&stop=st_a&dir=there&to=st_c'));
    expect(toItem()).toHaveTextContent('Лікарня');
    expect(tableHeaders()).toEqual(['Відправлення (Базар)', 'Прибуття (Лікарня)']);
    expect(selectedRow()).toHaveTextContent('08:39');

    // Третій тап — нова пара від цієї зупинки
    await user.click(screen.getByRole('button', { name: 'Вокзал' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?d=01.03.26&h=08%3A00&stop=st_b&dir=there'));
    expect(fromItem()).toHaveTextContent('Вокзал');
    expect(toItem()).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Скинути' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?d=01.03.26&h=08%3A00&dir=there'));
    expect(fromItem()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Скинути' })).toBeNull();
  });

  it('tapping «Куди» again removes only «Куди»; tapping «Звідки» again clears the pair', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_c&dir=there&d=01.03.26&h=08%3A00');
    await user.click(screen.getByRole('button', { name: 'Лікарня' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?stop=st_a&dir=there&d=01.03.26&h=08%3A00'));
    expect(toItem()).toBeNull();
    expect(fromItem()).toHaveTextContent('Базар');
    await user.click(screen.getByRole('button', { name: 'Базар' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?dir=there&d=01.03.26&h=08%3A00'));
    expect(fromItem()).toBeNull();
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

  it('the departures strip lists the trips at «Звідки», the nearest is pressed, a tap pins one', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=09%3A00');
    const strip = screen.getByRole('group', { name: 'Відправлення за день' });
    const chips = within(strip).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['08:30→ 08:34', '09:40→ 09:44', '10:55→ 10:59']);
    expect(chips[1]).toHaveAttribute('aria-pressed', 'true');
    expect(selectedRow()).toHaveTextContent('09:40');
    await user.click(chips[2]);
    await waitFor(() => expect(location()).toContain('time=10%3A55'));
    expect(within(strip).getAllByRole('button')[2]).toHaveAttribute('aria-pressed', 'true');
    expect(fromItem()).toHaveTextContent('10:55');
  });

  it('the full timetable is open on a desktop and the toggle collapses it', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=08%3A00');
    const toggle = screen.getByRole('button', { name: 'Повний розклад' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('lt-timetable-full')).not.toHaveClass('lt-timetable--collapsed');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('lt-timetable-full')).toHaveClass('lt-timetable--collapsed');
  });

  it('on a phone the full timetable starts collapsed and «Карта» opens the full-screen map', async () => {
    const user = userEvent.setup();
    const desktopMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=08%3A00');
      expect(screen.getByRole('button', { name: 'Повний розклад' })).toHaveAttribute('aria-expanded', 'false');
      expect(document.getElementById('lt-timetable-full')).toHaveClass('lt-timetable--collapsed');
      expect(document.querySelector('.lt-map-column')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Карта' }));
      const dialog = screen.getByRole('dialog', { name: 'Карта' });
      expect(within(dialog).getByText('Маршрут №2')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Готово' }));
      expect(screen.queryByRole('dialog', { name: 'Карта' })).toBeNull();
    } finally {
      window.matchMedia = desktopMatchMedia;
    }
  });

  it('the date chips write d/h to the URL and unpin the trip', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_b&d=01.03.26&h=08%3A00&time=10%3A55');
    expect(selectedRow()).toHaveTextContent('10:55');
    const chips = screen.getByRole('group', { name: 'Дата і час' });
    expect(within(chips).getByRole('button', { name: '01.03.26 о 08:00' })).toBeInTheDocument();
    await user.click(within(chips).getByRole('button', { name: 'Завтра' }));
    await waitFor(() =>
      expect(location()).toBe(`/transport/route/2?stop=st_a&to=st_b&d=${tomorrowDateUrl()}&h=08%3A00`)
    );
    expect(selectedRow()).toHaveTextContent('08:30');
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
    expect(within(fromItem()!).getByText('Звідки')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Назад до пошуку' }));
    await waitFor(() => expect(location()).toBe('/transport/stop/st_b?d=01.03.26&h=08%3A00'));
  });
});

/**
 * Маршрут №2 з варіантами шляху, як перше коло №9: туди Базар → Вокзал → Залізничний вокзал (06:45, опора 07:05),
 * назад Залізничний вокзал → Лікарня → Вокзал → Базар (07:05, опора на Лікарні 07:15)
 */
const variantDataset = {
  ...dataset,
  stops: [...dataset.stops, { id: 'st_v', name: 'Залізничний вокзал', lat: 50.8, lng: 29.27 }],
  routes: [
    {
      ...dataset.routes[0],
      variants: [
        { id: '2-v1', directionId: '1', name: 'через вокзал', stops: [{ stopId: 'st_a' }, { stopId: 'st_b' }, { stopId: 'st_v' }] },
        {
          id: '2-v2',
          directionId: '0',
          name: 'від вокзалу через Лікарню',
          stops: [{ stopId: 'st_v' }, { stopId: 'st_c' }, { stopId: 'st_b' }, { stopId: 'st_a' }],
        },
      ],
    },
  ],
  trips: [
    ...dataset.trips,
    {
      id: 't6', routeId: '2', serviceId: 'everyday', headsign: '', directionId: '1', departureTime: '06:45:00', blockId: '2-first',
      variantId: '2-v1', timepoints: [{ stopId: 'st_v', time: '07:05' }],
    },
    {
      id: 't7', routeId: '2', serviceId: 'everyday', headsign: '', directionId: '0', departureTime: '07:05:00', blockId: '2-first',
      variantId: '2-v2', timepoints: [{ stopId: 'st_c', time: '07:15' }],
    },
  ],
};
const timelineStops = () => Array.from(document.querySelectorAll('.lt-stop-item .lt-stop-pick')).map((b) => b.textContent);
const timelineTimes = () => Array.from(document.querySelectorAll('.lt-stop-item .lt-stop-time')).map((b) => b.textContent);
const stripChips = () => within(screen.getByRole('group', { name: 'Відправлення за день' })).getAllByRole('button');

describe('LocalTransportPage route page: route variants', () => {
  beforeEach(() => {
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(variantDataset)));
  });

  it('the board link from a stop only a variant serves picks that trip, and its chain drives the timeline', async () => {
    await openRoute('/transport/route/2?stop=st_v&dir=back&time=07%3A05&d=01.03.26&h=07%3A00');
    expect(timelineStops()).toEqual(['Залізничний вокзал', 'Лікарня', 'Вокзал', 'Базар']);
    // Лікарня 07:15 — опорний час із листка, далі — за сегментами
    expect(timelineTimes()).toEqual(['07:05', '07:15', '07:20', '07:24']);
    expect(fromItem()).toHaveTextContent('Залізничний вокзал');
    expect(screen.getByText('Рейс 07:05 іде іншим шляхом: від вокзалу через Лікарню')).toBeInTheDocument();
    expect(stripChips().map((c) => c.textContent)).toEqual(['07:05*, іншим шляхом: від вокзалу через Лікарню']);
    expect(stripChips()[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('list', { name: 'Рейси іншим шляхом' })).toHaveTextContent('* іншим шляхом: від вокзалу через Лікарню');
  });

  it('the nearest trip may run a variant; picking a main trip brings the main chain back', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?d=01.03.26&h=06%3A30');
    expect(timelineStops()).toEqual(['Базар', 'Вокзал', 'Залізничний вокзал']);
    expect(stripChips().map((c) => c.textContent)).toEqual(['06:45*, іншим шляхом: через вокзал', '08:30', '09:40', '10:55']);
    expect(stripChips()[0]).toHaveAttribute('aria-pressed', 'true');
    await user.click(stripChips()[1]);
    await waitFor(() => expect(location()).toContain('time=08%3A30'));
    expect(timelineStops()).toEqual(['Базар', 'Вокзал', 'Лікарня']);
    expect(stripChips()[1]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/іде іншим шляхом/)).toBeNull();
  });

  it('«Назад» keeps a pair that a variant of the other direction serves', async () => {
    const user = userEvent.setup();
    await openRoute('/transport/route/2?stop=st_a&to=st_v&d=01.03.26&h=06%3A00');
    expect(selectedRow()).toHaveTextContent(/06:45.*07:05/);
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await waitFor(() => expect(location()).toBe('/transport/route/2?stop=st_v&to=st_a&d=01.03.26&h=06%3A00&dir=back'));
    expect(selectedRow()).toHaveTextContent(/07:05.*07:24/);
    expect(timelineStops()).toEqual(['Залізничний вокзал', 'Лікарня', 'Вокзал', 'Базар']);
  });
});

describe('LocalTransportPage route page: analytics events', () => {
  it('timeline, departures strip, timetable toggle, direction and «Скинути» reach gtag with ids only', async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    try {
      await openRoute('/transport/route/2?d=01.03.26&h=08%3A00');
      await user.click(screen.getByRole('button', { name: 'Базар' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_timeline_pick', { route_id: '2', action: 'from' });
      await user.click(screen.getByRole('button', { name: 'Лікарня' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_timeline_pick', { route_id: '2', action: 'to' });
      await waitFor(() => expect(location()).toContain('to=st_c'));

      const strip = screen.getByRole('group', { name: 'Відправлення за день' });
      await user.click(within(strip).getAllByRole('button')[2]);
      expect(gtag).toHaveBeenCalledWith('event', 'transport_departure_pick', { route_id: '2', dir: 'there', source: 'strip' });

      await user.click(screen.getByRole('button', { name: 'Повний розклад' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_timetable_toggle', { route_id: '2', open: false });

      const direction = screen.getByRole('group', { name: 'Напрямок руху' });
      await user.click(within(direction).getByRole('button', { name: 'Назад' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_direction', { route_id: '2', dir: 'back', source: 'toggle' });

      await user.click(await screen.findByRole('button', { name: 'Скинути' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_timeline_pick', { route_id: '2', action: 'reset' });

      // Лише id зупинок і маршрутів — жодної назви зупинки в параметрах
      for (const call of gtag.mock.calls) {
        expect(JSON.stringify(call[2] ?? {})).not.toMatch(/Базар|Вокзал|Лікарня/);
      }
    } finally {
      Reflect.deleteProperty(window, 'gtag');
    }
  });
});

describe('LocalTransportPage route page: display number', () => {
  it('shows shortName («2К») in the heading, subtitle and page title while the URL keeps the id', async () => {
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () =>
        HttpResponse.json({ ...dataset, routes: [{ ...dataset.routes[0], shortName: '2К' }] })
      )
    );
    renderRoute('/transport/route/2');
    expect(await screen.findByRole('heading', { level: 1, name: /№2К/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Маршрут №2К · Малин')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toContain('№2К'));
    expect(location()).toBe('/transport/route/2');
  });
});


/**
 * Плашка «Проїзд 25₴» у шапці маршруту: сума з meta.fare, той самий темний градієнт, що й «Тариф у сервісі»
 * в довідці (.support-fare-chip). #52 колись замінив її на текстовий чип — цей блок не дає зробити це знову.
 */
describe('LocalTransportPage route page: the fare plate', () => {
  const withFare = { ...dataset, meta: { ...dataset.meta, fare: { amount: 25, currency: 'UAH' } } };

  it('shows the plate from meta.fare: uppercase label, amount and a separate «₴», no generic chip classes', async () => {
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(withFare)));
    await openRoute('/transport/route/2');
    const plate = await screen.findByLabelText('Проїзд 25 гривень');
    expect(plate.classList.contains('lt-fare-chip')).toBe(true);
    expect(plate.classList.contains('lt-chip')).toBe(false);
    expect(plate.querySelector('.lt-fare-chip__label')?.textContent).toBe('Проїзд');
    expect(plate.querySelector('.lt-fare-chip__amount')?.textContent).toBe('25₴');
    const currency = plate.querySelector('.lt-fare-chip__currency');
    expect(currency?.textContent).toBe('₴');
    expect(currency?.getAttribute('aria-hidden')).toBe('true');
    // Плашка стоїть у шапці поруч із заголовком маршруту
    expect(plate.closest('.lt-detail-header, .lt-route-header, header')).not.toBeNull();
  });

  it('is absent while the dataset has no fare', async () => {
    await openRoute('/transport/route/2');
    expect(screen.queryByLabelText(/^Проїзд \d+ гривень$/)).toBeNull();
    expect(document.querySelector('.lt-fare-chip')).toBeNull();
  });

  it('keeps the help-centre design: same gradient, label and currency colour as .support-fare-chip', () => {
    const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    const rule = (css: string, selector: string) => {
      const m = new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css);
      expect(m, `${selector} rule`).not.toBeNull();
      return m![1];
    };
    const route = read('./LocalTransportPage.css');
    const support = read('../SupportPage/SupportPage.css');
    const gradient = /background:\s*(linear-gradient\([^)]*\))/;
    const routeGradient = gradient.exec(rule(route, '.lt-fare-chip'))?.[1];
    const supportGradient = gradient.exec(rule(support, '.support-fare-chip'))?.[1];
    expect(routeGradient).toBeTruthy();
    expect(routeGradient).toBe(supportGradient);
    expect(rule(route, '.lt-fare-chip')).toMatch(/color:\s*#fff/);
    expect(rule(route, '.lt-fare-chip__label')).toMatch(/text-transform:\s*uppercase/);
    const mint = /#5ee4b5/;
    expect(rule(route, '.lt-fare-chip__currency')).toMatch(mint);
    expect(rule(support, '.support-fare-chip__amount span')).toMatch(mint);
  });
});
