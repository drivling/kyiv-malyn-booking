/**
 * Картка «Час у дорозі за GPS» у редакторі графіка: вантажиться, коли її відкрили; таблиця «наш час / за GPS» по
 * відрізках, сірі рядки з малою довірою, фільтр помітних різниць, період, місто без точок. API — через MSW.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { GpsRunTimesReport } from '@/types';
import { GpsRunTimesPanel } from './GpsRunTimesPanel';
import { difference, isNotable, minutes } from './gpsRunTimesText';

const RUN_TIMES_URL = `${TEST_API_URL}/admin/transport/gps/run-times`;

const REPORT: GpsRunTimesReport = {
  cityCode: 'Korosten',
  days: 7,
  points: 7011,
  from: '2026-11-17T08:29:45.000Z',
  to: '2026-11-20T22:17:50.000Z',
  revision: '2026-11-20T22:54:04.373Z',
  unknownRouteNos: ['14'],
  routes: [
    {
      routeId: '2b',
      routeNo: '2-Б',
      points: 402,
      directions: [
        {
          direction: 'there',
          meters: 10100,
          ourSec: 1560,
          gpsSec: 1614,
          covered: 0.78,
          timetableSec: 1800,
          passes: 40,
          spans: [
            { fromStopId: 'a', toStopId: 'b', fromName: 'Залізничний вокзал', toName: 'Міський центральний ринок', meters: 820, ourSec: 120, gpsSec: 198, passes: 21.7, confidence: 'ok' },
            { fromStopId: 'b', toStopId: 'c', fromName: 'Міський центральний ринок', toName: 'Парк', meters: 921, ourSec: 180, gpsSec: 186, passes: 12, confidence: 'ok' },
            { fromStopId: 'c', toStopId: 'd', fromName: 'Парк', toName: 'Пашини', meters: 6257, ourSec: 600, gpsSec: 540, passes: 4.1, confidence: 'few' },
            { fromStopId: 'd', toStopId: 'e', fromName: 'Пашини', toName: 'Кінцева', meters: 300, ourSec: 60, gpsSec: null, passes: 0, confidence: 'none' },
          ],
        },
      ],
    },
  ],
};

describe('час і різниця текстом', () => {
  it('хвилини з десятими; плюс — автобус їде довше, ніж у нас; помітна різниця — від хвилини й третини часу', () => {
    expect(minutes(198)).toBe('3,3 хв');
    expect(minutes(null)).toBe('—');
    expect(difference(120, 198)).toBe('+1,3 хв');
    expect(difference(180, 120)).toBe('−1,0 хв');
    expect(difference(120, 121)).toBe('0');
    expect(difference(120, null)).toBe('—');
    expect(isNotable(REPORT.routes[0].directions[0].spans[0])).toBe(true);
    expect(isNotable(REPORT.routes[0].directions[0].spans[1])).toBe(false);
    // мало проїздів — не «помітна», хоч би якою була різниця
    expect(isNotable({ ...REPORT.routes[0].directions[0].spans[2], gpsSec: 60 })).toBe(false);
  });
});

describe('GpsRunTimesPanel', () => {
  it('закрита картка сервер не питає; відкрита — таблиця відрізків із підсумком напрямку', async () => {
    const asked: string[] = [];
    server.use(
      http.get(RUN_TIMES_URL, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(REPORT);
      }),
    );
    const user = userEvent.setup();
    render(<GpsRunTimesPanel city="Korosten" />);
    expect(asked).toEqual([]);
    await user.click(screen.getByText('Час у дорозі за GPS'));
    const route = await screen.findByRole('region', { name: 'Маршрут №2-Б' });
    expect(asked).toEqual(['?city=Korosten&days=7']);
    expect(within(route).getByText(/10,1 км · наш час 26,0 хв · за GPS 26,9 хв \(дані для 78 % шляху\) · у розкладі 30,0 хв/)).toBeTruthy();
    const rows = within(route).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['Залізничний вокзал → Міський центральний ринок', '820 м', '2,0 хв', '3,3 хв', '+1,3 хв', '22'],
      ['Міський центральний ринок → Парк', '921 м', '3,0 хв', '3,1 хв', '+0,1 хв', '12'],
      ['Парк → Пашини', '6257 м', '10,0 хв', '9,0 хв', '−1,0 хв', '4 · мало проїздів'],
      ['Пашини → Кінцева', '300 м', '1,0 хв', '—', '—', '0 · немає даних'],
    ]);
    expect(rows.map((r) => r.className)).toEqual(['is-notable', '', 'is-weak', 'is-weak']);
    expect(screen.getByText(/7[\s ]011 точок за 17\.11–21\.11/)).toBeTruthy();
    expect(screen.getByText(/яких немає серед маршрутів: 14/)).toBeTruthy();

    // лише помітні різниці
    await user.click(screen.getByLabelText(/лише помітні різниці/));
    expect(within(route).getAllByRole('row')).toHaveLength(2);

    // інший період — новий запит
    await user.click(screen.getByRole('button', { name: '30 днів' }));
    await screen.findByRole('region', { name: 'Маршрут №2-Б' });
    expect(asked[asked.length - 1]).toBe('?city=Korosten&days=30');
  });

  it('точок немає — «Даних ще немає»; помилка сервера — текстом', async () => {
    server.use(http.get(RUN_TIMES_URL, () => HttpResponse.json({ ...REPORT, points: 0, from: null, to: null, routes: [], unknownRouteNos: [] })));
    const user = userEvent.setup();
    const { unmount } = render(<GpsRunTimesPanel city="Malyn" />);
    await user.click(screen.getByText('Час у дорозі за GPS'));
    expect(await screen.findByText(/Даних ще немає/)).toBeTruthy();
    unmount();

    server.use(http.get(RUN_TIMES_URL, () => HttpResponse.json({ error: 'Failed to build GPS run times' }, { status: 500 })));
    render(<GpsRunTimesPanel city="Korosten" />);
    await user.click(screen.getByText('Час у дорозі за GPS'));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
