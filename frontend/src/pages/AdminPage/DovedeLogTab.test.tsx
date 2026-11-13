/**
 * Вкладка «Доведе» (журнал питань): плитки зведення, слова, яких не впізнали, таблиця питань з обома
 * розборами при розбіжності, фільтр і період у запиті, попередження без ключа.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { TripIntent } from '@/pages/DovedePage/nlu/types';
import type { DovedeLog, DovedeLogItem } from '@/types';
import DovedeLogTab from './DovedeLogTab';
import { intentLine } from './dovedeLogText';

const INTENT: TripIntent = {
  intent: 'trip',
  from: { id: 'city.Kyiv', text: 'Києва' },
  to: { id: 'malyn.vokzal', text: 'вокзал' },
  when: { day: 'tomorrow', time: '08:00', kind: 'depart' },
  modes: ['marshrutka'],
  unknown: [],
  confidence: 'high',
};

const item = (over: Partial<DovedeLogItem>): DovedeLogItem => ({
  id: 1,
  createdAt: '2026-11-13T10:00:00.000Z',
  text: 'з Києва на вокзал завтра о 8 маршруткою',
  status: 'ok',
  aiCalled: true,
  agree: true,
  latencyMs: 2100,
  model: 'm',
  promptVersion: 'dovede-understand-v4',
  error: null,
  local: INTENT,
  ai: INTENT,
  flags: [],
  ...over,
});

const LOG: DovedeLog = {
  days: 7,
  since: '2026-11-06T22:00:00.000Z',
  enabled: true,
  hasKey: true,
  dailyCap: 300,
  callsToday: 12,
  truncated: false,
  summary: {
    total: 40,
    aiCalls: 30,
    aiOk: 28,
    aiFailed: 2,
    agreed: 21,
    disagreed: 7,
    withUnknown: 5,
    noPlace: 4,
    medianLatencyMs: 2279,
    tokens: { input: 1000, output: 2000, cacheRead: 300000, cacheWrite: 15000 },
    byStatus: [
      { status: 'ok', count: 28 },
      { status: 'timeout', count: 2 },
    ],
    topUnknown: [{ word: 'епіцентр', count: 3, example: 'як доїхати до епіцентру' }],
  },
  matched: 3,
  items: [
    item({ id: 3, text: 'як доїхати до епіцентру', agree: null, local: { ...INTENT, to: null, unknown: ['епіцентру'] }, ai: null, status: 'timeout', flags: ['fail', 'unknown', 'no_place'] }),
    item({ id: 2, text: 'з києва до центру', agree: false, ai: { ...INTENT, to: { id: 'malyn.tsentr', text: 'центру' } }, flags: ['disagree'] }),
    item({ id: 1 }),
  ],
};

function mock(log: DovedeLog = LOG): string[] {
  const seen: string[] = [];
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/queries`, ({ request }) => {
      seen.push(new URL(request.url).search);
      return HttpResponse.json(log);
    }),
  );
  return seen;
}

const renderTab = () =>
  render(
    <MemoryRouter>
      <DovedeLogTab />
    </MemoryRouter>,
  );

describe('DovedeLogTab', () => {
  it('показує зведення, невпізнані слова й питання з позначками', async () => {
    mock();
    renderTab();
    expect(await screen.findByText('75%')).toBeInTheDocument(); // 21 з 28
    expect(screen.getByText('2,3 с')).toBeInTheDocument();
    expect(screen.getByText(/Статуси: ШІ відповів — 28, не встиг — 2/)).toBeInTheDocument();

    const unknown = screen.getAllByRole('table')[0];
    expect(within(unknown).getByText('епіцентр')).toBeInTheDocument();

    const rows = within(screen.getAllByRole('table')[1]).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]).getByText('не впізнано: епіцентру')).toBeInTheDocument();
    expect(within(rows[1]).getByText('ШІ не відповів')).toBeInTheDocument();
    expect(within(rows[1]).getByText('не встиг')).toBeInTheDocument();
    // розбіжність — обидва розбори
    expect(within(rows[2]).getByText(/Claude:/).parentElement).toHaveTextContent('Київ → центр');
    expect(within(rows[2]).getByText(/браузер:/).parentElement).toHaveTextContent('Київ → вокзал');
    expect(within(rows[3]).getByText('2,1 с')).toBeInTheDocument();
  });

  it('період і фільтр ідуть у запит', async () => {
    const seen = mock();
    renderTab();
    await screen.findByText('75%');
    await userEvent.click(screen.getByRole('button', { name: '30 днів' }));
    await userEvent.click(screen.getByRole('button', { name: 'Невпізнані слова' }));
    await waitFor(() => expect(seen).toEqual(['?days=7', '?days=30', '?days=30&only=unknown']));
  });

  it('без ключа на сервері — попередження', async () => {
    mock({ ...LOG, hasKey: false });
    renderTab();
    expect(await screen.findByText(/немає ключа ANTHROPIC_API_KEY/)).toBeInTheDocument();
  });
});

describe('intentLine', () => {
  const label = (r: { id: string } | null) => r?.id ?? '?';
  it('складає розбір одним рядком', () => {
    expect(intentLine(INTENT, label)).toBe('city.Kyiv → malyn.vokzal · завтра 08:00 · маршрутка');
    expect(intentLine({ ...INTENT, from: null, when: { day: 'today', kind: 'any' }, modes: [] }, label)).toBe('? → malyn.vokzal');
    expect(intentLine({ ...INTENT, intent: 'route', from: null, to: null, when: { day: 'today', kind: 'any' }, modes: [], routes: ['5'] }, label)).toBe('маршрут · №5');
    expect(intentLine({ ...INTENT, when: { day: 'today', time: '17:00', kind: 'arrive' }, modes: [] }, label)).toBe('city.Kyiv → malyn.vokzal · сьогодні бути о 17:00');
  });
});
