/**
 * Вкладка «Наклейки зупинок»: зупинка з ?stop=, автоматичний розподіл ліній по боках дороги,
 * ручне перекидання лінії, «одна наклейка», друк (друк через iframe замокано).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import { STICKER_DATASET } from './stopSticker/stickerTestDataset';
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

const previews = () => screen.queryAllByRole('figure');

beforeEach(() => {
  printMock.mockClear();
  // jsdom не має scrollIntoView, а Combobox прокручує підсвічену опцію.
  Element.prototype.scrollIntoView = vi.fn();
  server.use(http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(STICKER_DATASET)));
});

describe('StopStickerTab', () => {
  it('зупинка з ?stop= — дві наклейки, по одній на кожен бік дороги', async () => {
    renderTab('/admin/stickers?stop=st_0015');
    expect(await screen.findByLabelText('Назва на наклейці')).toHaveValue('з-д «Прожектор»');
    expect(previews().map((f) => within(f).getByText(/^Бік/).textContent)).toEqual([
      'Бік 1 · напрямок: Малинівський круг',
      'Бік 2 · напрямок: Центр · Базарна площа',
    ]);
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

  it('вибір зупинки пише ?stop= в адресу; у списку лише зупинки з відправленнями', async () => {
    const user = userEvent.setup();
    renderTab('/admin/stickers');
    const input = await screen.findByRole('combobox', { name: 'Зупинка' });
    expect(previews()).toHaveLength(0);
    await user.click(input);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('з-д «Прожектор» — №5, №11');
    expect(options.some((o) => o?.startsWith('м-н «Меркурій»'))).toBe(false);
    await user.click(screen.getByRole('option', { name: 'з-д «Прожектор» — №5, №11' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/admin/stickers?stop=st_0015');
    expect(await screen.findByLabelText('Назва на наклейці')).toHaveValue('з-д «Прожектор»');
  });
});
