/**
 * Вкладка «Доведе» з розділами (Docs/dovede-admin-roadmap.md, крок 1): адреса → розділ, невідомий розділ → «Огляд»,
 * меню розділів із `aria-current`, «навчити» → «Словник» із `?word=`, «Огляд» з лічильниками Google і пар без відповіді.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeCityStats, DovedeLog } from '@/types';
import DovedeTab from './DovedeTab';
import { dovedePath } from './sections';

const LOG: DovedeLog = {
  days: 7,
  since: '2026-11-11T22:00:00.000Z',
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
    byStatus: [{ status: 'ok', count: 28 }],
    topUnknown: [
      { word: 'епіцентр', count: 3, example: 'як доїхати до епіцентру' },
      { word: 'фора', count: 1, example: 'до фори' },
    ],
  },
  matched: 6,
  items: [],
};

const CITY: DovedeCityStats = {
  enabled: true,
  store: true,
  hasKey: true,
  callsToday: 37,
  dailyCap: 150,
  freshDays: 30,
  archivedRoutes: 0,
  routes: [],
  lines: [],
  stops: [],
  demand: [],
  unanswered: [
    { city: 'Kyiv', fromKey: 'a', toKey: 'b', from: 'метро «Святошин»', to: 'вулиця Ентузіастів 7', asked: 2 },
    { city: 'Zhytomyr', fromKey: 'c', toKey: 'd', from: 'автовокзал', to: 'Польова 12', asked: 1 },
  ],
};

function mock(log: DovedeLog = LOG, city: DovedeCityStats = CITY): string[] {
  const queries: string[] = [];
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/queries`, ({ request }) => {
      queries.push(new URL(request.url).search);
      return HttpResponse.json(log);
    }),
    http.get(`${TEST_API_URL}/admin/dovede/city`, () => HttpResponse.json(city)),
    http.get(`${TEST_API_URL}/admin/dovede/city/places`, () => HttpResponse.json({ places: [] })),
    http.get(`${TEST_API_URL}/admin/dovede/synonyms`, () => HttpResponse.json({ synonyms: [] })),
  );
  return queries;
}

/** як `AdminPage`: другий сегмент адреси йде у вкладку */
const Shell = () => {
  const { section } = useParams<{ section?: string }>();
  return <DovedeTab section={section} />;
};

const Where = () => {
  const loc = useLocation();
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>;
};

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/:tab?/:section?" element={<Shell />} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );

const where = () => screen.getByTestId('where').textContent;

describe('DovedeTab', () => {
  it('меню розділів: адреси й aria-current', async () => {
    mock();
    renderAt('/admin/dovede/questions');
    const nav = screen.getByRole('navigation', { name: 'Розділи «Доведе»' });
    const link = (name: string) => within(nav).getByRole('link', { name });
    expect(link('Огляд')).toHaveAttribute('href', '/admin/dovede');
    expect(link('Питання людей')).toHaveAttribute('href', '/admin/dovede/questions');
    expect(link('Словник')).toHaveAttribute('href', '/admin/dovede/dictionary');
    expect(link('Місто')).toHaveAttribute('href', '/admin/dovede/city');
    expect(link('Питання людей')).toHaveAttribute('aria-current', 'page');
    expect(link('Огляд')).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('heading', { name: 'Питання людей' })).toBeInTheDocument();

    await userEvent.click(link('Місто'));
    expect(where()).toBe('/admin/dovede/city');
    expect(link('Місто')).toHaveAttribute('aria-current', 'page');
  });

  it('невідомий розділ → «Огляд»', async () => {
    mock();
    renderAt('/admin/dovede/nema-takogo');
    expect(await screen.findByRole('heading', { name: 'Огляд' })).toBeInTheDocument();
    expect(where()).toBe('/admin/dovede');
  });

  it('«Огляд»: Google N/ліміт, пари без відповіді, невпізнані слова й розбіжності — посиланнями', async () => {
    const queries = mock();
    renderAt('/admin/dovede');
    expect(await screen.findByRole('link', { name: 'Пар у місті без відповіді: 2' })).toHaveAttribute('href', '/admin/dovede/city');

    const google = screen.getByText('Google сьогодні').closest('a')!;
    expect(google).toHaveTextContent('37 / 150');
    const claude = screen.getByText('Claude сьогодні').parentElement!;
    expect(claude).toHaveTextContent('12 / 300');
    expect(screen.getByText('З проблемами').closest('a')).toHaveAttribute('href', '/admin/dovede/questions?days=1&only=problems');

    expect(screen.getByRole('link', { name: 'епіцентр' })).toHaveAttribute('href', dovedePath('dictionary', { word: 'епіцентр' }));
    expect(screen.getByRole('link', { name: 'Словник і ШІ зрозуміли по-різному: 7' })).toHaveAttribute('href', '/admin/dovede/questions?days=7&only=disagree');
    expect(screen.getByRole('link', { name: 'ШІ не відповів: 2' })).toHaveAttribute('href', '/admin/dovede/questions?days=7&only=fail');
    expect(queries.sort()).toEqual(['?days=1&only=problems', '?days=7&only=fail']);
  });

  it('«Огляд» без справ — одне речення', async () => {
    mock({ ...LOG, summary: { ...LOG.summary, topUnknown: [], disagreed: 0, aiFailed: 0 } }, { ...CITY, unanswered: [] });
    renderAt('/admin/dovede');
    expect(await screen.findByText(/Усе гаразд/)).toBeInTheDocument();
  });

  it('«навчити» в «Питаннях людей» веде до «Словника» зі словом у формі', async () => {
    mock();
    renderAt('/admin/dovede/questions');
    const [first] = await screen.findAllByRole('link', { name: 'навчити' });
    await userEvent.click(first);
    expect(where()).toBe(dovedePath('dictionary', { word: 'епіцентр' }));
    expect(await screen.findByRole('heading', { name: 'Словник' })).toBeInTheDocument();
    expect(screen.getByLabelText('Як кажуть люди')).toHaveValue('епіцентр');
  });

  it('фільтр з адреси «Огляду» вже вибрано в «Питаннях людей»', async () => {
    const queries = mock();
    renderAt('/admin/dovede/questions?days=30&only=disagree');
    await waitFor(() => expect(queries).toEqual(['?days=30&only=disagree']));
    expect(await screen.findByRole('button', { name: 'Розбіжності' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '30 днів' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('«Місто» відкрите одразу', async () => {
    mock();
    renderAt('/admin/dovede/city');
    expect(await screen.findByLabelText('Запитів до Google на день')).toHaveValue(150);
    expect(screen.getByRole('button', { name: 'Згорнути' })).toBeInTheDocument();
  });
});
