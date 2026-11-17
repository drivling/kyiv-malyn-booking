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
import type { AdWallSnapshot, PeopleWallSnapshot, StickerWallSnapshot } from '@/types';
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

  it('вкладка «Реклама»: три плитки «сьогодні», стрічка останніх переглядів і рядок «90 днів»', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const ads: AdWallSnapshot = {
      now,
      day: '2026-11-17',
      sticker: { today: { shown: 4, started: 3, completed: 2 }, total: { shown: 9, started: 7, completed: 5 }, people: 6 },
      dovede: {
        today: { shown: 1, started: 1, completed: 1, pages: 2 },
        total: { shown: 3, started: 2, completed: 2, pages: 5 },
        access: { admin: 1, guest: 4, public: 0 },
        todayAccess: { admin: 1, guest: 1, public: 0 },
        people: 3,
      },
      views: [
        { viewId: 'v1', placement: 'sticker', kind: 'view', stopId: 'st_0015', device: 'ios', who: 'ab12', seenBefore: 1, access: null, at: now, started: true, completed: true },
        { viewId: 'v2', placement: 'dovede', kind: 'page', stopId: null, device: 'desktop', who: 'cd34', seenBefore: 0, access: 'guest', at: now, started: false, completed: false },
      ],
    };
    const asked: string[] = [];
    server.use(
      http.get(`${TEST_API_URL}/ads/wall`, ({ request }) => {
        asked.push(new URL(request.url).search);
        return HttpResponse.json(ads);
      })
    );
    renderWall('/admin/wall?key=k123');
    await screen.findByTestId('wall-total');
    await user.click(screen.getByRole('tab', { name: 'Реклама' }));
    const region = screen.getByRole('region', { name: 'Реклама' });
    await waitFor(() => expect(within(region).getByText('Тизер на табло')).toBeInTheDocument());
    // плитки: тизер — 2 до кінця з 4 показів; ролик — 1; сторінка — 2 входи, гість і адмін
    expect(region).toHaveTextContent('2 до кінця');
    expect(region).toHaveTextContent('з 4 показів · почали 3');
    expect(region).toHaveTextContent('1 до кінця');
    expect(region).toHaveTextContent('2 входи');
    expect(region).toHaveTextContent('гості 1 · адмін 1');
    // стрічка: що сталося (для читача екрана — словами), де, з чого, хто
    const rows = within(within(region).getByRole('list', { name: 'Останні перегляди' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('з-д «Прожектор»');
    expect(rows[0]).toHaveTextContent('досмотрів');
    expect(rows[0]).toHaveTextContent('iPhone');
    expect(rows[0]).toHaveTextContent('#ab12');
    expect(rows[0]).toHaveTextContent('↻ 2-й раз');
    expect(rows[1]).toHaveTextContent('Сторінка «Доведе»');
    expect(rows[1]).toHaveTextContent('відкрив сторінку (гість)');
    expect(region).toHaveTextContent('90 днів тизер 5 з 9 · ролик 2 з 3 · сторінка 5 (гості 4) · 6 людей з наклейок');
    expect(asked[0]).toContain('key=k123');
  });

  it('новий пасажир: досмотрений тизер після старту — особливе святкування замість звичайного', async () => {
    const user = userEvent.setup();
    const views: AdWallSnapshot['views'] = [];
    const adsNow = (): AdWallSnapshot => ({
      now: new Date().toISOString(),
      day: '2026-10-06',
      sticker: { today: { shown: views.length, started: views.length, completed: views.length }, total: { shown: 1, started: 1, completed: 1 }, people: 1 },
      dovede: { today: { shown: 0, started: 0, completed: 0, pages: 0 }, total: { shown: 0, started: 0, completed: 0, pages: 0 }, access: { admin: 0, guest: 0, public: 0 }, people: 0 },
      views,
    });
    server.use(http.get(`${TEST_API_URL}/ads/wall`, () => HttpResponse.json(adsNow())));
    renderWall('/admin/wall?key=k123');
    await screen.findByTestId('wall-total');
    await user.click(screen.getByRole('button', { name: 'Почати' }));
    // скан і досмотрений тизер приходять в одному опитуванні
    views.push({ viewId: 'view-new-1', placement: 'sticker', kind: 'view', stopId: 'st_0015', device: 'android', who: 'ab12', seenBefore: 0, access: null, at: new Date().toISOString(), started: true, completed: true });
    withEvent = true;
    const cele = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(cele).toHaveTextContent('Новий пасажир!');
    expect(cele).toHaveTextContent('з-д «Прожектор»');
    expect(cele).toHaveTextContent('уперше тут — досмотрів тизер «Доведе» · нових сьогодні 1');
    expect(cele).not.toHaveTextContent('Нове відкриття з QR');
  });

  it('квиток «Доведе»: ролик на /dovede і прокомпостований талон після старту — святкування з талоном', async () => {
    const user = userEvent.setup();
    const views: AdWallSnapshot['views'] = [];
    const adsNow = (): AdWallSnapshot => ({
      now: new Date().toISOString(),
      day: '2026-10-06',
      sticker: { today: { shown: 0, started: 0, completed: 0 }, total: { shown: 0, started: 0, completed: 0 }, people: 0 },
      dovede: {
        today: { shown: 2, started: 2, completed: 2, pages: 0, punched: views.length },
        total: { shown: 2, started: 2, completed: 2, pages: 0, punched: views.length },
        access: { admin: 0, guest: 0, public: 0 },
        people: 2,
      },
      views,
    });
    server.use(http.get(`${TEST_API_URL}/ads/wall`, () => HttpResponse.json(adsNow())));
    renderWall('/admin/wall?key=k123');
    await screen.findByTestId('wall-total');
    await user.click(screen.getByRole('button', { name: 'Почати' }));
    views.push({ viewId: 'intro-view-1', placement: 'dovede', kind: 'view', stopId: null, device: 'ios', who: 'ef56', number: 7, seenBefore: 0, access: 'guest', at: new Date().toISOString(), started: true, completed: true, punched: true });
    const cele = await screen.findByRole('status', {}, { timeout: 3000 });
    expect(cele).toHaveTextContent('Перший квиток сьогодні!');
    expect(cele).toHaveTextContent('Квиток на проїзд');
    expect(cele).toHaveTextContent('щасливий');
    expect(cele).toHaveTextContent('досмотрів ролик · iPhone · гість із паролем · пасажир № 7 з наклейок · квитків сьогодні 1');
    expect(cele.querySelectorAll('.wall-talon-hole')).toHaveLength(3);
  });

  it('вкладки перемикаються по колу без кінця; після ручного вибору смужка йде стільки, скільки тримається вкладка', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/wall?key=k123']}>
        <Routes>
          <Route path="/admin/wall" element={<StickerWallPage pollMs={60_000} tabMs={120} tabPauseMs={500} />} />
        </Routes>
      </MemoryRouter>
    );
    await screen.findByTestId('wall-total');
    const selected = () => screen.getByRole('tab', { selected: true }).textContent;
    const timer = () => document.querySelector<HTMLElement>('.wall-tabs-timer');
    // два повних кола — ніде не зупиняється
    const seen: string[] = [];
    await waitFor(
      () => {
        const t = selected() ?? '';
        if (seen[seen.length - 1] !== t) seen.push(t);
        expect(seen.length).toBeGreaterThanOrEqual(9);
      },
      { timeout: 4000, interval: 20 }
    );
    const order = ['Топ дня', 'Зараз ростуть', 'Реклама', 'Люди'];
    for (let i = 1; i < seen.length; i += 1) {
      expect(order.indexOf(seen[i])).toBe((order.indexOf(seen[i - 1]) + 1) % 4);
    }
    expect(timer()?.style.animationDuration).toBe('120ms');
    // рукою «Реклама»: смужка — 500 мс, вкладка тримається стільки ж, далі коло йде само
    await user.click(screen.getByRole('tab', { name: 'Реклама' }));
    expect(selected()).toBe('Реклама');
    expect(timer()?.style.animationDuration).toBe('500ms');
    await new Promise((r) => setTimeout(r, 300));
    expect(selected()).toBe('Реклама');
    await waitFor(() => expect(selected()).toBe('Люди'), { timeout: 1000 });
    expect(timer()?.style.animationDuration).toBe('120ms');
    await waitFor(() => expect(selected()).toBe('Топ дня'), { timeout: 1000 });
  });

  it('у шапці — місто наклейок: ?city=Korosten — «КОРОСТЕНЬ», без нього — «МАЛИН»', async () => {
    const { unmount } = renderWall('/admin/wall?key=k123&city=Korosten');
    await screen.findByTestId('wall-total');
    expect(screen.getAllByText('КОРОСТЕНЬ').length).toBeGreaterThan(0);
    expect(screen.queryByText('МАЛИН')).not.toBeInTheDocument();
    unmount();
    renderWall('/admin/wall?key=k123');
    await screen.findByTestId('wall-total');
    expect(screen.getAllByText('МАЛИН').length).toBeGreaterThan(0);
  });

  it('вкладка «Люди»: нові й ті, що повернулись, номер останнього до рубежу, стрічка пасажирів', async () => {
    const user = userEvent.setup();
    const now = new Date().toISOString();
    const people: PeopleWallSnapshot = {
      now,
      day: '2026-10-06',
      total: 96,
      today: { new: 3, returned: 2 },
      yesterday: { new: 5 },
      returned7d: 9,
      d90: { new: 40, returned: 10, multiStop: 6, teaser: 21 },
      people: [
        { number: 96, who: 'ab12', firstStopId: 'st_0015', lastStopId: 'st_0015', stops: 1, scans: 1, scanDays: 1, returns: 0, isNew: true, kind: 'scan', at: now, teaser: true },
        { number: 37, who: 'cd34', firstStopId: 'st_0019', lastStopId: 'st_0015', stops: 3, scans: 7, scanDays: 4, returns: 1, isNew: false, kind: 'scan', at: now, teaser: false },
        { number: 12, who: 'ef56', firstStopId: 'st_0019', lastStopId: 'st_0019', stops: 1, scans: 1, scanDays: 1, returns: 2, isNew: false, kind: 'return', at: now, teaser: false },
      ],
    };
    server.use(http.get(`${TEST_API_URL}/transport/sticker-wall/people`, () => HttpResponse.json(people)));
    renderWall('/admin/wall?key=k123');
    await screen.findByTestId('wall-total');
    await user.click(screen.getByRole('tab', { name: 'Люди' }));
    const region = screen.getByRole('region', { name: 'Люди' });
    await waitFor(() => expect(within(region).getByText('Нові пасажири')).toBeInTheDocument());
    expect(region).toHaveTextContent('3 сьогодні');
    expect(region).toHaveTextContent('вчора 5');
    expect(region).toHaveTextContent('2 людини');
    expect(region).toHaveTextContent('за 7 днів 9');
    expect(region).toHaveTextContent('№ 96 останній');
    expect(region).toHaveTextContent('до № 100 — ще 4');
    const rows = within(within(region).getByRole('list', { name: 'Останні пасажири' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('№96');
    expect(rows[0]).toHaveTextContent('з-д «Прожектор»');
    expect(rows[0]).toHaveTextContent('новий');
    expect(rows[1]).toHaveTextContent('↻ 4-й день');
    expect(rows[1]).toHaveTextContent('уперше — Залізничний вокзал');
    expect(rows[1]).toHaveTextContent('3');
    expect(rows[2]).toHaveTextContent('Залізничний вокзал');
    expect(rows[2]).toHaveTextContent('↻ на сайті');
    expect(region).toHaveTextContent('90 днів нових 40 · повертались 10 (25 %) · на ≥ 2 зупинках 6 · досмотріли тизер 21');
  });

  it('застарілий ключ — повідомлення, як отримати нове посилання', async () => {
    renderWall('/admin/wall?key=old');
    expect(await screen.findByText(/Посилання застаріло/)).toBeInTheDocument();
  });
});
