/**
 * Вкладка «Наклейки зупинок»: зупинка з ?stop=, автоматичний розподіл ліній по боках дороги,
 * ручне перекидання лінії, «одна наклейка», друк (друк через iframe замокано) і його облік,
 * статистика відкриттів (плитки, по днях, по годинах) і список усіх зупинок з лічильниками.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { STICKER_DATASET } from './stopSticker/stickerTestDataset';
import { dayLabels, kyivToday } from './stopSticker/scanStats';
import { StopStickerTab } from './StopStickerTab';

const printMock = vi.hoisted(() => vi.fn());
vi.mock('./stopSticker/stickerSheets', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./stopSticker/stickerSheets')>();
  return { ...mod, printStickerSheets: printMock };
});

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.pathname}${loc.search}`}</output>;
}

function renderTab(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/admin/:tab?"
          element={
            <>
              <StopStickerTab />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

const previews = () => screen.queryAllByRole('figure').filter((f) => f.classList.contains('sticker-tab-preview'));
const stopList = () => screen.getByRole('region', { name: 'Зупинки' });
const listNames = () => within(stopList()).getAllByRole('button').map((b) => b.querySelector('.sticker-stops-name')?.textContent);
const tile = (group: string, label: string) => within(screen.getByLabelText(group)).getByText(label).nextElementSibling?.textContent;

const today = kyivToday();
const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
let statsRequests: string[] = [];
let printPosts: unknown[] = [];

beforeEach(() => {
  printMock.mockClear();
  statsRequests = [];
  printPosts = [];
  server.use(
    http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(STICKER_DATASET)),
    http.get(`${TEST_API_URL}/admin/transport/sticker-scans`, ({ request }) => {
      statsRequests.push(new URL(request.url).search);
      return HttpResponse.json({
        rows: [
          { stopId: 'st_0015', side: 'a', total: 12, today: 2, last7d: 4, last30d: 9, lastAt: '2026-10-05T07:30:00.000Z' },
          { stopId: 'st_0019', side: 's', total: 3, today: 0, last7d: 0, last30d: 3, lastAt: '2026-09-20T12:00:00.000Z' },
        ],
        total: 15,
        today: 2,
        last7d: 4,
        last30d: 12,
        days: 30,
        daily: [
          { day: yesterday, stopId: 'st_0019', side: 's', count: 1 },
          { day: today, stopId: 'st_0015', side: 'a', count: 5 },
          { day: today, stopId: 'st_0015', side: 'b', count: 2 },
        ],
        hourly: [
          { hour: 8, stopId: 'st_0015', side: 'a', count: 5 },
          { hour: 18, stopId: 'st_0015', side: 'b', count: 2 },
          { hour: 23, stopId: 'st_0019', side: 's', count: 1 },
        ],
        printed: [{ stopId: 'st_0015', side: 'a', count: 1, lastAt: '2026-10-06T09:00:00.000Z' }],
      });
    }),
    http.post(`${TEST_API_URL}/admin/transport/sticker-prints`, async ({ request }) => {
      printPosts.push(await request.json());
      return HttpResponse.json({ ok: true, count: 2 }, { status: 201 });
    })
  );
});

describe('StopStickerTab', () => {
  it('зупинка з ?stop= — дві наклейки, по одній на кожен бік дороги', async () => {
    renderTab('/admin/stickers?stop=st_0015');
    expect(await screen.findByLabelText('Назва на наклейці')).toHaveValue('з-д «Прожектор»');
    expect(previews()).toHaveLength(2);
    expect(previews()[0].querySelector('figcaption')).toHaveTextContent(/^Бік 1 · напрямок: Малинівський круг · /);
    expect(previews()[1].querySelector('figcaption')).toHaveTextContent(/^Бік 2 · напрямок: Центр · Базарна площа · /);
    expect(screen.getByRole('button', { name: 'Друкувати (2 аркуші A5)' })).toBeEnabled();
    const first = previews()[0].querySelector('svg')!;
    expect(first.querySelectorAll('.sticker-line')).toHaveLength(2);
    expect(first.getAttribute('aria-label')).toBe('Наклейка зупинки «з-д «Прожектор»»');
  });

  it('назва — у кольорі найяскравішої лінії (№5), можна обрати іншу лінію або темний', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers?stop=st_0015');
    const select = await screen.findByLabelText('Колір назви');
    const titleFill = () => previews().map((f) => f.querySelector('.sticker-title')!.getAttribute('fill'));
    expect(select).toHaveValue('auto');
    expect(screen.getByRole('option', { name: 'Найяскравіша лінія (№5)' })).toBeInTheDocument();
    expect(titleFill()).toEqual(['#1F6FD6', '#1F6FD6']);
    await user.selectOptions(select, 'Як лінія №11');
    expect(titleFill()).toEqual(['#0E9AA7', '#0E9AA7']);
    await user.selectOptions(select, 'Темний');
    expect(titleFill()).toEqual(['#1b1f2a', '#1b1f2a']);
  });

  it('лінію можна перекинути на інший бік або не друкувати', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers?stop=st_0015');
    const group = await screen.findByRole('radiogroup', { name: '№5 → Шевченка, 119: бік' });
    await user.click(within(group).getByLabelText('Бік 1'));
    expect(previews()[0].querySelectorAll('svg .sticker-line')).toHaveLength(3);
    expect(previews()[1].querySelectorAll('svg .sticker-line')).toHaveLength(1);
    await user.click(within(screen.getByRole('radiogroup', { name: '№11 → Паперова фабрика: бік' })).getByLabelText('Не друкувати'));
    expect(previews()).toHaveLength(1);
  });

  it('«одна наклейка з обома боками» і друк одним аркушем', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers?stop=st_0015');
    await user.click(await screen.findByLabelText('Одна наклейка з обома боками'));
    expect(previews()).toHaveLength(1);
    expect(previews()[0].querySelectorAll('svg .sticker-line')).toHaveLength(4);
    await user.click(screen.getByRole('button', { name: 'Друкувати (1 аркуш A5)' }));
    expect(printMock).toHaveBeenCalledTimes(1);
    const html = printMock.mock.calls[0][0] as string;
    expect(html).toContain('@page{size:A5 portrait;margin:0}');
    expect(html.split('<div class="sheet">').length - 1).toBe(1);
  });

  it('односторонній вузол — одразу одна наклейка; формат A4', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers?stop=st_0019');
    await screen.findByLabelText('Назва на наклейці');
    expect(previews()).toHaveLength(1);
    await user.selectOptions(screen.getByLabelText('Формат'), 'A4');
    expect(previews()[0].querySelector('svg')!.getAttribute('width')).toBe('210mm');
  });

  it('лічильник під прев\'ю кожної наклейки; друк записується в базу й оновлює статистику', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers?stop=st_0015');
    await screen.findByLabelText('Назва на наклейці');
    expect(previews()[0]).toHaveTextContent('відкриттів з QR: 12 (за 7 днів 4)');
    expect(previews()[1]).toHaveTextContent('відкриттів з QR: 0');
    const before = statsRequests.length;
    await user.click(screen.getByRole('button', { name: 'Друкувати (2 аркуші A5)' }));
    expect(printMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(printPosts).toEqual([{ stopId: 'st_0015', sides: ['a', 'b'], size: 'A5' }]));
    await waitFor(() => expect(statsRequests.length).toBe(before + 1));
    await user.click(within(previews()[1]).getByRole('button', { name: 'Завантажити SVG' }));
    await waitFor(() => expect(printPosts).toHaveLength(2));
    expect(printPosts[1]).toEqual({ stopId: 'st_0015', sides: ['b'], size: 'A5' });
  });

  it('статистика: плитки, графік по днях, період, «По годинах доби» з частинами доби', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers');
    await screen.findByRole('region', { name: 'Відкриття з QR' });
    const all = 'Підсумки: усі наклейки';
    expect(tile(all, 'Усього')).toBe('15');
    expect(tile(all, 'Сьогодні')).toBe('2');
    expect(tile(all, 'За 7 днів')).toBe('4');
    expect(tile(all, 'За 30 днів')).toBe('12');
    expect(tile(all, 'Наклейок надруковано')).toBe('1 · зі сканами 2');
    expect(screen.getByRole('button', { name: `${dayLabels(today).long}: 7 відкриттів` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${dayLabels(yesterday).long}: 1 відкриття` })).toBeInTheDocument();
    expect(statsRequests[statsRequests.length - 1]).toBe('?days=30');
    await user.click(screen.getByRole('button', { name: '7 днів' }));
    await waitFor(() => expect(statsRequests[statsRequests.length - 1]).toBe('?days=7'));

    expect(screen.queryByLabelText('Частини доби')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('По годинах доби'));
    expect(tile('Частини доби', 'Ранок')).toBe('5 · 63 %');
    expect(tile('Частини доби', 'День')).toBe('0 · 0 %');
    expect(tile('Частини доби', 'Вечір')).toBe('2 · 25 %');
    expect(tile('Частини доби', 'Ніч')).toBe('1 · 13 %');
    expect(screen.getByRole('button', { name: '08:00–09:00: 5 відкриттів' })).toBeInTheDocument();
  });

  it('статистика «Сьогодні»: ?days=1, одразу по годинах доби з частинами доби, без графіка по днях', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers');
    await screen.findByRole('region', { name: 'Відкриття з QR' });
    await user.click(screen.getByRole('button', { name: 'Сьогодні' }));
    await waitFor(() => expect(statsRequests[statsRequests.length - 1]).toBe('?days=1'));
    expect(screen.getByRole('button', { name: 'Сьогодні' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('По годинах доби')).not.toBeInTheDocument();
    expect(screen.queryByText(/^По днях/)).not.toBeInTheDocument();
    expect(screen.getAllByText('По годинах доби сьогодні · усі наклейки').length).toBeGreaterThan(0);
    expect(tile('Частини доби', 'Ранок')).toBe('5 · 63 %');
    expect(screen.getByRole('button', { name: '08:00–09:00: 5 відкриттів' })).toBeInTheDocument();
  });

  it('статистика однієї зупинки — галочкою «Лише …»', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers?stop=st_0015');
    await user.click(await screen.findByLabelText('Лише «з-д «Прожектор»»'));
    const one = 'Підсумки: зупинка «з-д «Прожектор»»';
    expect(tile(one, 'Усього')).toBe('12');
    expect(tile(one, 'Наклейок надруковано')).toBe('1 · зі сканами 1');
    expect(screen.getByRole('button', { name: `${dayLabels(yesterday).long}: 0 відкриттів` })).toBeInTheDocument();
    await user.click(screen.getByLabelText('По годинах доби'));
    expect(tile('Частини доби', 'Ніч')).toBe('0 · 0 %');
  });

  it('список усіх зупинок з відправленнями: популярні першими, лічильники, пошук, фільтр, вибір', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers');
    await screen.findByRole('region', { name: 'Зупинки' });
    const names = listNames();
    expect(names).toHaveLength(7); // «Меркурій» без відправлень — не кандидат
    expect(names.slice(0, 2)).toEqual(['з-д «Прожектор»', 'Залізничний вокзал']);
    const first = within(stopList()).getAllByRole('button')[0];
    expect(first).toHaveTextContent('12');
    expect(first).toHaveTextContent('+4 за 7 дн');
    expect(first).toHaveTextContent('Б1 12');
    expect(first).toHaveTextContent('друк 06.10');
    expect(within(stopList()).getAllByRole('button')[1]).toHaveTextContent('Одна 3');

    await user.selectOptions(screen.getByLabelText('Сортування зупинок'), 'За назвою');
    expect(listNames()).toEqual([...names].sort((a, b) => (a ?? '').localeCompare(b ?? '', 'uk')));

    await user.click(screen.getByLabelText('Лише з наклейками'));
    expect(listNames()).toEqual(['Залізничний вокзал', 'з-д «Прожектор»'].sort((a, b) => a.localeCompare(b, 'uk')));
    await user.click(screen.getByLabelText('Лише з наклейками'));

    await user.type(screen.getByLabelText('Пошук зупинки'), 'вокз');
    expect(listNames()).toEqual(['Залізничний вокзал']);
    await user.click(within(stopList()).getByRole('button'));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/stickers?stop=st_0019');
    expect(await screen.findByLabelText('Назва на наклейці')).toHaveValue('Залізничний вокзал');
    expect(within(stopList()).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});
