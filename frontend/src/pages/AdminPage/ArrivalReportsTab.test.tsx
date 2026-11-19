/**
 * «Факт прибуття» на спільних деталях адмінки (крок 12): плитки, зведення по рейсах і останні позначки таблицями,
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
  it('плитки, зведення й останні позначки; «не було» — окремим рядком', async () => {
    mock();
    render(<ArrivalReportsTab />);
    const tiles = await screen.findByRole('group', { name: 'За період' });
    expect(within(tiles).getByText('Усього позначок').parentElement).toHaveTextContent('8');
    // 2 з 8 = 25 % — плитка жовтіє
    expect(within(tiles).getByText('Не було').closest('.admin-kit-tile')).toHaveClass('admin-kit-tile--warn');
    expect(within(tiles).getByText('Не було').parentElement).toHaveTextContent('25 %');

    const [summary, recent] = screen.getAllByRole('table');
    const row = within(summary).getAllByRole('row')[1];
    expect(row).toHaveTextContent('туди');
    expect(within(row).getByText('+4')).toBeInTheDocument();
    expect(within(row).getByText('−2 … +9')).toBeInTheDocument();
    expect(within(row).getAllByRole('cell')[2]).toHaveAttribute('data-label', 'Зупинка');

    const rows = within(recent).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('08:16');
    expect(rows[1]).toHaveTextContent('табло');
    expect(rows[1]).toHaveTextContent('abcdef');
    expect(rows[2]).toHaveClass('arrival-tab-row--missed');
    expect(rows[2]).toHaveTextContent('не було (чекав 15 хв)');
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
    expect(screen.queryByRole('table')).toBeNull();
  });
});
