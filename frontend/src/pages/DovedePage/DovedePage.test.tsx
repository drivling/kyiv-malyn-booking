import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { renderWithProviders, screen, waitFor, within } from '@/test/utils';
import { apiClient } from '@/api/client';
import type { PoputkySearchResponse, Schedule } from '@/types';
import DovedePage from './DovedePage';
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

describe('«Доведе» — сторінка', () => {
  beforeEach(() => {
    // лише Date: пʼятниця 13.11.2026, 14:20 за Києвом; таймери справжні (waitFor)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:20:00Z'));
    // Claude за замовчуванням недоступний — сторінка має працювати на місцевому розборі
    vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
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

    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва (Святошин) до Малина на вокзал{Enter}');

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
    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'з Ковалівки до Малина{Enter}');
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
    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), `${q}{Enter}`);

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

    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва до Малина на вокзал{Enter}');

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

    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва до Малина на вокзал{Enter}');

    expect(await screen.findByText('Електричка 6613 · Київ — Малин')).toBeInTheDocument();
    await waitFor(() => expect(ask).toHaveBeenCalled());
    expect(screen.queryByText(/Можливо, ви мали на увазі/)).not.toBeInTheDocument();
  });

  it('Claude недоступний → неповне питання все одно отримує відповідь зі словника', async () => {
    const ask = vi.spyOn(apiClient, 'dovedeUnderstand').mockResolvedValue(null);
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });

    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'мені на вокзал{Enter}');

    expect(await screen.findByText('Звідки вирушаєте?')).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(1);
  });
  it('під час набору: рядок «Розумію…» і підказка місця з потрібним відмінком', async () => {
    const user = userEvent.setup();
    renderWithProviders(<DovedePage />, { initialEntries: ['/dovede'] });
    const field = screen.getByLabelText('Куди вам потрібно доїхати?');

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

    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'мені на вокзал{Enter}');
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
    await user.type(screen.getByLabelText('Куди вам потрібно доїхати?'), 'електричкою з Києва (Святошин) до Малина на вокзал{Enter}');
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
    const field = screen.getByLabelText('Куди вам потрібно доїхати?');

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
    const field = screen.getByLabelText('Куди вам потрібно доїхати?');

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
