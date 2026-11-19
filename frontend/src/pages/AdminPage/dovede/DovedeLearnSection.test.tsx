/**
 * Розділ «Навчання» (Docs/dovede-admin-roadmap.md, крок 7): список кампаній зі станом і витратою, «Нова кампанія» —
 * заготовка → «Оцінити» → погоджений бюджет → «Почати», керування кампанією; години кампанії рядком і клітинками.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw/server';
import { TEST_API_URL } from '@/test/msw/handlers';
import type { DovedeCampaign, DovedeCampaignPreset, DovedeCampaignPreview, DovedeQualityReport } from '@/types';
import { DovedeLearnSection } from './DovedeLearnSection';
import { formatHours, hoursText, parseHours } from './learn/hours';
import { humanLink } from './learn/campaignText';

const QUALITY: DovedeQualityReport = {
  places: 120,
  okPlaces: 2,
  items: [
    {
      city: 'Kyiv',
      key: 'теу',
      label: 'Торговельно-економічний університет',
      reasons: [
        { code: 'next_to_point', text: '5 хв від метро «Академмістечко» — можливо, Google знайшов саму точку або щось поруч' },
        { code: 'near_far_points', text: '5 хв від метро «Академмістечко» і 8 хв від вокзалу — так близько до обох не буває' },
      ],
      routes: [
        { origin: 'kyiv.pas', originLabel: 'вокзал Київ-Пасажирський', dir: 'to', dayType: 'weekday', hour: 9, minutes: 8, rides: 1 },
        { origin: 'kyiv.akadem', originLabel: 'метро «Академмістечко»', dir: 'to', dayType: 'weekday', hour: 9, minutes: 5, rides: 1 },
      ],
    },
    {
      city: 'Zhytomyr',
      key: 'польова 12',
      label: 'Польова 12',
      reasons: [{ code: 'walk_only', text: 'лише пішки 30 хв від: автовокзал Житомир-1 — транспорту Google не знайшов' }],
      routes: [{ origin: 'zhytomyr.avtovokzal', originLabel: 'автовокзал Житомир-1', dir: 'from', dayType: 'saturday', hour: 11, minutes: 30, rides: 0 }],
    },
  ],
};

const ZT_POINTS = [{ id: 'zhytomyr.avtovokzal', label: 'автовокзал Житомир-1' }];
const KYIV_POINTS = [
  { id: 'kyiv.akadem', label: 'метро «Академмістечко»' },
  { id: 'kyiv.pas', label: 'вокзал Київ-Пасажирський' },
];

const PRESETS: DovedeCampaignPreset[] = [
  {
    id: 'learn',
    title: 'Навчити місто',
    help: 'Від точки висадки до місць, куди їдуть найчастіше.',
    custom: false,
    cities: [
      { city: 'Kyiv', name: 'Київ', origins: ['kyiv.akadem', 'kyiv.pas'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 1, points: KYIV_POINTS },
      { city: 'Zhytomyr', name: 'Житомир', origins: ['zhytomyr.avtovokzal'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 2, points: ZT_POINTS },
    ],
  },
  {
    id: 'modes',
    title: 'Види транспорту',
    help: 'Пари з кожним видом транспорту Києва.',
    custom: false,
    cities: [{ city: 'Kyiv', name: 'Київ', origins: [], dirs: ['to'], main: 'weekday@09', extra: '', maxDepth: 0, points: KYIV_POINTS }],
  },
  {
    id: 'custom',
    title: 'Свій список',
    help: 'Місця, які ви напишете.',
    custom: true,
    cities: [{ city: 'Zhytomyr', name: 'Житомир', origins: ['zhytomyr.avtovokzal'], dirs: ['to', 'from'], main: 'weekday@09', extra: '', maxDepth: 0, points: ZT_POINTS }],
  },
];

const PLAN = { city: 'Zhytomyr' as const, origins: ZT_POINTS, dirs: ['to' as const, 'from' as const], main: 'weekday@09', extra: 'weekday@17', maxDepth: 2, seeds: 53 };

const campaign = (over: Partial<DovedeCampaign> = {}): DovedeCampaign => ({
  id: 1,
  city: 'Zhytomyr',
  preset: 'learn',
  title: 'Навчити місто — Житомир',
  status: 'running',
  waitReason: null,
  waitUntil: null,
  stopReason: null,
  budget: 550,
  dailyBudget: 200,
  googleCalls: 120,
  spentToday: 40,
  asked: 150,
  ok: 118,
  fromDb: 30,
  noRoute: 32,
  failed: 0,
  places: 140,
  left: 60,
  lastError: null,
  plan: PLAN,
  report: null,
  createdAt: '2026-11-19T08:00:00.000Z',
  startedAt: '2026-11-19T08:00:00.000Z',
  finishedAt: null,
  ...over,
});

const PREVIEW: DovedeCampaignPreview = {
  title: 'Навчити місто — Житомир',
  plan: PLAN,
  estimate: { places: 106, asks: 106, google: 105, free: 1, skipped: 0, extraSlots: 1, maxDepth: 2, low: 184, high: 550, budget: 550, dailyBudget: 200, days: 3, cap: 500, callsToday: 10, reserve: 100 },
};

function mock(campaigns: DovedeCampaign[] = []) {
  const calls: Array<{ path: string; body: unknown }> = [];
  let list = [...campaigns];
  server.use(
    http.get(`${TEST_API_URL}/admin/dovede/city/quality`, ({ request }) => {
      const city = new URL(request.url).searchParams.get('city');
      calls.push({ path: `quality:${city ?? ''}`, body: null });
      return HttpResponse.json(city ? { ...QUALITY, items: QUALITY.items.filter((i) => i.city === city) } : QUALITY);
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/place/ok`, async ({ request }) => {
      const body = await request.json();
      calls.push({ path: 'ok', body });
      return HttpResponse.json(body);
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/place/archive`, async ({ request }) => {
      const body = await request.json();
      calls.push({ path: 'archive', body });
      return HttpResponse.json({ ...(body as object), routes: 4 });
    }),
    http.get(`${TEST_API_URL}/admin/dovede/city/campaigns/presets`, () => HttpResponse.json({ presets: PRESETS })),
    http.get(`${TEST_API_URL}/admin/dovede/city/campaigns`, () => HttpResponse.json({ campaigns: list, google: { calls: 140, cap: 500, reserve: 100 } })),
    http.post(`${TEST_API_URL}/admin/dovede/city/campaigns/preview`, async ({ request }) => {
      calls.push({ path: 'preview', body: await request.json() });
      return HttpResponse.json(PREVIEW);
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/campaigns`, async ({ request }) => {
      const body = (await request.json()) as { budget: number; dailyBudget: number };
      calls.push({ path: 'create', body });
      const c = campaign({ id: 7, googleCalls: 0, spentToday: 0, asked: 0, ok: 0, fromDb: 0, noRoute: 0, places: 106, left: 106, budget: body.budget, dailyBudget: body.dailyBudget });
      list = [c, ...list];
      return HttpResponse.json(c, { status: 201 });
    }),
    http.post(`${TEST_API_URL}/admin/dovede/city/campaigns/:id/action`, async ({ request, params }) => {
      const body = (await request.json()) as { action: string; budget?: number };
      calls.push({ path: `action:${params.id}`, body });
      const c = list.find((x) => x.id === Number(params.id))!;
      const next = { ...c, ...(body.action === 'pause' ? { status: 'paused' } : body.action === 'cancel' ? { status: 'cancelled', stopReason: 'cancelled' } : body.action === 'extend' ? { budget: body.budget!, status: 'running', stopReason: null } : {}) };
      list = list.map((x) => (x.id === c.id ? next : x));
      return HttpResponse.json(next);
    }),
  );
  return calls;
}

/** запити без звіту якості (його розділ питає сам при відкритті) */
const actions = (calls: Array<{ path: string; body: unknown }>) => calls.filter((c) => !c.path.startsWith('quality:'));

const cityRadio = (name: string) => within(screen.getByRole('radiogroup', { name: 'Місто' })).getByRole('radio', { name });

const mainRow = (day: string) => within(screen.getByRole('group', { name: `Години для кожного місця: ${day}` }));

const renderSection = () =>
  render(
    <MemoryRouter>
      <DovedeLearnSection />
    </MemoryRouter>,
  );

afterEach(() => vi.restoreAllMocks());

describe('години кампанії', () => {
  it('рядок ↔ набір ↔ текст', () => {
    const set = parseHours('saturday@11, weekday@17,weekday@09:00,nonsense,sunday@25');
    expect([...set].sort()).toEqual(['saturday@11', 'weekday@09', 'weekday@17']);
    expect(formatHours(set)).toBe('weekday@09,weekday@17,saturday@11');
    expect(hoursText('weekday@09,weekday@17,saturday@11')).toBe('будні 09:00, 17:00 · субота 11:00');
    expect(hoursText('')).toBe('');
  });
});

describe('DovedeLearnSection', () => {
  it('кампанії: відкриті вгорі зі станом і витратою, завершені нижче; облік Google за сьогодні', async () => {
    mock([
      campaign({ id: 3, title: 'Свій список — Київ', status: 'done', stopReason: 'finished', finishedAt: '2026-11-19T09:00:00.000Z', left: 0 }),
      campaign({ id: 2, status: 'waiting', waitReason: 'daily', waitUntil: '2026-11-19T22:01:00.000Z' }),
    ]);
    renderSection();
    const waiting = await screen.findByRole('article', { name: 'Навчити місто — Житомир' });
    expect(within(waiting).getByText('Чекає')).toBeInTheDocument();
    expect(within(waiting).getByText(/денну частку кампанії витрачено — продовжить 20 листопада о 00:01/)).toBeInTheDocument();
    expect(within(waiting).getByText('Google: 120 з 550')).toBeInTheDocument();
    expect(within(waiting).getByText('сьогодні 40 з 200')).toBeInTheDocument();
    expect(within(waiting).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '120');
    expect(within(waiting).getByText(/від: автовокзал Житомир-1 · туди й назад · будні 09:00; для знайдених ще будні 17:00 · нові місця з відповідей: 2 кроки/)).toBeInTheDocument();
    expect(within(waiting).getByRole('button', { name: 'Спробувати зараз' })).toBeInTheDocument();

    const done = screen.getByRole('article', { name: 'Свій список — Київ' });
    expect(within(done).getByText('Завершено')).toBeInTheDocument();
    expect(within(done).getByRole('button', { name: 'Сховати' })).toBeInTheDocument();
    expect(within(done).queryByRole('button', { name: 'Пауза' })).toBeNull();
    // відкрита — перша
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toBe(waiting);
    expect(screen.getByRole('heading', { name: 'Завершені' })).toBeInTheDocument();
    expect(screen.getByText(/Google сьогодні:/).textContent).toContain('140 з 500 · 100 лишаємо людям — кампанії питають, лише поки витрачено менше ніж 400');
  });

  it('нова кампанія: Житомир, «Навчити місто» → «Оцінити» → погоджений бюджет → «Почати»', async () => {
    const calls = mock();
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByText(/Кампаній ще не було/)).toBeInTheDocument();
    await screen.findByRole('radio', { name: /Навчити місто/ });
    expect(cityRadio('Житомир')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: /Види транспорту/ })).toBeNull();
    expect(mainRow('Будні').getByRole('button', { name: 'Будні 9:00' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Почати/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Оцінити' }));
    expect(actions(calls)[0]).toEqual({
      path: 'preview',
      body: { preset: 'learn', city: 'Zhytomyr', options: { origins: ['zhytomyr.avtovokzal'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 2 } },
    });
    const est = await screen.findByRole('group', { name: 'Оцінка кампанії' });
    expect(within(est).getByText('184–550')).toBeInTheDocument();
    expect(screen.getByText(/Сьогодні Google: 10 з 500; 100 лишаємо людям/)).toBeInTheDocument();
    const budget = screen.getByLabelText('Погоджую запитів до Google');
    expect(budget).toHaveValue(550);
    expect(screen.getByText(/≈ 3 дні/)).toBeInTheDocument();

    await user.clear(budget);
    await user.type(budget, '150');
    expect(screen.getByText(/Менше за нижню оцінку/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Почати: до 150 запитів до Google' }));
    await screen.findByText(/Почато: «Навчити місто — Житомир»/);
    expect(actions(calls)[1]).toEqual({ path: 'create', body: { preset: 'learn', city: 'Zhytomyr', options: { origins: ['zhytomyr.avtovokzal'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 2 }, budget: 150, dailyBudget: 200 } });
    expect(await screen.findByRole('article', { name: 'Навчити місто — Житомир' })).toBeInTheDocument();
    // оцінку використано — почати вдруге те саме не можна, поки не оцінено знову
    expect(screen.queryByRole('button', { name: /Почати/ })).toBeNull();
  });

  it('зміна параметрів скидає оцінку; Київ — свої точки й заготовки; «Свій список» — лише з місцями', async () => {
    const calls = mock();
    const user = userEvent.setup();
    renderSection();
    await screen.findByRole('radio', { name: /Навчити місто/ });
    await user.click(screen.getByRole('button', { name: 'Оцінити' }));
    await screen.findByRole('group', { name: 'Оцінка кампанії' });
    await user.click(mainRow('Субота').getByRole('button', { name: 'Субота 11:00' }));
    expect(screen.queryByRole('group', { name: 'Оцінка кампанії' })).toBeNull();
    // додаткова година, що вже серед основних, — недоступна
    await user.click(mainRow('Будні').getByRole('button', { name: 'Будні 9:00' }));
    await user.click(mainRow('Будні').getByRole('button', { name: 'Будні 9:00' }));
    const extra = screen.getByRole('group', { name: 'Ще години — лише для місць, куди дорогу знайдено: Будні' });
    expect(within(extra).getByRole('button', { name: 'Будні 9:00' })).toBeDisabled();

    await user.click(cityRadio('Київ'));
    expect(screen.getByRole('radio', { name: /Види транспорту/ })).toBeInTheDocument();
    expect(screen.getByLabelText('метро «Академмістечко»')).toBeChecked();
    await user.click(screen.getByLabelText('метро «Академмістечко»'));
    await user.click(screen.getByLabelText('вокзал Київ-Пасажирський'));
    expect(screen.getByRole('button', { name: 'Оцінити' })).toBeDisabled();
    expect(screen.getByText(/Виберіть хоч одну точку/)).toBeInTheDocument();

    await user.click(cityRadio('Житомир'));
    await user.click(screen.getByRole('radio', { name: /Свій список/ }));
    expect(screen.getByRole('button', { name: 'Оцінити' })).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'Житній ринок');
    await user.click(screen.getByRole('button', { name: 'Оцінити' }));
    await waitFor(() => expect(calls[calls.length - 1]?.body).toMatchObject({ preset: 'custom', options: { places: 'Житній ринок', maxDepth: 0 } }));
  });

  it('керування: пауза; скасувати — після підтвердження; додати бюджету до вичерпаної', async () => {
    const calls = mock([campaign({ id: 5 }), campaign({ id: 4, title: 'Дообучити: вечір — Київ', status: 'done', stopReason: 'budget', googleCalls: 100, budget: 100, left: 12 })]);
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    renderSection();
    const running = await screen.findByRole('article', { name: 'Навчити місто — Житомир' });
    expect(within(running).getByText('Іде')).toBeInTheDocument();

    await user.click(within(running).getByRole('button', { name: 'Скасувати' }));
    expect(actions(calls)).toEqual([]);
    expect(confirm).toHaveBeenCalledTimes(1);

    await user.click(within(running).getByRole('button', { name: 'Пауза' }));
    await waitFor(() => expect(actions(calls)).toEqual([{ path: 'action:5', body: { action: 'pause' } }]));
    expect(await within(running).findByText('На паузі')).toBeInTheDocument();

    const out = screen.getByRole('article', { name: 'Дообучити: вечір — Київ' });
    expect(within(out).getByText('Бюджет вичерпано')).toBeInTheDocument();
    expect(within(out).getByText('у черзі ще питань: 12')).toBeInTheDocument();
    await user.click(within(out).getByRole('button', { name: 'Додати бюджету' }));
    const more = within(out).getByLabelText('Скільки запитів додати');
    await user.clear(more);
    await user.type(more, '50');
    await user.click(within(out).getByRole('button', { name: 'Додати' }));
    await waitFor(() => expect(calls[calls.length - 1]).toEqual({ path: 'action:4', body: { action: 'extend', budget: 150 } }));
    // знову відкрита — переїхала до відкритих
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Дообучити: вечір — Київ' })).getByText('Іде')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Завершені' })).toBeNull();
  });

  it('«Освіжити застаріле»: годин і глибини не вибирають — як у застарілих відповідях', async () => {
    mock();
    server.use(
      http.get(`${TEST_API_URL}/admin/dovede/city/campaigns/presets`, () =>
        HttpResponse.json({
          presets: [
            ...PRESETS,
            { id: 'refresh', title: 'Освіжити застаріле', help: 'Старі відповіді Google — знову.', custom: false, ownSlots: true, cities: [{ ...PRESETS[0].cities[1], extra: '', maxDepth: 0 }] },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('radio', { name: /Освіжити застаріле/ }));
    expect(screen.queryByRole('group', { name: /Години для кожного місця/ })).toBeNull();
    expect(screen.queryByLabelText(/Нові місця з відповідей/)).toBeNull();
    expect(screen.getByText(/Точки, напрямки й години — ті самі, що в застарілих відповідях/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Напрямок' })).toBeNull();
    expect(screen.queryByText('Від яких точок')).toBeNull();
  });

  it('якість: підозрілі місця з причинами; «Відкрити як людина», «Нормально», «В архів» (з підтвердженням); фільтр міста', async () => {
    const calls = mock();
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSection();
    const panel = await screen.findByRole('region', { name: 'Якість: підозрілі дороги' });
    expect(await within(panel).findByText('Перевірено місць: 120 · підозрілих: 2 · визнано нормальними раніше: 2')).toBeInTheDocument();
    expect(within(panel).getByText(/так близько до обох не буває/)).toBeInTheDocument();
    expect(within(panel).getByText(/вокзал Київ-Пасажирський → 8 хв \(будні 09:00\); метро «Академмістечко» → 5 хв/)).toBeInTheDocument();
    // найкоротша дорога — та, яку відкриваємо як людина
    expect(within(panel).getAllByRole('link', { name: 'Відкрити як людина' })[0]).toHaveAttribute('href', '/dovede?f=kyiv.akadem&t=city.Kyiv&td=%D0%A2%D0%BE%D1%80%D0%B3%D0%BE%D0%B2%D0%B5%D0%BB%D1%8C%D0%BD%D0%BE-%D0%B5%D0%BA%D0%BE%D0%BD%D0%BE%D0%BC%D1%96%D1%87%D0%BD%D0%B8%D0%B9+%D1%83%D0%BD%D1%96%D0%B2%D0%B5%D1%80%D1%81%D0%B8%D1%82%D0%B5%D1%82');

    await user.click(within(panel).getByRole('button', { name: 'Нормально: Торговельно-економічний університет' }));
    await within(panel).findByText('«Торговельно-економічний університет» (Київ) — нормально, більше не показуємо.');
    expect(actions(calls)).toEqual([{ path: 'ok', body: { city: 'Kyiv', key: 'теу', ok: true } }]);
    expect(within(panel).queryByText('Торговельно-економічний університет')).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'В архів: Польова 12' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    await within(panel).findByText('«Польова 12» (Житомир) — в архіві, доріг: 4.');
    expect(actions(calls)[1]).toEqual({ path: 'archive', body: { city: 'Zhytomyr', key: 'польова 12', action: 'archive' } });
    expect(await within(panel).findByText('Підозрілих доріг немає.')).toBeInTheDocument();

    await user.click(within(panel).getByRole('radio', { name: 'Київ' }));
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('quality:Kyiv'));
  });
});

describe('«Відкрити як людина»', () => {
  it('Київ — точка своїм id, місце словами; Житомир — поїздка з Малина; назад — місце першим', () => {
    expect(humanLink({ city: 'Kyiv', label: 'Охматдит' }, { origin: 'kyiv.pas', dir: 'to' })).toBe('/dovede?f=kyiv.pas&t=city.Kyiv&td=%D0%9E%D1%85%D0%BC%D0%B0%D1%82%D0%B4%D0%B8%D1%82');
    expect(humanLink({ city: 'Kyiv', label: 'Охматдит' }, { origin: 'kyiv.akadem', dir: 'from' })).toBe('/dovede?f=city.Kyiv&fd=%D0%9E%D1%85%D0%BC%D0%B0%D1%82%D0%B4%D0%B8%D1%82&t=kyiv.akadem');
    expect(humanLink({ city: 'Zhytomyr', label: 'Польова 12' }, { origin: 'zhytomyr.avtovokzal', dir: 'to' })).toBe('/dovede?f=malyn.avtostantsiya&t=city.Zhytomyr&td=%D0%9F%D0%BE%D0%BB%D1%8C%D0%BE%D0%B2%D0%B0+12');
  });
});

describe('черга кампаній', () => {
  it('кампанія за іншою — «У черзі після …», не «Іде»', async () => {
    mock([campaign({ id: 8, title: 'Свій список — Київ', googleCalls: 0, asked: 0, queuedBehind: { id: 7, title: 'Дообучити: вечір — Житомир' } }), campaign({ id: 7, title: 'Дообучити: вечір — Житомир' })]);
    renderSection();
    const queued = await screen.findByRole('article', { name: 'Свій список — Київ' });
    expect(within(queued).getByText('У черзі')).toBeInTheDocument();
    expect(within(queued).getByText(/після «Дообучити: вечір — Житомир» — сервер веде одну кампанію за раз/)).toBeInTheDocument();
    expect(queued).not.toHaveClass('is-active');
    const leading = screen.getByRole('article', { name: 'Дообучити: вечір — Житомир' });
    expect(within(leading).getByText('Іде')).toBeInTheDocument();
    expect(leading).toHaveClass('is-active');
  });
});
