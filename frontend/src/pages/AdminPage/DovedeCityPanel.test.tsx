/** «Місто: що вже знаємо» в адмінці: строк свіжості збереженої відповіді та скидання лічильника попиту. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeCityPlace, DovedeCityStats } from '@/types';
import { DovedeCityPanel } from './DovedeCityPanel';

function mock(over: Partial<DovedeCityStats> = {}) {
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
    routes: [{ city: 'Kyiv', source: 'google', count: 4 }],
    lines: [],
    stops: [],
    demand: [
      { city: 'Kyiv', from: 'метро «Академмістечко»', to: 'Охматдит', asked: 3, answered: true, lastAskedAt: '2026-11-17T08:00:00.000Z' },
      { city: 'Kyiv', from: 'метро «Святошин»', to: 'вулиця Ентузіастів 7', asked: 1, answered: false, lastAskedAt: '2026-11-17T09:00:00.000Z' },
    ],
    ...over,
  };
  const calls: string[] = [];
  const places: DovedeCityPlace[] = [
    { city: 'Kyiv', key: 'палац спорту', label: 'Палац спорту', routes: 5, archivedRoutes: 0, minMinutes: 31, maxMinutes: 48, archivedAt: null },
    { city: 'Kyiv', key: 'торговельно-економічний університет', label: 'Торговельно-економічний університет', routes: 15, archivedRoutes: 0, minMinutes: 5, maxMinutes: 8, archivedAt: null },
    { city: 'Zhytomyr', key: 'житній ринок', label: 'Житній ринок', routes: 0, archivedRoutes: 2, minMinutes: 12, maxMinutes: 14, archivedAt: '2026-11-18T08:00:00.000Z' },
  ];
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/city/places`, () => HttpResponse.json({ places })),
    http.post(`${TEST_API_URL}/admin/dovede/city/place/archive`, async ({ request }) => {
      const body = (await request.json()) as { city: string; key: string; action: 'archive' | 'restore' };
      calls.push(`place:${body.action}:${body.city}:${body.key}`);
      const p = places.find((x) => x.city === body.city && x.key === body.key)!;
      const moved = body.action === 'archive' ? p.routes : p.archivedRoutes;
      if (body.action === 'archive') Object.assign(p, { archivedRoutes: p.archivedRoutes + p.routes, routes: 0, archivedAt: '2026-11-18T09:00:00.000Z' });
      else Object.assign(p, { routes: p.routes + p.archivedRoutes, archivedRoutes: 0, archivedAt: null });
      return HttpResponse.json({ action: body.action, city: body.city, key: body.key, routes: moved });
    }),
    http.get(`${TEST_API_URL}/admin/dovede/city`, () => HttpResponse.json(state)),
    http.put(`${TEST_API_URL}/admin/dovede/city/settings`, async ({ request }) => {
      const body = (await request.json()) as { freshDays?: number; dailyCap?: number | null };
      if ('dailyCap' in body) {
        calls.push(`cap:${body.dailyCap}`);
        state.dailyCap = body.dailyCap ?? state.dailyCapDefault ?? 150;
        state.dailyCapFromAdmin = body.dailyCap != null;
        return HttpResponse.json({ dailyCap: state.dailyCap });
      }
      calls.push(`fresh:${body.freshDays}`);
      state.freshDays = body.freshDays!;
      return HttpResponse.json({ freshDays: body.freshDays });
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/demand/reset`, () => {
      calls.push('reset');
      const reset = state.demand.length;
      state.demand = [];
      return HttpResponse.json({ reset });
    }),
  );
  return { calls };
}

async function open() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <DovedeCityPanel />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole('button', { name: 'Показати' }));
  await screen.findByRole('button', { name: 'Скинути лічильник попиту' });
  return { user };
}

afterEach(() => vi.restoreAllMocks());

describe('DovedeCityPanel', () => {
  it('рядок стану й посилання: строк свіжості й ліміт Google показано, змінюють їх у «Налаштування»', async () => {
    mock();
    await open();
    expect(screen.getByText(/застаріло доріг: 3 — сервер оновлює їх сам/)).toBeInTheDocument();
    expect(screen.getByText(/Google відмовив \(HTTP 403\) 18 листопада о 00:12 — немає доступу: обмеження ключа, вимкнений Routes API або білінг; Google: «Requests to this API are blocked.»/)).toBeInTheDocument();
    expect(screen.getByText(/Відповідь свіжа 30 днів · ліміт Google 150 на день/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '«Налаштування»' })).toHaveAttribute('href', '/admin/dovede/settings');
    // полів налаштувань тут більше немає
    expect(screen.queryByLabelText('Збережена відповідь свіжа, днів')).toBeNull();
    expect(screen.queryByLabelText('Запитів до Google на день')).toBeNull();
  });

  it('рядок стану: з чого склались запити до Google, скільки людям відмовили, пауза після відмови', async () => {
    mock({ callsToday: 40, dailyCap: 150, today: { people: 25, learn: 15, refused: 3 }, blocked: { until: '2026-11-18T10:20:00.000Z', reason: 'quota' } });
    await open();
    const status = screen.getByText(/запитів до Google сьогодні: 40 з 150 \(люди 25, навчання 15\)/);
    expect(status.textContent).toContain('людям відмовили через ліміт: 3');
    expect(status.textContent).toMatch(/Google не питаємо до 18 листопада о 12:20 — вичерпано квоту/);
  });

  it('скидає лічильник попиту лише після підтвердження; пару без відповіді позначає', async () => {
    const { calls } = mock();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { user } = await open();
    expect(screen.getByText(/вулиця Ентузіастів 7/).textContent).toContain('відповіді немає');
    expect(screen.getByText(/Охматдит/).textContent).not.toContain('відповіді немає');

    const reset = screen.getByRole('button', { name: 'Скинути лічильник попиту' });
    await user.click(reset);
    expect(calls).toEqual([]);

    confirm.mockReturnValue(true);
    await user.click(reset);
    await screen.findByText('Лічильник скинуто: пар — 2.');
    expect(calls).toEqual(['reset']);
    await screen.findByText('Запитів про дорогу містом ще не було.');
    expect(reset).toBeDisabled();
  });
});

describe('«Місця»: архів одного місця', () => {
  it('місця в архіві зверху; пошук за назвою; «спершу найкоротші» піднімає підозріло коротку дорогу', async () => {
    mock();
    const { user } = await open();
    const rows = () => [...document.querySelectorAll('.dovede-city-places li')].map((li) => li.textContent ?? '');
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows()[0]).toContain('Житній ринок');
    expect(rows()[0]).toContain('в архіві з 18 листопада, доріг: 2');
    expect(rows()[1]).toContain('Палац спорту — доріг: 5, 31–48 хв');

    await user.click(screen.getByLabelText('спершу найкоротші дороги'));
    expect(rows()[1]).toContain('Торговельно-економічний університет — доріг: 15, 5–8 хв');

    await user.type(screen.getByLabelText('Знайти місце'), 'палац');
    expect(rows()).toHaveLength(1);
    await user.clear(screen.getByLabelText('Знайти місце'));
    await user.type(screen.getByLabelText('Знайти місце'), 'немає такого');
    expect(screen.getByText('Такого місця серед збережених немає.')).toBeInTheDocument();
  });

  it('«В архів» питає підтвердження й шле місто з ключем; «Повернути» — без питання', async () => {
    const { calls } = mock();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    const { user } = await open();
    const archive = await screen.findByRole('button', { name: 'В архів: Торговельно-економічний університет' });
    await user.click(archive);
    expect(calls).toEqual([]);
    await user.click(archive);
    expect(confirm.mock.calls[1][0]).toContain('«Торговельно-економічний університет» (Київ)');
    await screen.findByText('«Торговельно-економічний університет» (Київ) — в архіві, доріг: 15.');
    expect(calls).toEqual(['place:archive:Kyiv:торговельно-економічний університет']);
    await screen.findByRole('button', { name: 'Повернути: Торговельно-економічний університет' });

    await user.click(screen.getByRole('button', { name: 'Повернути: Житній ринок' }));
    await screen.findByText('«Житній ринок» (Житомир) — повернуто, доріг: 2.');
    expect(calls[1]).toBe('place:restore:Zhytomyr:житній ринок');
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
