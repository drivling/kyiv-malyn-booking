/**
 * Блок «Джерела розкладу» в редакторі графіка: список із сервера, позначка зміни, «Переглянуто»,
 * «Перевірити зараз». API — через MSW.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { WatchedSource } from '@/types';
import { SourceWatchPanel } from './SourceWatchPanel';

const SOURCES_URL = `${TEST_API_URL}/admin/transport/sources`;

const source = (over: Partial<WatchedSource>): WatchedSource => ({
  key: 'korosten-rada-timetable',
  kind: 'html-tables',
  cityCode: 'Korosten',
  label: 'Коростень: розклад автобусів на сайті ради',
  url: 'https://example.org/rozklad',
  modified: '2026-07-13T10:44:39+00:00',
  lastCheckedAt: '2026-11-09T10:00:00.000Z',
  lastChangedAt: null,
  acknowledgedAt: null,
  pending: false,
  changed: [],
  parts: 9,
  failCount: 0,
  lastError: null,
  ...over,
});

describe('SourceWatchPanel', () => {
  it('без джерел нічого не показує', async () => {
    const { container } = render(<SourceWatchPanel />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('показує зміну з переліком маршрутів; «Переглянуто» знімає позначку', async () => {
    const changed = source({ pending: true, lastChangedAt: '2026-11-09T09:00:00.000Z', changed: ['№2', '№6'] });
    let acked = '';
    server.use(
      http.get(SOURCES_URL, () => HttpResponse.json({ sources: [changed, source({ key: 'korosten-stops', label: 'Коростень: зупинки (data.gov.ua)' })] })),
      http.post(`${SOURCES_URL}/:key/ack`, ({ params }) => {
        acked = String(params.key);
        return HttpResponse.json({ sources: [source({})] });
      }),
    );
    render(<SourceWatchPanel />);

    expect(await screen.findByText('змінилось: 1')).toBeInTheDocument();
    expect(screen.getByText(/№2, №6/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Коростень: розклад автобусів на сайті ради' })).toHaveAttribute('href', 'https://example.org/rozklad');
    expect(screen.getAllByText('13.07.2026, 13:44')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Переглянуто' }));
    await waitFor(() => expect(acked).toBe('korosten-rada-timetable'));
    expect(await screen.findByText('без змін', { selector: '.source-watch-badge' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Переглянуто' })).not.toBeInTheDocument();
  });

  it('«Перевірити зараз» оновлює список; джерело, що не відповідає, видно з помилкою', async () => {
    let checks = 0;
    server.use(
      http.get(SOURCES_URL, () => HttpResponse.json({ sources: [source({ lastCheckedAt: null })] })),
      http.post(`${SOURCES_URL}/check`, () => {
        checks += 1;
        return HttpResponse.json({ results: [], sources: [source({ failCount: 2, lastError: 'HTTP 503' })] });
      }),
    );
    render(<SourceWatchPanel />);
    expect(await screen.findByText('ще не перевірялось')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Перевірити зараз' }));
    expect(await screen.findByText('не відповідає (2): HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('не відповідає: 1')).toBeInTheDocument();
    expect(checks).toBe(1);
  });
});
