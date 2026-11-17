/** «Місто: що вже знаємо» в адмінці: строк свіжості збереженої відповіді та скидання лічильника попиту. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeCityStats } from '@/types';
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
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/city`, () => HttpResponse.json(state)),
    http.put(`${TEST_API_URL}/admin/dovede/city/settings`, async ({ request }) => {
      const body = (await request.json()) as { freshDays: number };
      calls.push(`fresh:${body.freshDays}`);
      state.freshDays = body.freshDays;
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
  render(<DovedeCityPanel />);
  await user.click(screen.getByRole('button', { name: 'Показати' }));
  const field = (await screen.findByLabelText('Збережена відповідь свіжа, днів')) as HTMLInputElement;
  return { user, field };
}

afterEach(() => vi.restoreAllMocks());

describe('DovedeCityPanel', () => {
  it('показує строк свіжості з сервера й зберігає новий; поза межами 1–365 зберегти не дає', async () => {
    const { calls } = mock();
    const { user, field } = await open();
    expect(field.value).toBe('30');
    expect(screen.getByText(/застаріло доріг: 3 — сервер оновлює їх сам/)).toBeInTheDocument();
    expect(screen.getByText(/Google відмовив \(HTTP 403\) 18 листопада о 00:12 — немає доступу: обмеження ключа, вимкнений Routes API або білінг; Google: «Requests to this API are blocked.»/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Зберегти' });
    expect(save).toBeDisabled(); // те саме значення

    await user.clear(field);
    await user.type(field, '400');
    expect(save).toBeDisabled();
    expect(screen.getByText('Ціле число від 1 до 365.')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '90');
    await user.click(save);
    await screen.findByText('Збережено: відповідь свіжа 90 днів.');
    expect(calls).toEqual(['fresh:90']);
    await waitFor(() => expect(field.value).toBe('90'));
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
