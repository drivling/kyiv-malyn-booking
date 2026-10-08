/**
 * Віджет на стіну: без ключа — підказка; з ключем — табло з сьогоднішніми лічильниками, «Почати»,
 * нове відкриття після старту — святкування з назвою зупинки; налаштування з дотику; застарілий ключ.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { StickerWallSnapshot } from '@/types';
import { STICKER_DATASET } from '@/pages/AdminPage/stopSticker/stickerTestDataset';
import { StickerWallPage } from './StickerWallPage';

const H = () => Array.from({ length: 24 }, () => 0);
let withEvent = false;
let requests: string[] = [];

function snapshot(after: number): StickerWallSnapshot {
  const extra = withEvent ? 1 : 0;
  return {
    now: new Date().toISOString(),
    day: '2026-10-06',
    total: 5 + extra,
    yesterdaySameTime: 2,
    hourly: H(),
    stops: [
      { stopId: 'st_0019', today: 3, lastHour: 1, last3h: 2, lastAt: new Date(Date.now() - 600_000).toISOString(), hourly: H() },
      { stopId: 'st_0015', today: 2 + extra, lastHour: extra, last3h: 1 + extra, lastAt: new Date().toISOString(), hourly: H() },
    ],
    events: withEvent && after > 0 ? [{ id: 11, stopId: 'st_0015', side: 'a', createdAt: new Date().toISOString() }] : [],
    lastId: 10 + extra,
    bestDay: null,
  };
}

function renderWall(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/admin/wall" element={<StickerWallPage pollMs={80} />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  withEvent = false;
  requests = [];
  localStorage.clear();
  server.use(
    http.get(`${TEST_API_URL}/transport/dataset`, () => HttpResponse.json(STICKER_DATASET)),
    http.get(`${TEST_API_URL}/transport/sticker-wall`, ({ request }) => {
      const u = new URL(request.url);
      requests.push(u.search);
      if (u.searchParams.get('key') !== 'k123') return HttpResponse.json({ error: 'Invalid wall key' }, { status: 403 });
      return HttpResponse.json(snapshot(Number(u.searchParams.get('after')) || 0));
    })
  );
});

afterEach(() => {
  localStorage.clear();
});

describe('StickerWallPage', () => {
  it('без ключа — підказка відкрити посилання з адмінки', () => {
    renderWall('/admin/wall');
    expect(screen.getByText(/Відкрийте посилання з адмінки/)).toBeInTheDocument();
  });

  it('табло, «Почати», нове відкриття після старту — святкування з лічильником зупинки', async () => {
    const user = userEvent.setup();
    renderWall('/admin/wall?key=k123');
    expect(await screen.findByTestId('wall-total')).toHaveTextContent('5');
    expect(screen.getByText('▲ +3 до вчора на цю пору')).toBeInTheDocument();
    const list = screen.getByRole('region', { name: 'Топ дня' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('Залізничний вокзал');
    expect(localStorage.getItem('stickerWallKey')).toBe('k123');

    // до старту нові скани не святкуються (звук ще не дозволений браузером)
    await user.click(screen.getByRole('button', { name: 'Почати' }));
    expect(screen.queryByRole('button', { name: 'Почати' })).not.toBeInTheDocument();
    withEvent = true;
    const cele = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(cele).toHaveTextContent('Нове відкриття з QR');
    expect(cele).toHaveTextContent('з-д «Прожектор»');
    expect(cele).toHaveTextContent('сьогодні вже 3 відкриття');
    await waitFor(() => expect(requests.some((q) => q.includes('after=10'))).toBe(true));
  });

  it('дотик показує налаштування; звук вимикається й запам\'ятовується', async () => {
    const user = userEvent.setup();
    renderWall('/admin/wall?key=k123');
    await screen.findByTestId('wall-total');
    await user.click(screen.getByRole('button', { name: 'Почати' }));
    await user.click(screen.getByTestId('wall-total'));
    const controls = screen.getByRole('group', { name: 'Налаштування віджета' });
    await user.click(within(controls).getByRole('button', { name: /Звук увімкнено/ }));
    expect(within(controls).getByRole('button', { name: /Без звуку/ })).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(localStorage.getItem('stickerWallSettings') ?? '{}')).toMatchObject({ sound: false });
    // вкладку можна перемкнути рукою — без відкриття налаштувань
    await user.click(screen.getByRole('tab', { name: 'Зараз ростуть' }));
    expect(screen.getByRole('region', { name: 'Зараз ростуть' })).toBeInTheDocument();
  });

  it('застарілий ключ — повідомлення, як отримати нове посилання', async () => {
    renderWall('/admin/wall?key=old');
    expect(await screen.findByText(/Посилання застаріло/)).toBeInTheDocument();
  });
});
