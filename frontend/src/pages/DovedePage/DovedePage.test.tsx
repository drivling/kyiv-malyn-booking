import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { apiClient } from '@/api/client';
import type { PoputkySearchResponse, Schedule } from '@/types';
import DovedePage from './DovedePage';
import { DOVEDE_TOKEN_KEY } from './access';
import { markIntroSeen } from './intro/introState';
import type { DovedeUnderstanding, TripIntent } from './nlu/types';

const train: Schedule = {
  id: 2,
  route: 'Kyiv-Malyn',
  departureTime: '14:51',
  arrivalTime: '17:11',
  durationMinutes: 140,
  vehicleType: 'elektrichka',
  boardingPlace: 'Київ-Пас. (Приміський)',
  alightingPlace: 'Малин',
  tripNumber: '6613',
  priceUah: 60,
  ticketPurchaseUrl: 'https://lnk.ua/x',
  activeWeekdays: [1, 2, 3, 4, 5, 6, 7],
  maxSeats: 20,
  supportPhone: null,
  createdAt: '',
  updatedAt: '',
};

/** Показує поточну адресу MemoryRouter (window.location у тестах не змінюється) */
function LocationProbe() {
  return <output data-testid="search">{useLocation().search}</output>;
}

const searchResult = (schedules: Schedule[]): PoputkySearchResponse => ({ from: null, to: null, date: '2026-11-13', listings: [], schedules, availability: {} });

const understood = (intent: Partial<TripIntent>): DovedeUnderstanding => ({
  intent: { intent: 'trip', from: null, to: null, when: { day: 'today', kind: 'depart' }, modes: [], unknown: [], confidence: 'high', ...intent },
  agree: false,
  model: 'claude-opus-5-5',
  latencyMs: 900,
});

describe('«Доведе» — Коростень (етап 2: Claude з промптом Коростеня)', () => {
  // маленький датасет Коростеня: №2 Пашини → Міськлікарня о 08:00 щодня, 3 хв на перегін
  const korostenDataset = {
    stops: [
      { id: 'st_1087', name: 'Пашини', lat: 50.95, lng: 28.6 },
      { id: 'st_1079', name: 'Міськлікарня', lat: 50.96, lng: 28.61 },
    ],
    routes: [{ id: '2', fromName: 'Пашини', toName: 'Міськлікарня', shortName: '' }],
    routeStops: [
      { routeId: '2', stopId: 'st_1087', orderThere: 1, orderBack: 2 },
      { routeId: '2', stopId: 'st_1079', orderThere: 2, orderBack: 1 },
    ],
    trips: [{ id: 'k2-1', routeId: '2', serviceId: 'everyday', headsign: 'Міськлікарня', directionId: '1', departureTime: '16:00' }],
    segments: [{ routeId: '2', fromStopId: 'st_1087', toStopId: 'st_1079', seconds: 180 }],
    meta: {},
    revision: 'k-1',
  };

  beforeEach(() => {
    markIntroSeen();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:20:00Z'));
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: true });
    server.use(
      http.get(`${TEST_API_URL}/transport/dataset`, ({ request }) =>
        new URL(request.url).searchParams.get('city') === 'Korosten' ? HttpResponse.json(korostenDataset) : undefined,
      ),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('місце словами: зупинка + адреса → сервер дає дорогу містом (зупинка своїм id), картка без «не знаю, де це»', async () => {
    vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    const cityRoute = vi.spyOn(apiClient, 'dovedeCityRoute').mockResolvedValue({
      source: 'google',
      fromLabel: 'зупинка «Пашини»',
      toLabel: 'Грушевського 22',
      minutes: 10,
      fetchedAt: '2026-11-13T08:00:00.000Z',
      steps: [
        { kind: 'transit', minutes: 2, mode: 'SHARE_TAXI', line: '7', fromStop: 'Пашини', toStop: 'Міський Центральний ринок', stops: 1 },
        { kind: 'walk', minutes: 7, meters: 530 },
      ],
    });
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede?c=Korosten'] });
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'з Пашин на Грушевського 22{Enter}');
    await waitFor(() => expect(cityRoute).toHaveBeenCalled());
    expect(cityRoute.mock.calls[0][0]).toMatchObject({ city: 'Korosten', from: 'st_1087', to: 'Грушевського 22' });
    expect(await screen.findByText(/Міський Центральний ринок/)).toBeInTheDocument();
    expect(screen.queryByText(/не знаю/i)).toBeNull();
  });

  it('словник упевнений → відповідь одразу, Claude перевіряє у фоні з містом Korosten', async () => {
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede?c=Korosten'] });
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'з Пашин до міськлікарні{Enter}');
    expect(await screen.findByText(/Автобус №2 о 16:00/)).toBeInTheDocument();
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(ask.mock.calls[0][3]).toBe('Korosten');
    expect((ask.mock.calls[0][1] as TripIntent).from?.id).toBe('st_1087');
  });

  it('словник не впевнений → чекаємо Claude з промптом Коростеня; його місця Коростеня йдуть у відповідь', async () => {
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(
      understood({ from: { id: 'st_1087', text: 'від мікрорайону' }, to: { id: 'st_1079', text: 'туди де лікують' } }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede?c=Korosten'] });
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'мені від мікрорайону туди де лікують у коростені{Enter}');
    expect(await screen.findByText(/Автобус №2 о 16:00/)).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][3]).toBe('Korosten');
    expect(screen.getByLabelText('Як зрозуміло питання')).toHaveTextContent('Пашини');
  });
});

describe('«Доведе» — сторінка', () => {
  beforeEach(() => {
    // ролик-вступ уже бачили (його — окремий describe нижче)
    markIntroSeen();
    // лише Date: пʼятниця 13.11.2026, 14:20 за Києвом; таймери справжні (waitFor)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:20:00Z'));
    // Claude за замовчуванням недоступний — сторінка має працювати на місцевому розборі
    vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    // доступ уже є (пароль запрошених чи адмін) — тут перевіряємо сам пошук
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('питання → розклад коридору → історія електрички без пересадок', async () => {
    const search = vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue({
      from: null,
      to: null,
      date: '2026-11-13',
      listings: [],
      schedules: [train],
      availability: {},
    } satisfies PoputkySearchResponse);
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва (Святошин) до Малина на вокзал{Enter}');

    expect(await screen.findByText(/Електричка 6613 о ≈15:16 з платформи «Святошин»/)).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({ from: 'Kyiv', to: 'Malyn', date: '2026-11-13' });
    expect(screen.getByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Квиток ↗' })).toHaveAttribute('href', 'https://lnk.ua/x');
    expect(screen.getByText('Розумію:')).toBeInTheDocument();
  });

  it('незнайоме місце — чесна відповідь, без запиту розкладу', async () => {
    const search = vi.spyOn(apiClient, 'searchPoputky');
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'з Ковалівки до Малина{Enter}');
    expect(await screen.findByText('Не знаю, де це: «Ковалівки»')).toBeInTheDocument();
    await waitFor(() => expect(search).not.toHaveBeenCalled());
  });
  it('словник не впевнений → чекаємо Claude і відповідаємо за його розбором', async () => {
    const search = vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(
      understood({ from: { id: 'kyiv.sviatoshyn', text: 'святошина' }, to: { id: 'malyn.vokzal', text: 'залізки' }, modes: ['elektrichka'] }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    const q = 'хочу потягом зі святошина до залізки';
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), `${q}{Enter}`);

    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(ask.mock.calls[0][0]).toBe(q);
    expect(search).toHaveBeenCalledWith({ from: 'Kyiv', to: 'Malyn', date: '2026-11-13' });
    // рядок «Розумію…» показує розбір Claude, а не словника
    expect(screen.getByLabelText('Як зрозуміло питання')).toHaveTextContent('Київ · Святошин');
  });

  it('словник упевнений → відповідь одразу; Claude зрозумів інакше → тиха пропозиція', async () => {
    vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(
      understood({ from: { id: 'city.Kyiv', text: 'Києва' }, to: { id: 'malyn.avtostantsiya', text: 'станцію' }, modes: ['elektrichka'] }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва до Малина на вокзал{Enter}');

    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(await screen.findByText(/Можливо, ви мали на увазі: Київ → Малин · автостанція/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Показати' })).toBeInTheDocument();
  });

  it('Claude згоден зі словником — пропозиції немає', async () => {
    vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(
      understood({ from: { id: 'city.Kyiv', text: 'Києва' }, to: { id: 'malyn.vokzal', text: 'вокзал' }, modes: ['elektrichka'] }),
    );
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва до Малина на вокзал{Enter}');

    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(screen.queryByText(/Можливо, ви мали на увазі/)).not.toBeInTheDocument();
  });

  it('Claude недоступний → неповне питання все одно отримує відповідь зі словника', async () => {
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'мені на вокзал{Enter}');

    expect(await screen.findByText('Звідки вирушаєте?')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('під час набору: рядок «Розумію…» і підказка місця з потрібним відмінком', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    const field = await screen.findByLabelText('Куди вам потрібно доїхати?');

    await user.type(field, 'з Києва до цар');
    expect(screen.getByLabelText('Як зрозуміло питання')).toHaveTextContent('Київ');
    await user.click(screen.getByRole('option', { name: 'Малин · Царське село' }));

    expect(field).toHaveValue('з Києва до Царського села ');
    expect(screen.getByLabelText('Як зрозуміло питання')).toHaveTextContent('Малин · Царське село');
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('слот «Розумію…» можна виправити: вибір у панелі дає нову відповідь без Claude', async () => {
    const search = vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'мені на вокзал{Enter}');
    expect(await screen.findByText('Звідки вирушаєте?')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /Змінити, звідки/ }));
    const dialog = screen.getByRole('dialog', { name: 'Звідки вирушаєте?' });
    await user.click(within(dialog).getByRole('button', { name: 'Святошин' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(search).toHaveBeenCalledWith({ from: 'Kyiv', to: 'Malyn', date: '2026-11-13' });
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('адреса відповіді: id + слова питання для показу; посилання відкриває ту саму відповідь і ту саму фразу', async () => {
    vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    const user = userEvent.setup();
    const first = renderWithProviders(
      <>
        <DovedePage />
        <LocationProbe />
      </>,
      { initialEntries: ['/dovede'] },
    );
    await user.type(await screen.findByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва (Святошин) до Малина на вокзал{Enter}');
    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    const question = 'електричкою з Києва (Святошин) до Малина на вокзал';
    const ids = '?f=kyiv.sviatoshyn&t=malyn.vokzal&d=2026-11-13&m=elektrichka';
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(`${ids}&q=${new URLSearchParams({ q: question }).toString().slice(2)}`));
    first.unmount();

    // інша людина відкрила посилання: та сама відповідь, у полі — ті самі слова; Claude не питаємо
    sessionStorage.clear();
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand');
    ask.mockClear();
    const shared = renderWithProviders(<DovedePage />, { initialEntries: [`/dovede${ids}&q=${encodeURIComponent(question)}`] });
    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(screen.getByLabelText('Куди вам потрібно доїхати?')).toHaveValue(question);
    expect(screen.getByLabelText('Як зрозуміло питання')).toHaveTextContent('Київ · Святошин');
    expect(ask).not.toHaveBeenCalled();
    shared.unmount();

    // давнє посилання лише з id і чужа вкладка — поле порожнє, відповідь та сама
    sessionStorage.clear();
    renderWithProviders(<DovedePage />, { initialEntries: [`/dovede${ids}`] });
    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(screen.getByLabelText('Куди вам потрібно доїхати?')).toHaveValue('');
  });
  it('після «Знайти» підказок немає: інакше вони зникали б у мить кліку по відповіді й зсували сторінку', async () => {
    vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    const field = await screen.findByLabelText('Куди вам потрібно доїхати?');

    // курсор стоїть після «вокзал» — слова з двома підказками
    await user.type(field, 'електричкою з Києва до Малина на вокзал');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();

    // нова літера повертає підказки
    await user.type(field, 'у');
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });
  it('після відповіді «Розумію…» згортається в рядок-підсумок; «змінити» розгортає, нове питання — знову згортає', async () => {
    vi.spyOn(apiClient, 'searchPoputky').mockResolvedValue(searchResult([train]));
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    const field = await screen.findByLabelText('Куди вам потрібно доїхати?');

    await user.type(field, 'електричкою з Києва до Малина на вокзал');
    // під час набору підсумку немає — слоти відкриті
    expect(screen.queryByRole('button', { name: /змінити/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');

    const summary = await screen.findByRole('button', { name: /Київ → Малин · вокзал · сьогодні, пʼятниця · електричкою.*змінити/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    await user.click(summary);
    expect(screen.getByRole('button', { name: 'згорнути' })).toHaveAttribute('aria-expanded', 'true');

    // людина дописує питання — підсумок зникає, слоти знову «живі»
    await user.type(field, ' завтра');
    expect(screen.queryByRole('button', { name: /змінити|згорнути/ })).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: /завтра, субота.*змінити/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('«Доведе» — доступ за паролем запрошених', () => {
  beforeEach(() => {
    markIntroSeen();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const lockedField = () => screen.findByLabelText('Пароль');

  it('без доступу рядок питання просить пароль, кнопка «Hasło»; пошуку й дисклеймера немає', async () => {
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: false });
    const search = vi.spyOn(apiClient, 'searchPoputky');
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    const field = await lockedField();
    expect(field).toHaveAttribute('type', 'password');
    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Hasło' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Доведе.' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Куди вам потрібно доїхати?')).not.toBeInTheDocument();
    expect(screen.queryByText(/Таємна сторінка|бачите лише ви/)).not.toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
  });

  it('невірний пароль — повідомлення, поле порожнє; вірний — токен у браузері й пошук', async () => {
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: false });
    const login = vi
      .spyOn(apiClient, 'dovedeLogin')
      .mockRejectedValueOnce(Object.assign(new Error('Невірний пароль'), { status: 401 }))
      .mockResolvedValueOnce({ token: 'guest-token' });
    const setToken = vi.spyOn(apiClient, 'setDovedeToken');
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(await lockedField(), 'не той{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Невірний пароль');
    expect(screen.getByLabelText('Пароль')).toHaveValue('');
    expect(login).toHaveBeenLastCalledWith('не той');

    await user.type(screen.getByLabelText('Пароль'), 'вірний');
    await user.click(screen.getByRole('button', { name: 'Hasło' }));
    expect(await screen.findByLabelText('Куди вам потрібно доїхати?')).toHaveFocus();
    expect(login).toHaveBeenLastCalledWith('вірний');
    expect(localStorage.getItem(DOVEDE_TOKEN_KEY)).toBe('guest-token');
    expect(setToken).toHaveBeenLastCalledWith('guest-token');
  });

  it('токен із браузера сервер прийняв — пароль не питає', async () => {
    localStorage.setItem(DOVEDE_TOKEN_KEY, 'guest-token');
    const setToken = vi.spyOn(apiClient, 'setDovedeToken');
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: true });
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    expect(await screen.findByLabelText('Куди вам потрібно доїхати?')).toBeInTheDocument();
    expect(setToken).toHaveBeenCalledWith('guest-token');
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
  });

  it('пароль змінили — старий токен стирається, поле знову просить пароль', async () => {
    localStorage.setItem(DOVEDE_TOKEN_KEY, 'old-token');
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: false });
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    expect(await lockedField()).toBeInTheDocument();
    expect(localStorage.getItem(DOVEDE_TOKEN_KEY)).toBeNull();
  });

  it('DOVEDE_PUBLIC=ON — сторінка відкрита без пароля', async () => {
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: true, allowed: true });
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    expect(await screen.findByLabelText('Куди вам потрібно доїхати?')).toBeInTheDocument();
  });

  it('сервер не відповідає — поле пароля з поясненням', async () => {
    vi.spyOn(apiClient, 'dovedeAccess').mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    expect(await lockedField()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер не відповідає');
  });
});

describe('«Доведе» — ролик-вступ перед сторінкою', () => {
  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // без анімацій: талон відкриває сторінку затуханням, без кола
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('хто прийшов уперше — спершу ролик, ще до пароля; після талона — поле пароля у фокусі', async () => {
    const access = vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: false });
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    expect(screen.getByRole('dialog', { name: 'Ролик «Доведе.»' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Пароль')).not.toBeInTheDocument();
    // доступ перевіряється, поки йде ролик — після нього чекати не доведеться
    await waitFor(() => expect(access).toHaveBeenCalled());

    fireEvent(document.querySelector('video') as HTMLVideoElement, new Event('ended'));
    // сторінка вже під талоном, але недоступна й без фокусу (клавіатура телефона не вискочить)
    const field = await screen.findByLabelText('Пароль');
    expect(field.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(field).not.toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Прокомпостувати квиток і увійти' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(field.closest('[aria-hidden="true"]')).toBeNull();
    expect(field).toHaveFocus();
  });

  it('облік реклами: ролик (показ, досмотр), талон і вхід на сторінку з доступом — раз за сесію, з токеном гостя', async () => {
    const events: { body: { placement: string; event: string; viewId: string; video?: string }; token: string | null }[] = [];
    server.use(
      http.post(`${TEST_API_URL}/ads/events`, async ({ request }) => {
        events.push({ body: (await request.json()) as (typeof events)[number]['body'], token: request.headers.get('x-dovede-token') });
        return HttpResponse.json({ ok: true, counted: true }, { status: 201 });
      }),
    );
    localStorage.setItem(DOVEDE_TOKEN_KEY, 'guest-token');
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: true });
    vi.spyOn(apiClient, 'dovedeSynonyms').mockResolvedValue([]);
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    fireEvent(document.querySelector('video') as HTMLVideoElement, new Event('ended'));
    await userEvent.click(await screen.findByRole('button', { name: 'Прокомпостувати квиток і увійти' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(events.map((e) => e.body.event)).toEqual(['shown', 'completed', 'punched', 'page']));
    expect(events.every((e) => e.body.placement === 'dovede')).toBe(true);
    expect(events[0].body.video).toMatch(/^intro-[0-9a-f]{8}$/);
    expect(events[3].token).toBe('guest-token');
    expect(events[2].body.viewId, 'талон — той самий перегляд, що ролик').toBe(events[0].body.viewId);
  });

  it('хто вже бачив ролик — одразу сторінка, навіть з посиланням на відповідь', async () => {
    markIntroSeen();
    vi.spyOn(apiClient, 'dovedeAccess').mockResolvedValue({ open: false, allowed: false });
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede?q=%D0%B7%20%D0%9A%D0%B8%D1%94%D0%B2%D0%B0'] });

    expect(await screen.findByLabelText('Пароль')).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('video')).toBeNull();
  });
});
