/**
 * Розділ «Місто» в адмінці (Docs/dovede-admin-roadmap.md, крок 10): рядок стану, місто в адресі (`?misto=`), плитки
 * міста, «Що питають» з фільтром «Без відповіді», «Місця» сторінками з дорогами місця й архівом одного місця,
 * «Небезпечна зона».
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeCityDemandRow, DovedeCityPlace, DovedeCityStats } from '@/types';
import { DovedeCityPanel } from './DovedeCityPanel';
import { PLACES_PAGE } from './DovedeCityPlaces';

const demandRow = (over: Partial<DovedeCityDemandRow>): DovedeCityDemandRow => ({
  city: 'Kyiv',
  fromKey: 'kyiv.akadem',
  toKey: 'охматдит',
  from: 'метро «Академмістечко»',
  to: 'Охматдит',
  asked: 3,
  answered: true,
  lastAskedAt: '2026-11-17T08:00:00.000Z',
  ...over,
});

function mock(over: Partial<DovedeCityStats> = {}, extraPlaces: DovedeCityPlace[] = []) {
  const state: DovedeCityStats = {
    enabled: true,
    store: true,
    hasKey: true,
    callsToday: 12,
    dailyCap: 150,
    freshDays: 30,
    freshDaysDefault: 30,
    staleRoutes: 3,
    refresh: true,
    googleError: { at: '2026-11-17T22:12:00.000Z', status: 403, message: 'Requests to this API are blocked.' },
    archivedRoutes: 0,
    routes: [
      { city: 'Kyiv', source: 'google', count: 4 },
      { city: 'Zhytomyr', source: 'google', count: 2 },
      { city: 'Zhytomyr', source: 'own', count: 7 },
    ],
    lines: [{ city: 'Kyiv', count: 9 }],
    stops: [{ city: 'Kyiv', count: 31 }],
    demand: [],
    unanswered: [{ city: 'Kyiv', fromKey: 'kyiv.sviatoshyn', toKey: 'ентузіастів 7', from: 'метро «Святошин»', to: 'вулиця Ентузіастів 7', asked: 1 }],
    ...over,
  };
  const calls: string[] = [];
  const places: DovedeCityPlace[] = [
    { city: 'Kyiv', key: 'палац спорту', label: 'Палац спорту', routes: 5, archivedRoutes: 0, minMinutes: 31, maxMinutes: 48, archivedAt: null },
    { city: 'Kyiv', key: 'торговельно-економічний університет', label: 'Торговельно-економічний університет', routes: 15, archivedRoutes: 0, minMinutes: 5, maxMinutes: 8, archivedAt: null },
    { city: 'Zhytomyr', key: 'житній ринок', label: 'Житній ринок', routes: 0, archivedRoutes: 2, minMinutes: 12, maxMinutes: 14, archivedAt: '2026-11-18T08:00:00.000Z' },
    ...extraPlaces,
  ];
  const demand: DovedeCityDemandRow[] = [
    demandRow({}),
    demandRow({ fromKey: 'kyiv.sviatoshyn', toKey: 'ентузіастів 7', from: 'метро «Святошин»', to: 'вулиця Ентузіастів 7', asked: 1, answered: false }),
    demandRow({ city: 'Zhytomyr', fromKey: 'zhytomyr.avtovokzal', toKey: 'польова 12', from: 'автовокзал', to: 'Польова 12' }),
  ];
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/city`, () => HttpResponse.json(state)),
    http.get(`${TEST_API_URL}/admin/dovede/city/places`, () => HttpResponse.json({ places })),
    http.get(`${TEST_API_URL}/admin/dovede/city/demand`, ({ request }) => {
      const u = new URL(request.url);
      calls.push(`demand:${u.searchParams.get('city')}:${u.searchParams.get('only') ?? ''}`);
      const only = u.searchParams.get('only') === 'unanswered';
      return HttpResponse.json({ demand: demand.filter((d) => d.city === u.searchParams.get('city') && (!only || !d.answered)) });
    }),
    http.get(`${TEST_API_URL}/admin/dovede/city/place/routes`, ({ request }) => {
      const u = new URL(request.url);
      calls.push(`routes:${u.searchParams.get('city')}:${u.searchParams.get('key')}`);
      return HttpResponse.json({
        routes: [
          { from: 'метро «Академмістечко»', to: 'Палац спорту', dir: 'to', dayType: 'weekday', hour: 9, minutes: 31, source: 'google', hits: 4, fetchedAt: '2026-11-10T08:00:00.000Z', archived: false, lines: ['SUBWAY M1'] },
          { from: 'Палац спорту', to: 'метро «Академмістечко»', dir: 'from', dayType: 'saturday', hour: 17, minutes: 48, source: 'google', hits: 0, fetchedAt: '2026-11-11T08:00:00.000Z', archived: true, lines: [] },
        ],
      });
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/place/archive`, async ({ request }) => {
      const body = (await request.json()) as { city: string; key: string; action: 'archive' | 'restore' };
      calls.push(`place:${body.action}:${body.city}:${body.key}`);
      const p = places.find((x) => x.city === body.city && x.key === body.key)!;
      const moved = body.action === 'archive' ? p.routes : p.archivedRoutes;
      if (body.action === 'archive') Object.assign(p, { archivedRoutes: p.archivedRoutes + p.routes, routes: 0, archivedAt: '2026-11-18T09:00:00.000Z' });
      else Object.assign(p, { routes: p.routes + p.archivedRoutes, archivedRoutes: 0, archivedAt: null });
      return HttpResponse.json({ action: body.action, city: body.city, key: body.key, routes: moved });
    }),
    http.get(`${TEST_API_URL}/admin/dovede/city/lines`, () => {
      calls.push('lines');
      return HttpResponse.json({
        roads: 4,
        lines: [
          { mode: 'BUS', line: '820', kind: 'none', rides: 12, roads: 3 },
          { mode: 'TROLLEYBUS', line: '39', kind: 'kpt', rides: 5, roads: 2, name: 'Оболонь - Центр' },
          { mode: 'SHARE_TAXI', line: '242', kind: 'taxi', rides: 2, roads: 1, name: 'вул. А – вул. Б' },
        ],
        byKind: { kpt: { lines: 1, rides: 5 }, taxi: { lines: 1, rides: 2 }, metro: { lines: 0, rides: 0 }, ring: { lines: 0, rides: 0 }, rail: { lines: 0, rides: 0 }, funicular: { lines: 0, rides: 0 }, none: { lines: 1, rides: 12 } },
      });
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/demand/reset`, () => {
      calls.push('reset');
      return HttpResponse.json({ reset: 3 });
    }),
  );
  return { calls };
}

const Where = () => {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
};

async function open(url = '/admin/dovede/city') {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[url]}>
      <DovedeCityPanel />
      <Where />
    </MemoryRouter>,
  );
  await screen.findByRole('radiogroup', { name: 'Місто' });
  return { user };
}

const rows = () => [...document.querySelectorAll('.dovede-city-places > li')].map((li) => li.querySelector('.dovede-city-place-row')?.textContent ?? '');

afterEach(() => vi.restoreAllMocks());

describe('DovedeCityPanel', () => {
  it('рядок стану й посилання: строк свіжості й ліміт Google показано, змінюють їх у «Налаштування», навчання — у «Навчання»', async () => {
    mock();
    await open();
    expect(screen.getByText(/застаріло доріг: 3 — сервер оновлює їх сам/)).toBeInTheDocument();
    expect(screen.getByText(/Google відмовив \(HTTP 403\) 18 листопада о 00:12 — немає доступу: обмеження ключа, вимкнений Routes API або білінг; Google: «Requests to this API are blocked.»/)).toBeInTheDocument();
    expect(screen.getByText(/Відповідь свіжа 30 днів · ліміт Google 150 на день/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '«Налаштування»' })).toHaveAttribute('href', '/admin/dovede/settings');
    expect(screen.getByRole('link', { name: '«Навчання»' })).toHaveAttribute('href', '/admin/dovede/learning');
    expect(screen.queryByRole('button', { name: 'Оновити зараз' })).toBeNull();
  });

  it('рядок стану: з чого склались запити до Google, скільки людям відмовили, пауза після відмови', async () => {
    mock({ callsToday: 40, dailyCap: 150, today: { people: 25, learn: 15, refused: 3 }, blocked: { until: '2026-11-18T10:20:00.000Z', reason: 'quota' } });
    await open();
    const status = screen.getByText(/запитів до Google сьогодні: 40 з 150 \(люди 25, навчання 15\)/);
    expect(status.textContent).toContain('людям відмовили через ліміт: 3');
    expect(status.textContent).toMatch(/Google не питаємо до 18 листопада о 12:20 — вичерпано квоту/);
  });

  it('місто в адресі: типово Київ, «Житомир» пише ?misto=Zhytomyr; плитки, попит і місця — того міста', async () => {
    const { calls } = mock();
    const { user } = await open();
    const tiles = screen.getByRole('group', { name: 'Що знаємо: Київ' });
    expect(within(tiles).getByText('Дорог у базі').parentElement).toHaveTextContent('4');
    expect(within(tiles).getByText('Ліній').parentElement).toHaveTextContent('9');
    expect(within(tiles).getByText('Пар без відповіді').parentElement).toHaveTextContent('1');
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(await screen.findByText(/Охматдит/)).toBeInTheDocument();

    await user.click(within(screen.getByRole('radiogroup', { name: 'Місто' })).getByRole('radio', { name: 'Житомир' }));
    expect(screen.getByTestId('where').textContent).toBe('/admin/dovede/city?misto=Zhytomyr');
    const zt = screen.getByRole('group', { name: 'Що знаємо: Житомир' });
    expect(within(zt).getByText('Дорог у базі').parentElement).toHaveTextContent(/9\s*2 з Google, 7 свої/);
    expect(await screen.findByText(/Польова 12/)).toBeInTheDocument();
    await waitFor(() => expect(rows()).toEqual([expect.stringContaining('Житній ринок')]));
    expect(calls).toContain('demand:Zhytomyr:');
  });

  it('Київ: «Лінії» — частка своїх даних, типово лише чого немає в наших даних; «Усі» показує й наші; у Житомира блоку нема', async () => {
    const { calls } = mock();
    const { user } = await open();
    const block = await screen.findByRole('region', { name: 'Лінії: що є в наших даних' });
    expect(await within(block).findByText('37 %')).toBeInTheDocument();
    expect(within(block).getByText('820')).toBeInTheDocument();
    expect(within(block).queryByText('39')).toBeNull();
    await user.click(within(block).getByRole('button', { name: 'Усі' }));
    expect(within(block).getByText('39')).toBeInTheDocument();
    expect(within(block).getByText(/Оболонь - Центр/)).toBeInTheDocument();
    expect(calls).toContain('lines');
    await user.click(screen.getByRole('radio', { name: 'Житомир' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Лінії: що є в наших даних' })).toBeNull());
  });

  it('«Що питають»: «Без відповіді» — усі такі пари міста', async () => {
    const { calls } = mock();
    const { user } = await open();
    expect(await screen.findByText(/вулиця Ентузіастів 7/)).toHaveTextContent('відповіді немає');
    await user.click(screen.getByRole('button', { name: 'Без відповіді' }));
    await waitFor(() => expect(calls).toContain('demand:Kyiv:unanswered'));
    await waitFor(() => expect(screen.queryByText(/Охматдит/)).toBeNull());
    expect(screen.getByText(/вулиця Ентузіастів 7/)).toBeInTheDocument();
    expect(screen.getByText(/«Питання людей без відповіді»/)).toBeInTheDocument();
  });

  it('«Небезпечна зона» згорнута; скидає лічильник лише після підтвердження', async () => {
    const { calls } = mock();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await open();
    const zone = screen.getByText('Небезпечна зона').closest('details')!;
    expect(zone).not.toHaveAttribute('open');
    await user.click(screen.getByText('Небезпечна зона'));
    const reset = within(zone).getByRole('button', { name: 'Скинути лічильник попиту' });
    await user.click(reset);
    expect(calls).not.toContain('reset');
    await user.click(reset);
    await screen.findByText('Лічильник скинуто: пар — 3.');
    expect(calls).toContain('reset');
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});

describe('«Місця»: сторінки, дороги місця, архів одного місця', () => {
  it('пошук за назвою; «спершу найкоротші» піднімає підозріло коротку дорогу', async () => {
    mock();
    const { user } = await open();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows()[0]).toContain('Палац спорту — доріг: 5, 31–48 хв');
    await user.click(screen.getByLabelText('спершу найкоротші дороги'));
    expect(rows()[0]).toContain('Торговельно-економічний університет — доріг: 15, 5–8 хв');
    await user.type(screen.getByLabelText('Знайти місце'), 'палац');
    expect(rows()).toHaveLength(1);
    await user.clear(screen.getByLabelText('Знайти місце'));
    await user.type(screen.getByLabelText('Знайти місце'), 'немає такого');
    expect(screen.getByText('Такого місця серед збережених немає.')).toBeInTheDocument();
  });

  it(`сторінками по ${PLACES_PAGE}: «Далі» й «Назад»`, async () => {
    const many: DovedeCityPlace[] = Array.from({ length: PLACES_PAGE + 5 }, (_, i) => ({ city: 'Kyiv', key: `м${i}`, label: `Місце ${i}`, routes: 1, archivedRoutes: 0, minMinutes: 20, maxMinutes: 20, archivedAt: null }));
    mock({}, many);
    const { user } = await open();
    await waitFor(() => expect(rows()).toHaveLength(PLACES_PAGE));
    const pages = screen.getByRole('navigation', { name: 'Сторінки місць' });
    expect(pages).toHaveTextContent(`1–${PLACES_PAGE} з ${PLACES_PAGE + 7}`);
    expect(within(pages).getByRole('button', { name: '← Назад' })).toBeDisabled();
    await user.click(within(pages).getByRole('button', { name: 'Далі →' }));
    expect(rows()).toHaveLength(7);
    expect(pages).toHaveTextContent(`${PLACES_PAGE + 1}–${PLACES_PAGE + 7} з ${PLACES_PAGE + 7}`);
    // новий пошук — знову з першої
    await user.type(screen.getByLabelText('Знайти місце'), 'Місце 1');
    expect(rows()[0]).toContain('Місце 1');
  });

  it('«дороги» розгортає збережені дороги місця — з архівними', async () => {
    const { calls } = mock();
    const { user } = await open();
    await user.click(await screen.findByRole('button', { name: 'Дороги: Палац спорту' }));
    await waitFor(() => expect(document.querySelector('table.dovede-city-routes')).not.toBeNull());
    const table = document.querySelector('table.dovede-city-routes') as HTMLElement;
    expect(calls).toContain('routes:Kyiv:палац спорту');
    const trs = within(table).getAllByRole('row');
    expect(trs[1]).toHaveTextContent('метро «Академмістечко» → Палац спорту');
    expect(trs[1]).toHaveTextContent('будні 09:00');
    expect(trs[1]).toHaveTextContent('SUBWAY M1');
    expect(trs[2]).toHaveTextContent('в архіві');
    expect(trs[2]).toHaveTextContent('пішки');
    await user.click(screen.getByRole('button', { name: 'Дороги: Палац спорту' }));
    expect(document.querySelector('table.dovede-city-routes')).toBeNull();
  });

  it('«В архів» питає підтвердження й шле місто з ключем; «Повернути» — без питання', async () => {
    const { calls } = mock();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await open();
    const archive = await screen.findByRole('button', { name: 'В архів: Торговельно-економічний університет' });
    await user.click(archive);
    expect(calls.filter((c) => c.startsWith('place:'))).toEqual([]);
    await user.click(archive);
    expect(confirm.mock.calls[1][0]).toContain('«Торговельно-економічний університет» (Київ)');
    await screen.findByText('«Торговельно-економічний університет» (Київ) — в архіві, доріг: 15.');
    expect(calls.filter((c) => c.startsWith('place:'))).toEqual(['place:archive:Kyiv:торговельно-економічний університет']);

    await user.click(within(screen.getByRole('radiogroup', { name: 'Місто' })).getByRole('radio', { name: 'Житомир' }));
    await user.click(await screen.findByRole('button', { name: 'Повернути: Житній ринок' }));
    await screen.findByText('«Житній ринок» (Житомир) — повернуто, доріг: 2.');
    expect(calls.filter((c) => c.startsWith('place:'))[1]).toBe('place:restore:Zhytomyr:житній ринок');
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
