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
import { invalidateTransportDatasetCache } from './dataset/useTransportDataset';
import { dateUrlToIso, todayDateUrl, tomorrowDateUrl } from './dateUrl';
import { LocalTransportPage } from './LocalTransportPage';
import { SCHEME_NODES } from './scheme/malyn-scheme-nodes';

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

/** Вузол схеми «Залізничний вокзал» (st_0019) у датасеті → чіп швидкого старту */
const quickDataset = {
  ...dataset,
  stops: [...dataset.stops, { id: 'st_0019', name: 'Залізничний вокзал', lat: 50.8, lng: 29.27 }],
  routeStops: [...dataset.routeStops, { routeId: '2', stopId: 'st_0019', orderThere: 4, orderBack: 0, mapOnly: false }],
};

/** Два маршрути Базар → Вокзал: №3 відправляється раніше за №2; у №2 ще два рейси «далі» */
const sortedDataset = {
  ...dataset,
  routes: [
    ...dataset.routes,
    { id: '3', fromName: 'Базар', toName: 'Вокзал', scheme: 'city', note: '', sourceUrl: '', schedule: null },
  ],
  routeStops: [
    ...dataset.routeStops,
    { routeId: '3', stopId: 'st_a', orderThere: 1, orderBack: 2, mapOnly: false },
    { routeId: '3', stopId: 'st_b', orderThere: 2, orderBack: 1, mapOnly: false },
  ],
  trips: [
    ...dataset.trips,
    { id: 't3', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '09:40:00', blockId: null },
    { id: 't4', routeId: '2', serviceId: 'everyday', headsign: 'Лікарня', directionId: '1', departureTime: '10:55:00', blockId: null },
    { id: 't5', routeId: '3', serviceId: 'everyday', headsign: 'Вокзал', directionId: '1', departureTime: '08:10:00', blockId: null },
  ],
  segments: [...dataset.segments, { routeId: '3', fromStopId: 'st_a', toStopId: 'st_b', seconds: 300 }],
};

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
  const heading = await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
  const from = screen.getByRole('combobox', { name: 'Звідки' });
  const to = screen.getByRole('combobox', { name: 'Куди' });
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
    expect(screen.getByText('Оберіть зупинку зі списку.')).toHaveAttribute('role', 'status');
    expect(screen.getByText('№2')).toBeInTheDocument();
    expect(location()).toBe(PAIR_URL);
  });

  it('backspacing «Звідки» to empty does not navigate and keeps «Куди»', async () => {
    const user = userEvent.setup();
    const { from, to } = await openPair();
    await user.clear(from);
    expect(from).toHaveValue('');
    expect(to).toHaveValue('Вокзал');
    expect(location()).toBe(PAIR_URL);
    expect(screen.getByText('№2')).toBeInTheDocument();
    expect(screen.queryByText(/Оберіть зупинки «Звідки» та «Куди»/)).not.toBeInTheDocument();
  });

  it('the «×» button resets the pair but carries «Куди» in the URL', async () => {
    const user = userEvent.setup();
    const { from, to } = await openPair();
    const fromCell = from.closest('.lt-from-to-cell--from') as HTMLElement;
    await user.click(within(fromCell).getByRole('button', { name: 'Очистити' }));
    await waitFor(() => expect(location()).toBe('/transport?to=st_b&d=16.09.26&h=09%3A12'));
    expect(from).toHaveValue('');
    expect(to).toHaveValue('Вокзал');
    // «Куди» лишилось — швидкий старт просить обрати «Звідки»
    expect(screen.getByText('Тепер оберіть «Звідки»')).toBeInTheDocument();
    expect(screen.queryByText('№2')).not.toBeInTheDocument();
  });

  it('same stop in both fields shows a dedicated hint, not «немає прямого маршруту»', async () => {
    const user = userEvent.setup();
    const { from } = await openPair();
    await user.tripleClick(from);
    await user.keyboard('Вок');
    await user.click(await screen.findByRole('option', { name: 'Вокзал' }));
    expect(from).toHaveValue('Вокзал');
    expect(screen.getByText(/однакові/)).toHaveAttribute('role', 'status');
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

describe('LocalTransportPage planner: nearby alternatives when there is no direct route', () => {
  // st_e «Ринок» стоїть за ~20 м від st_a «Базар» і лежить на маршруті №3 разом зі st_d «Парк».
  const withNearby = {
    ...dataset,
    stops: [
      ...dataset.stops,
      { id: 'st_d', name: 'Парк', lat: 50.8, lng: 29.27 },
      { id: 'st_e', name: 'Ринок', lat: 50.77015, lng: 29.24012 },
    ],
    routes: [
      ...dataset.routes,
      { id: '3', fromName: 'Ринок', toName: 'Парк', scheme: 'city', note: '', sourceUrl: '', schedule: null },
    ],
    routeStops: [
      ...dataset.routeStops,
      { routeId: '3', stopId: 'st_e', orderThere: 1, orderBack: 3, mapOnly: false },
      { routeId: '3', stopId: 'st_c', orderThere: 2, orderBack: 2, mapOnly: false },
      { routeId: '3', stopId: 'st_d', orderThere: 3, orderBack: 1, mapOnly: false },
    ],
    trips: [
      ...dataset.trips,
      { id: 't3', routeId: '3', serviceId: 'everyday', headsign: 'Парк', directionId: '1', departureTime: '10:00:00', blockId: null },
    ],
  };

  it('suggests the neighbouring stop with a direct route and applies it on click', async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(withNearby)));
    try {
      renderPlanner('/transport/st_a/st_d?d=16.09.26&h=09%3A12');
      await screen.findByText(/немає прямого маршруту/, {}, { timeout: 5000 });
      expect(screen.getByText('Поруч є зупинки з прямим маршрутом:')).toBeInTheDocument();
      const suggestion = screen.getByRole('button', { name: /Ринок → Парк/ });
      expect(suggestion).toHaveTextContent(/\d+ м від «Базар» · №3/);
      await waitFor(() =>
        expect(gtag).toHaveBeenCalledWith('event', 'transport_no_route', { from: 'st_a', to: 'st_d', nearby: 1 })
      );

      await user.click(suggestion);
      expect(gtag).toHaveBeenCalledWith('event', 'transport_nearby_pick', expect.objectContaining({ from: 'st_e', to: 'st_d', changed: 'from' }));
      await waitFor(() => expect(location()).toBe('/transport/st_e/st_d?d=16.09.26&h=09%3A12'), { timeout: 3000 });
      expect(screen.getByRole('combobox', { name: 'Звідки' })).toHaveValue('Ринок');
      expect(await screen.findByText(/Прямі маршрути: Ринок → Парк/)).toBeInTheDocument();
      expect(screen.queryByText(/немає прямого маршруту/)).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(window, 'gtag');
    }
  });

  it('without a neighbour that helps, the no-route state has no suggestions block', async () => {
    // Той самий датасет, але «Ринок» за 3 км від «Базар» — поза радіусом пошуку.
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () =>
        HttpResponse.json({
          ...withNearby,
          stops: withNearby.stops.map((s) => (s.id === 'st_e' ? { ...s, lat: 50.8, lng: 29.2 } : s)),
        })
      )
    );
    renderPlanner('/transport/st_a/st_d?d=16.09.26&h=09%3A12');
    await screen.findByText(/немає прямого маршруту/, {}, { timeout: 5000 });
    expect(screen.queryByText('Поруч є зупинки з прямим маршрутом:')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'табло зупинки' })).toBeInTheDocument();
  });
});

describe('LocalTransportPage planner: URL follows the form', () => {
  it('selecting both stops on /transport updates the URL as soon as the pair resolves (no «Знайти»)', async () => {
    const user = userEvent.setup();
    renderPlanner('/transport?d=16.09.26&h=09%3A12');
    const from = await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
    await user.click(from);
    await user.keyboard('Ба');
    await user.click(await screen.findByRole('option', { name: 'Базар' }));
    const to = screen.getByRole('combobox', { name: 'Куди' });
    await user.click(to);
    await user.keyboard('Вок');
    await user.click(await screen.findByRole('option', { name: 'Вокзал' }));
    await waitFor(() => expect(location()).toBe('/transport/st_a/st_b?d=16.09.26&h=09%3A12'), { timeout: 3000 });
    expect(await screen.findByText(/Прямі маршрути: Базар → Вокзал/)).toBeInTheDocument();
  });

  it('⇅ swaps the pair and the URL follows', async () => {
    const user = userEvent.setup();
    const { from, to } = await openPair();
    await user.click(screen.getByRole('button', { name: 'Поміняти місцями' }));
    await waitFor(() => expect(location()).toBe('/transport/st_b/st_a?d=16.09.26&h=09%3A12'), { timeout: 3000 });
    expect(from).toHaveValue('Вокзал');
    expect(to).toHaveValue('Базар');
    expect(screen.getByText(/Прямі маршрути: Вокзал → Базар/)).toBeInTheDocument();
  });

  it('the stop board tab carries the chosen «З» stop', async () => {
    await openPair();
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Зупинка (табло)' }).getAttribute('href')).toMatch(
      /^\/transport\/stop\/st_a\?/
    );
  });

  it('arriving from the board (?from=) fills «Звідки»; picking another «Звідки» keeps ?from= current', async () => {
    const user = userEvent.setup();
    renderPlanner('/transport?from=st_a&d=16.09.26&h=09%3A12');
    const from = await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
    await waitFor(() => expect(from).toHaveValue('Базар'));
    expect(screen.getByRole('combobox', { name: 'Куди' })).toHaveValue('');
    // Лише одна зупинка → URL лишається на ?from= (без path-пари)
    expect(location()).toBe('/transport?from=st_a&d=16.09.26&h=09%3A12');

    await user.tripleClick(from);
    await user.keyboard('Вок');
    await user.click(await screen.findByRole('option', { name: 'Вокзал' }));
    await waitFor(() => expect(location()).toBe('/transport?from=st_b&d=16.09.26&h=09%3A12'), { timeout: 3000 });
    const nav = screen.getByRole('navigation', { name: 'Режим розкладу' });
    expect(within(nav).getByRole('link', { name: 'Зупинка (табло)' }).getAttribute('href')).toMatch(/^\/transport\/stop\/st_b\?/);
  });
});

describe('LocalTransportPage planner: date and time', () => {
  it('the date field is a native date input bound to d=DD.MM.YY (behind the «16.09.26 о 09:12» chip)', async () => {
    const user = userEvent.setup();
    await openPair();
    expect(screen.queryByLabelText('Дата')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '16.09.26 о 09:12' }));
    const date = screen.getByLabelText('Дата') as HTMLInputElement;
    expect(date.type).toBe('date');
    expect(date.value).toBe('2026-09-16');
    expect(screen.queryByText(/Формат: ДД\.ММ\.РР/)).not.toBeInTheDocument();
  });

  // Дата в URL навмисно далеко від сьогодні, щоб чіпи не були натиснуті від початку.
  const FAR_URL = '/transport/st_a/st_b?d=01.03.26&h=09%3A12';

  it('«Завтра» sets tomorrow and the URL follows', async () => {
    const user = userEvent.setup();
    renderPlanner(FAR_URL);
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    expect(screen.getByRole('button', { name: '01.03.26 о 09:12' })).toBeInTheDocument();
    const tomorrow = tomorrowDateUrl();
    const chip = screen.getByRole('button', { name: 'Завтра' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(location()).toBe(`/transport/st_a/st_b?d=${tomorrow}&h=09%3A12`), { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: 'Завтра о 09:12' }));
    expect((screen.getByLabelText('Дата') as HTMLInputElement).value).toBe(dateUrlToIso(tomorrow));
  });

  it('«Зараз» resets to today and the current time', async () => {
    const user = userEvent.setup();
    renderPlanner(FAR_URL);
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const chip = screen.getByRole('button', { name: 'Зараз' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(location()).toContain(`/transport/st_a/st_b?d=${todayDateUrl()}&h=`), { timeout: 3000 });
    await user.click(screen.getByRole('button', { name: /^Сьогодні о \d{2}:\d{2}$/ }));
    const time = screen.getByLabelText('Час') as HTMLInputElement;
    expect(time.value).toMatch(/^\d{2}:\d{2}$/);
  });

  it('the «date о time» chip toggles the native fields; «Зараз» / «Завтра» are always in the row', async () => {
    const user = userEvent.setup();
    renderPlanner(FAR_URL);
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const row = screen.getByRole('group', { name: 'Дата і час' });
    expect(within(row).getByRole('button', { name: 'Зараз' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Завтра' })).toBeInTheDocument();
    const toggle = within(row).getByRole('button', { name: '01.03.26 о 09:12' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Час')).not.toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Час')).toBeInTheDocument();
    await user.click(toggle);
    expect(screen.queryByLabelText('Час')).not.toBeInTheDocument();
    // Кнопки «Знайти» немає — видача жива
    expect(screen.queryByRole('button', { name: 'Знайти' })).toBeNull();
  });
});

describe('LocalTransportPage planner: result card', () => {
  it('shows departure → arrival · duration and the trip destination, without jargon', async () => {
    renderPlanner('/transport/st_a/st_b?d=01.03.26&h=08%3A00');
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const card = screen.getByRole('button', { name: /Маршрут №2 до Лікарня/ });
    expect(card).toHaveTextContent('08:30');
    expect(card).toHaveTextContent('08:30 → 08:34 · 4 хв'); // сегмент Базар → Вокзал = 240 с
    expect(card).toHaveTextContent('→ Лікарня');
    expect(card.textContent).not.toMatch(/лінія|перевірено/);
    expect(card).toHaveTextContent('відправлення'); // дата не сьогодні → без відліку
    expect(card.getAttribute('aria-label')).toContain('прибуття 08:34');
    expect(card.getAttribute('aria-label')).toContain('4 хвилин');
  });

  it('cards are sorted by waiting time and list the next departures («далі …»)', async () => {
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(sortedDataset)));
    renderPlanner('/transport/st_a/st_b?d=01.03.26&h=08%3A00');
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const cards = screen.getAllByRole('button', { name: /^Маршрут №/ });
    // №3 о 08:10 — раніше за №2 о 08:30, хоч номер більший
    expect(cards.map((c) => c.getAttribute('aria-label')?.slice(0, 10))).toEqual(['Маршрут №3', 'Маршрут №2']);
    expect(cards[1]).toHaveTextContent('далі 09:40 · 10:55');
    expect(cards[1].getAttribute('aria-label')).toContain('далі 09:40 · 10:55');
    expect(cards[0]).not.toHaveTextContent('далі');
  });

  it('after the last trip of the day the next departures are not prefixed with «завтра» twice', async () => {
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(sortedDataset)));
    renderPlanner('/transport/st_a/st_b?d=01.03.26&h=23%3A50');
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const card = screen.getByRole('button', { name: /^Маршрут №2/ });
    expect(card).toHaveTextContent('перший наступного дня');
    expect(card).toHaveTextContent('далі 09:40 · 10:55');
    expect(card).not.toHaveTextContent('завтра');
  });

  it('a next-day trip in the «далі» row is labelled «завтра» once', async () => {
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(sortedDataset)));
    renderPlanner('/transport/st_a/st_b?d=01.03.26&h=10%3A00');
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const card = screen.getByRole('button', { name: /^Маршрут №2/ });
    expect(card).toHaveTextContent('10:55');
    expect(card).toHaveTextContent('далі завтра 08:30 · 09:40');
  });

  it('after the last trip of the day the card says the first trip is next day', async () => {
    renderPlanner('/transport/st_a/st_b?d=01.03.26&h=23%3A50');
    await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
    const card = screen.getByRole('button', { name: /Маршрут №2/ });
    expect(card).toHaveTextContent('08:30');
    expect(card).toHaveTextContent('перший наступного дня');
  });

  it('for today the label is a countdown from the current Kyiv time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-16T05:18:00Z')); // 08:18 за Києвом
    try {
      renderPlanner('/transport/st_a/st_b?d=16.09.26&h=08%3A00');
      await screen.findByText(/Прямі маршрути: Базар → Вокзал/, {}, { timeout: 5000 });
      const card = screen.getByRole('button', { name: /Маршрут №2/ });
      expect(card).toHaveTextContent('через 12 хв');
      expect(card.getAttribute('aria-label')).toContain('через 12 хв');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('LocalTransportPage planner: heading, geolocation, empty state', () => {
  it('h1, document.title and robots reflect the pair; results heading is an h2', async () => {
    await openPair();
    expect(screen.getByRole('heading', { level: 1, name: 'Базар → Вокзал' })).toBeInTheDocument();
    // title/robots ставить пасивний ефект usePageSeo — він може відстати від DOM-заголовка на один тік
    await waitFor(() => {
      expect(document.title).toMatch(/^Базар → Вокзал — як доїхати у Малині/);
      expect(document.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
    });
    expect(screen.getByRole('heading', { level: 2, name: /Прямі маршрути: Базар → Вокзал/ })).toBeInTheDocument();
  });

  it('without a pair: h1 «Як доїхати», hub title, empty state; on a phone «Відкрити карту» opens the full-screen map', async () => {
    const user = userEvent.setup();
    // Телефон: matchMedia для (max-width: 767px) → overlay замість колонки карти
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
      renderPlanner('/transport');
      await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
      expect(screen.getByRole('heading', { level: 1, name: 'Як доїхати' })).toBeInTheDocument();
      await waitFor(() => expect(document.title).toMatch(/^Транспорт Малина/));
      const empty = screen.getByText(/Оберіть зупинки «Звідки» та «Куди»/).closest('.lt-empty') as HTMLElement;
      expect(document.querySelector('.lt-map-column')).toBeNull();
      expect(screen.queryByRole('dialog', { name: 'Карта' })).toBeNull();

      await user.click(within(empty).getByRole('button', { name: 'Відкрити карту' }));
      const dialog = screen.getByRole('dialog', { name: 'Карта' });
      expect(within(dialog).getByTestId('route-map')).toBeInTheDocument();
      expect(within(dialog).getByText('Звідки: — · Куди: —')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Готово' })).toHaveFocus();

      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: 'Карта' })).toBeNull();
      // Кнопка «Карта» внизу екрана відкриває ту саму карту
      await user.click(screen.getByRole('button', { name: 'Карта' }));
      expect(screen.getByRole('dialog', { name: 'Карта' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Готово' }));
      expect(screen.queryByRole('dialog', { name: 'Карта' })).toBeNull();
    } finally {
      window.matchMedia = desktopMatchMedia;
    }
  });

  it('quick start: a node chip sets «Куди», the next one sets «Звідки», then the results appear', async () => {
    const user = userEvent.setup();
    server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(quickDataset)));
    renderPlanner('/transport?d=16.09.26&h=09%3A12');
    await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
    expect(screen.getByText('Куди їдете?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Відкрити схему маршрутів' })).toHaveAttribute(
      'href',
      '/transport/scheme?d=16.09.26&h=09%3A12'
    );
    expect(screen.getByRole('button', { name: 'Поруч зі мною' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Залізничний вокзал' }));
    expect(screen.getByRole('combobox', { name: 'Куди' })).toHaveValue('Залізничний вокзал');
    expect(screen.getByText('Тепер оберіть «Звідки»')).toBeInTheDocument();
    // Обраний вузол зникає з чіпів; гео лишається, бо «Звідки» ще порожнє
    expect(screen.queryByRole('button', { name: 'Залізничний вокзал' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Поруч зі мною' })).toBeInTheDocument();
    await waitFor(() => expect(location()).toBe('/transport?to=st_0019&d=16.09.26&h=09%3A12'), { timeout: 3000 });

    const from = screen.getByRole('combobox', { name: 'Звідки' });
    await user.click(from);
    await user.keyboard('Ба');
    await user.click(await screen.findByRole('option', { name: 'Базар' }));
    await waitFor(() => expect(location()).toBe('/transport/st_a/st_0019?d=16.09.26&h=09%3A12'), { timeout: 3000 });
    expect(screen.getByText(/Прямі маршрути: Базар → Залізничний вокзал/)).toBeInTheDocument();
    expect(screen.queryByText('Куди їдете?')).toBeNull();
  });

  it('on a desktop the map is a column next to the results, not a dialog', async () => {
    renderPlanner('/transport');
    await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
    expect(document.querySelector('.lt-map-column')).not.toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Карта' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Карта' })).toBeNull();
  });

  it('the geo button in «Звідки» fills it with the nearest stop and moves focus to «Куди»', async () => {
    const user = userEvent.setup();
    const geolocation = {
      getCurrentPosition: vi.fn((ok: PositionCallback) =>
        ok({ coords: { latitude: 50.7701, longitude: 29.2401 } } as unknown as GeolocationPosition)
      ),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    try {
      renderPlanner('/transport');
      const from = await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
      await user.click(screen.getByRole('button', { name: 'Знайти найближчі зупинки за геолокацією' }));
      await user.click(await screen.findByRole('button', { name: /^Базар — \d+ м$/ }));
      expect(from).toHaveValue('Базар');
      await waitFor(() => expect(screen.getByRole('combobox', { name: 'Куди' })).toHaveFocus());
    } finally {
      Reflect.deleteProperty(navigator, 'geolocation');
    }
  });

  it('a geolocation error is announced in the live region', async () => {
    const user = userEvent.setup();
    const geolocation = {
      getCurrentPosition: vi.fn((_ok: PositionCallback, err?: PositionErrorCallback) =>
        err?.({ code: 1, message: 'denied' } as GeolocationPositionError)
      ),
    };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    try {
      renderPlanner('/transport');
      await screen.findByRole('combobox', { name: 'Звідки' }, { timeout: 5000 });
      await user.click(screen.getByRole('button', { name: 'Знайти найближчі зупинки за геолокацією' }));
      const live = screen.getAllByRole('status').find((el) => el.classList.contains('lt-geo-error'));
      expect(live).toHaveTextContent('Дозвіл на геолокацію відхилено');
    } finally {
      Reflect.deleteProperty(navigator, 'geolocation');
    }
  });
});

describe('LocalTransportPage planner: analytics events', () => {
  it('search, swap, chip and card click reach gtag with ids only', async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    try {
      await openPair();
      await waitFor(() =>
        expect(gtag).toHaveBeenCalledWith('event', 'transport_search', { from: 'st_a', to: 'st_b', direct_routes: 1 })
      );
      expect(gtag).not.toHaveBeenCalledWith('event', 'transport_no_route', expect.anything());

      await user.click(screen.getByRole('button', { name: 'Поміняти місцями' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_swap', { source: 'form' });
      await waitFor(() =>
        expect(gtag).toHaveBeenCalledWith('event', 'transport_search', { from: 'st_b', to: 'st_a', direct_routes: 1 })
      );

      await user.click(screen.getByRole('button', { name: 'Завтра' }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_date_chip', { chip: 'tomorrow', page: 'planner' });

      await user.click(screen.getByRole('button', { name: /Маршрут №2/ }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_route_card_click', { route_id: '2' });

      // Жодного параметра з назвами зупинок чи чимось особистим — лише id.
      for (const call of gtag.mock.calls) {
        expect(JSON.stringify(call[2] ?? {})).not.toMatch(/Базар|Вокзал/);
      }
    } finally {
      Reflect.deleteProperty(window, 'gtag');
    }
  });

  it('a pair without a direct route also sends transport_no_route', async () => {
    const gtag = vi.fn();
    window.gtag = gtag;
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
        })
      )
    );
    try {
      renderPlanner('/transport/st_a/st_d?d=16.09.26&h=09%3A12');
      await screen.findByText(/немає прямого маршруту/, {}, { timeout: 5000 });
      await waitFor(() =>
        expect(gtag).toHaveBeenCalledWith('event', 'transport_no_route', { from: 'st_a', to: 'st_d', nearby: 0 })
      );
      expect(gtag).toHaveBeenCalledWith('event', 'transport_search', { from: 'st_a', to: 'st_d', direct_routes: 0 });
    } finally {
      Reflect.deleteProperty(window, 'gtag');
    }
  });
});

describe('LocalTransportPage planner: quick-start analytics', () => {
  it('a quick-start node chip reports the node id and the slot it fills', async () => {
    const user = userEvent.setup();
    const gtag = vi.fn();
    window.gtag = gtag;
    const node = SCHEME_NODES.find((n) => n.stopIds.includes('st_0019'));
    if (!node) throw new Error('a scheme node for st_0019 is expected');
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, () =>
        HttpResponse.json({
          ...dataset,
          stops: [...dataset.stops, { id: 'st_0019', name: 'Залізничний вокзал', lat: 50.774, lng: 29.295 }],
          // Чіп зʼявляється лише для зупинки, що є в датасеті маршрутів
          routeStops: [...dataset.routeStops, { routeId: '2', stopId: 'st_0019', orderThere: 4, orderBack: 0, mapOnly: false }],
        })
      )
    );
    try {
      renderPlanner('/transport?d=16.09.26&h=09%3A12');
      await user.click(await screen.findByRole('button', { name: node.name }, { timeout: 8000 }));
      expect(gtag).toHaveBeenCalledWith('event', 'transport_quick_node', { node_id: node.id, kind: node.kind, slot: 'to' });
    } finally {
      Reflect.deleteProperty(window, 'gtag');
    }
  }, 15_000);
});
