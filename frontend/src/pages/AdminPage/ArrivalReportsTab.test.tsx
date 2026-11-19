/**
 * «Факт прибуття» на спільних деталях адмінки (крок 12): плитки, рейси на зупинках і останні позначки щільними списками,
 * період у запиті, видалення хибного звіту лише після підтвердження, порожній період.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { ArrivalReportStats } from '@/types';
import { ArrivalReportsTab } from './ArrivalReportsTab';

const STATS: ArrivalReportStats = {
  days: 30,
  total: 8,
  arrived: 6,
  missed: 2,
  summary: [{ routeId: '5', direction: 'there', stopId: 'st_0004', scheduledTime: '08:10', arrived: 3, missed: 1, avgDelay: 4, minDelay: -2, maxDelay: 9, days: 3, lastAt: '2026-11-18T06:20:00.000Z' }],
  recent: [
    { id: 41, kind: 'arrived', routeId: '5', tripId: 't1', direction: 'there', stopId: 'st_0004', serviceDate: '2026-11-18', scheduledTime: '08:10', actualTime: '08:16', delayMin: 6, waitedMin: null, source: 'board', clientId: 'abcdef123', createdAt: '2026-11-18T06:16:00.000Z' },
    { id: 42, kind: 'missed', routeId: '5', tripId: 't2', direction: 'back', stopId: 'st_0004', serviceDate: '2026-11-18', scheduledTime: '09:00', actualTime: null, delayMin: null, waitedMin: 15, source: 'route', clientId: null, createdAt: '2026-11-18T07:15:00.000Z' },
  ],
};

function mock(stats: ArrivalReportStats = STATS) {
  const calls: string[] = [];
  server.use(
    http.get(`${TEST_API_URL}/admin/transport/arrival-reports`, ({ request }) => {
      calls.push(new URL(request.url).search);
      return HttpResponse.json(stats);
    }),
    http.delete(`${TEST_API_URL}/admin/transport/arrival-reports/:id`, ({ params }) => {
      calls.push(`delete:${params.id}`);
      return HttpResponse.json({ ok: true });
    }),
  );
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe('ArrivalReportsTab', () => {
  it('плитки: позначок, середнє відхилення, «не було» з часткою', async () => {
    mock();
    render(<ArrivalReportsTab />);
    const tiles = await screen.findByRole('group', { name: 'За період' });
    expect(within(tiles).getByText('Позначок').parentElement).toHaveTextContent('8');
    expect(within(tiles).getByText('Середнє відхилення').parentElement).toHaveTextContent('+4 хв');
    // 2 з 8 = 25 % — плитка жовтіє
    expect(within(tiles).getByText('Не було').closest('.admin-kit-tile')).toHaveClass('admin-kit-tile--warn');
    expect(within(tiles).getByText('Не було').parentElement).toHaveTextContent('25 %');
  });

  it('рейси на зупинках: проблемні вгорі, відхилення кольором, розкид смужкою', async () => {
    mock({
      ...STATS,
      summary: [
        STATS.summary[0],
        { ...STATS.summary[0], routeId: '7', scheduledTime: '09:00', arrived: 4, missed: 0, avgDelay: 1, minDelay: 0, maxDelay: 2 },
        { ...STATS.summary[0], routeId: '3', scheduledTime: '10:00', arrived: 2, missed: 2, avgDelay: 12, minDelay: 10, maxDelay: 14 },
      ],
    });
    render(<ArrivalReportsTab />);
    const list = await screen.findByRole('list', { name: 'Рейси на зупинках' });
    const items = within(list).getAllByRole('listitem');
    // спершу найбільше «не було», далі — найбільше запізнення
    expect(items.map((li) => li.querySelector('strong')?.textContent)).toEqual(['10:00', '08:10', '09:00']);
    expect(within(items[0]).getByText('+12 хв')).toHaveClass('arr-pill--bad');
    expect(within(items[0]).getByText('не було ×2')).toBeInTheDocument();
    expect(within(items[1]).getByText('+4 хв')).toHaveClass('arr-pill--warn');
    expect(within(items[1]).getByRole('img', { name: 'від −2 до +9 хв' })).toBeInTheDocument();
    expect(items[1]).toHaveTextContent('туди · позначок 4 за 3 дні');
    expect(within(items[2]).getByText('вчасно')).toHaveClass('arr-pill--ok');
  });

  it('останні позначки — одним рядком: відхилення, номер, час і зупинка, звідки й пристрій', async () => {
    mock();
    render(<ArrivalReportsTab />);
    const list = await screen.findByRole('list', { name: 'Останні позначки' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(within(first).getByText('+6 хв')).toHaveClass('arr-pill--warn');
    expect(first).toHaveTextContent('08:10 → 08:16 · st_0004');
    expect(first).toHaveTextContent('табло');
    expect(first).toHaveTextContent('abcdef');
    expect(second).toHaveClass('arr-mark--missed');
    expect(within(second).getByText('не було')).toBeInTheDocument();
    expect(second).toHaveTextContent('09:00 — чекав 15 хв');
  });

  it('період — у запиті; «Оновити» перепитує', async () => {
    const calls = mock();
    const user = userEvent.setup();
    render(<ArrivalReportsTab />);
    await screen.findByRole('group', { name: 'За період' });
    const period = screen.getByRole('group', { name: 'Період' });
    expect(within(period).getByRole('button', { name: '30 днів' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(period).getByRole('button', { name: 'Сьогодні' }));
    await waitFor(() => expect(calls).toContain('?days=1'));
    await user.click(screen.getByRole('button', { name: 'Оновити' }));
    await waitFor(() => expect(calls.filter((c) => c === '?days=1')).toHaveLength(2));
  });

  it('видаляє хибний звіт лише після підтвердження', async () => {
    const calls = mock();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    render(<ArrivalReportsTab />);
    const del = await screen.findByRole('button', { name: 'Видалити звіт 41' });
    await user.click(del);
    expect(calls.some((c) => c.startsWith('delete'))).toBe(false);
    await user.click(del);
    await waitFor(() => expect(calls).toContain('delete:41'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('порожній період — одне речення замість таблиць', async () => {
    mock({ ...STATS, total: 0, arrived: 0, missed: 0, summary: [], recent: [] });
    render(<ArrivalReportsTab />);
    expect(await screen.findByText('За цей період позначок ще немає.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Рейси на зупинках' })).toBeNull();
  });
});
