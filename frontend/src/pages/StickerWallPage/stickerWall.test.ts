import { describe, expect, it } from 'vitest';
import type { AdWallSnapshot, StickerWallSnapshot } from '@/types';
import {
  adWhen,
  agoLabel,
  buildCelebrations,
  buildNewcomerCelebrations,
  buildTicketCelebrations,
  freshNewcomers,
  freshTickets,
  newcomerHeadline,
  nextPassengerMilestone,
  growingStops,
  isNightHour,
  isQuietHour,
  kyivClock,
  plural,
  recentHours,
  textOn,
  topStops,
  wallStops,
  wallUrl,
  whoHue,
  withNewcomers,
  type Celebration,
  type StopInfo,
} from './stickerWall';

const H = () => Array.from({ length: 24 }, () => 0);
const dir = new Map<string, StopInfo>([
  ['st_0019', { name: 'Залізничний вокзал', lines: [{ routeId: '3', color: '#1f9d55' }], color: '#1f9d55' }],
  ['st_0049', { name: 'м-н «Промінь»', lines: [{ routeId: '7', color: '#f08c1a' }], color: '#f08c1a' }],
  ['st_0015', { name: 'з-д «Прожектор»', lines: [{ routeId: '5', color: '#2a6fdb' }], color: '#2a6fdb' }],
]);

function snap(over: Partial<StickerWallSnapshot> = {}): StickerWallSnapshot {
  return {
    now: '2026-10-06T10:00:00.000Z',
    day: '2026-10-06',
    total: 12,
    yesterdaySameTime: 5,
    hourly: H(),
    stops: [
      { stopId: 'st_0019', today: 6, lastHour: 0, last3h: 2, lastAt: '2026-10-06T08:00:00.000Z', hourly: H() },
      { stopId: 'st_0049', today: 4, lastHour: 2, last3h: 3, lastAt: '2026-10-06T09:55:00.000Z', hourly: H() },
      { stopId: 'st_0015', today: 2, lastHour: 0, last3h: 0, lastAt: '2026-10-06T05:00:00.000Z', hourly: H() },
    ],
    events: [],
    lastId: 40,
    bestDay: { day: '2026-10-01', count: 20 },
    ...over,
  };
}

describe('зупинки віджета', () => {
  it('назви й кольори з датасету; топ за сьогодні, «ростуть» — за годину, тихі 3 год — ні', () => {
    const stops = wallStops(snap(), dir);
    expect(stops[1]).toMatchObject({ name: 'м-н «Промінь»', color: '#f08c1a' });
    expect(topStops(stops).map((s) => s.stopId)).toEqual(['st_0019', 'st_0049', 'st_0015']);
    expect(growingStops(stops).map((s) => s.stopId)).toEqual(['st_0049', 'st_0019']);
    expect(wallStops(snap({ stops: [{ ...snap().stops[0], stopId: 'st_gone' }] }), dir)[0].name).toBe('st_gone');
  });

  it('останні години для міні-графіка — через північ', () => {
    const hourly = H();
    hourly[23] = 2;
    hourly[0] = 1;
    expect(recentHours(hourly, 1, 3)).toEqual([
      { hour: 23, value: 2 },
      { hour: 0, value: 1 },
      { hour: 1, value: 0 },
    ]);
  });
});

describe('святкування', () => {
  const ev = (id: number, stopId: string) => ({ id, stopId, side: 's', createdAt: '2026-10-06T09:59:00.000Z' });

  it('одна зупинка — одне святкування з лічильником за сьогодні й місцем у топі', () => {
    const s = snap({ events: [ev(41, 'st_0049'), ev(42, 'st_0049')], total: 13 });
    const [c, ...rest] = buildCelebrations(s, wallStops(s, dir));
    expect(rest).toEqual([]);
    expect(c).toMatchObject({ kind: 'scan', headline: '+2 відкриття з QR', name: 'м-н «Промінь»', added: 2, stopToday: 4, rank: 2, totalAfter: 13 });
  });

  it('перше за день, рубіж і рекорд мають власний заголовок', () => {
    const first = snap({ total: 1, events: [ev(41, 'st_0049')], bestDay: null });
    expect(buildCelebrations(first, wallStops(first, dir))[0]).toMatchObject({ kind: 'first', headline: 'Перше відкриття сьогодні!' });
    const ten = snap({ total: 10, events: [ev(41, 'st_0019')], bestDay: null });
    expect(buildCelebrations(ten, wallStops(ten, dir))[0]).toMatchObject({ kind: 'milestone', headline: 'Уже 10 сьогодні!' });
    const record = snap({ total: 21, events: [ev(41, 'st_0019')] });
    expect(buildCelebrations(record, wallStops(record, dir))[0]).toMatchObject({ kind: 'record', headline: 'Рекорд дня! Уже 21' });
  });

  it('по одній на зупинку, понад 4 — три + «Ще +N на K зупинках»', () => {
    const many = snap({
      total: 30,
      events: [ev(41, 'st_0019'), ev(42, 'st_0049'), ev(43, 'st_0019'), ev(44, 'st_0015'), ev(45, 'st_a'), ev(46, 'st_b')],
    });
    const list = buildCelebrations(many, wallStops(many, dir));
    expect(list.map((c) => [c.stopId, c.added])).toEqual([
      ['st_0019', 2],
      ['st_0049', 1],
      ['st_0015', 1],
      [null, 2],
    ]);
    expect(list[3].name).toBe('Ще +2 на 2 зупинках');
    expect(list[3].totalAfter).toBe(30);
    expect(buildCelebrations(snap(), wallStops(snap(), dir))).toEqual([]);
  });
});

describe('час і підписи', () => {
  it('київський годинник, «хв тому», тихі години й ніч', () => {
    expect(kyivClock(new Date('2026-10-06T10:05:00Z')).time).toBe('13:05');
    expect(kyivClock(new Date('2026-10-06T10:05:00Z')).date).toMatch(/вівторок, 6 жовтня/);
    const now = new Date('2026-10-06T10:00:00Z');
    expect(agoLabel('2026-10-06T09:59:40Z', now)).toBe('щойно');
    expect(agoLabel('2026-10-06T09:45:00Z', now)).toBe('15 хв тому');
    expect(agoLabel('2026-10-06T07:00:00Z', now)).toBe('3 год тому');
    expect(isQuietHour(new Date('2026-10-06T19:30:00Z'))).toBe(true); // 22:30 Київ
    expect(isQuietHour(new Date('2026-10-06T05:30:00Z'))).toBe(false); // 08:30
    expect(isNightHour(new Date('2026-10-06T20:30:00Z'))).toBe(true); // 23:30
    expect(isNightHour(new Date('2026-10-06T19:30:00Z'))).toBe(false); // 22:30
  });

  it('плюралі, контраст тексту на кольорі лінії, посилання', () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, ['відкриття', 'відкриття', 'відкриттів']))).toEqual([
      'відкриття',
      'відкриття',
      'відкриттів',
      'відкриттів',
      'відкриття',
      'відкриття',
    ]);
    expect(textOn('#1b1f2a')).toBe('#ffffff');
    expect(textOn('#ffd23f')).toBe('#000000');
    expect(textOn('#F08A1C')).toBe('#000000'); // №7: білий дав би лише 2.5:1
    expect(textOn('#7E3FC2')).toBe('#ffffff'); // №8
    expect(wallUrl('https://malin.kiev.ua', 'ab cd')).toBe('https://malin.kiev.ua/admin/wall?key=ab%20cd');
  });
});

describe('вкладка «Реклама»: час і «хто»', () => {
  const now = new Date('2026-11-17T12:00:00Z'); // 14:00 за Києвом
  it('сьогодні — хвилини й години, учора — з часом, раніше — дата', () => {
    expect(adWhen('2026-11-17T11:59:40Z', now)).toBe('щойно');
    expect(adWhen('2026-11-17T11:48:00Z', now)).toBe('12 хв');
    expect(adWhen('2026-11-17T08:30:00Z', now)).toBe('3 год');
    // межа доби — київська: 00:30 17-го ще «сьогодні», 23:30 16-го — уже «вчора»
    expect(adWhen('2026-11-16T22:30:00Z', now)).toBe('13 год');
    expect(adWhen('2026-11-16T21:30:00Z', now)).toBe('вчора 23:30');
    expect(adWhen('2026-11-16T12:05:00Z', now)).toBe('вчора 14:05');
    expect(adWhen('2026-11-15T10:00:00Z', now)).toBe('15 лист.');
  });
  it('той самий «хто» — той самий відтінок, різні — зазвичай різні', () => {
    expect(whoHue('b576')).toBe(whoHue('b576'));
    expect(whoHue('b576')).not.toBe(whoHue('ace8'));
    expect(whoHue('ffff')).toBeGreaterThanOrEqual(0);
    expect(whoHue('ffff')).toBeLessThan(360);
  });
});

describe('новий пасажир — досмотрів тизер', () => {
  const view = (viewId: string, over: Partial<AdWallSnapshot['views'][number]> = {}): AdWallSnapshot['views'][number] => ({
    viewId,
    placement: 'sticker',
    kind: 'view',
    stopId: 'st_0015',
    device: 'ios',
    who: 'ab12',
    seenBefore: 0,
    access: null,
    at: '2026-11-17T10:00:00Z',
    started: true,
    completed: true,
    ...over,
  });
  const ads = (views: AdWallSnapshot['views'], completedToday = views.length): AdWallSnapshot => ({
    now: '2026-11-17T12:00:00Z',
    day: '2026-11-17',
    sticker: { today: { shown: 9, started: 9, completed: completedToday }, total: { shown: 9, started: 9, completed: 9 }, people: 9 },
    dovede: { today: { shown: 0, started: 0, completed: 0, pages: 0 }, total: { shown: 0, started: 0, completed: 0, pages: 0 }, access: { admin: 0, guest: 0, public: 0 }, people: 0 },
    views,
  });

  it('перший знімок — точка відліку; далі новенькі — лише досмотрені тизери з наклейок, яких ще не було', () => {
    const first = freshNewcomers(null, ads([view('v1')]));
    expect(first.fresh).toEqual([]);
    const next = freshNewcomers(
      first.seen,
      ads([
        view('v4', { at: '2026-11-17T11:50:00Z' }),
        view('v3', { at: '2026-11-17T11:40:00Z', completed: false }), // почав, не досмотрів — ще ні
        view('v2', { at: '2026-11-17T11:30:00Z' }),
        view('d1', { placement: 'dovede', stopId: null }), // ролик /dovede — не пасажир
        view('v1'),
      ])
    );
    expect(next.fresh.map((v) => v.viewId)).toEqual(['v2', 'v4']);
    // той самий знімок удруге — нікого нового; v3 досмотрів пізніше — новенький
    expect(freshNewcomers(next.seen, ads([view('v4'), view('v2')])).fresh).toEqual([]);
    expect(freshNewcomers(next.seen, ads([view('v3'), view('v4')])).fresh.map((v) => v.viewId)).toEqual(['v3']);
  });

  it('святкування: зупинка з довідника, нових за сьогодні; понад чотири — три + «Ще +N новеньких»', () => {
    const fresh = [view('v1', { at: '2026-11-17T11:00:00Z' }), view('v2', { stopId: 'st_0019', at: '2026-11-17T11:10:00Z', number: 100 })];
    const out = buildNewcomerCelebrations(fresh, ads(fresh, 5), dir);
    expect(out.map((c) => [c.kind, c.headline, c.name, c.newToday, c.passenger])).toEqual([
      ['newcomer', 'Новий пасажир!', 'з-д «Прожектор»', 4, null],
      ['newcomer', 'Сотий пасажир!', 'Залізничний вокзал', 5, 100],
    ]);
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => view(`v-${id}`));
    const five = buildNewcomerCelebrations(many, ads(many), dir);
    expect(five).toHaveLength(4);
    expect(five[3]).toMatchObject({ headline: 'Нові пасажири!', name: 'Ще +2 новеньких', stopId: null });
  });

  it('скан новенького в тому ж опитуванні — лише особливе святкування; перше за день лишається', () => {
    const scan = (stopId: string, kind: Celebration['kind'] = 'scan'): Celebration => ({
      key: `${stopId}-${kind}`,
      kind,
      headline: '',
      stopId,
      name: stopId,
      lines: [],
      color: '#000',
      added: 1,
      stopToday: 1,
      rank: 1,
      totalAfter: 1,
    });
    const fresh = [view('v1')];
    const newcomers = buildNewcomerCelebrations(fresh, ads(fresh), dir);
    expect(withNewcomers([scan('st_0015'), scan('st_0019')], newcomers).map((c) => c.key)).toEqual(['st_0019-scan', 'new-v1']);
    expect(withNewcomers([scan('st_0015', 'first')], newcomers).map((c) => c.kind)).toEqual(['first', 'newcomer']);
    expect(withNewcomers([scan('st_0015')], [])).toHaveLength(1);
  });
});

describe('квиток «Доведе» — ролик на /dovede і прокомпостований талон', () => {
  const view = (viewId: string, over: Partial<AdWallSnapshot['views'][number]> = {}): AdWallSnapshot['views'][number] => ({
    viewId,
    placement: 'dovede',
    kind: 'view',
    stopId: null,
    device: 'ios',
    who: 'ab12',
    seenBefore: 0,
    access: null,
    at: '2026-11-17T10:00:00Z',
    started: true,
    completed: true,
    punched: true,
    ...over,
  });
  const ads = (views: AdWallSnapshot['views'], punchedToday = views.length): AdWallSnapshot => ({
    now: '2026-11-17T12:00:00Z',
    day: '2026-11-17',
    sticker: { today: { shown: 0, started: 0, completed: 0 }, total: { shown: 0, started: 0, completed: 0 }, people: 0 },
    dovede: {
      today: { shown: 9, started: 9, completed: 9, pages: 0, punched: punchedToday },
      total: { shown: 9, started: 9, completed: 9, pages: 0, punched: 9 },
      access: { admin: 0, guest: 0, public: 0 },
      people: 0,
    },
    views,
  });

  it('перший знімок — точка відліку; далі — лише прокомпостовані талони /dovede, яких ще не було', () => {
    const first = freshTickets(null, ads([view('d1')]));
    expect(first.fresh).toEqual([]);
    const next = freshTickets(
      first.seen,
      ads([
        view('d4', { at: '2026-11-17T11:50:00Z' }),
        view('d3', { at: '2026-11-17T11:40:00Z', punched: false }), // досмотрів, талон ще не пробив
        view('d2', { at: '2026-11-17T11:30:00Z' }),
        view('v1', { placement: 'sticker', stopId: 'st_0015' }), // тизер наклейки — це «новий пасажир»
        view('d1'),
      ])
    );
    expect(next.fresh.map((v) => v.viewId)).toEqual(['d2', 'd4']);
    expect(freshTickets(next.seen, ads([view('d3'), view('d4')])).fresh.map((v) => v.viewId)).toEqual(['d3']);
  });

  it('святкування: перший за добу — свій заголовок; хто, з чого, номер пасажира; талон щасливий і стабільний', () => {
    const fresh = [view('d1', { at: '2026-11-17T11:00:00Z', access: 'guest', number: 12 }), view('d2', { device: 'android', completed: false })];
    const out = buildTicketCelebrations(fresh, ads(fresh));
    expect(out.map((c) => [c.kind, c.headline, c.ticket?.today, c.ticket?.access, c.ticket?.passenger, c.ticket?.watched])).toEqual([
      ['ticket', 'Перший квиток сьогодні!', 1, 'guest', 12, true],
      ['ticket', 'Квиток прокомпостовано!', 2, null, null, false],
    ]);
    const t = out[0].ticket!;
    const d = t.no.replace(/\D/g, '').split('').map(Number);
    expect(d[0] + d[1] + d[2]).toBe(d[3] + d[4] + d[5]);
    expect(new Set(t.holes).size).toBe(3);
    expect(buildTicketCelebrations(fresh, ads(fresh))[0].ticket).toEqual(t);
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => view(`d-${id}`));
    const five = buildTicketCelebrations(many, ads(many, 7));
    expect(five).toHaveLength(4);
    expect(five[3]).toMatchObject({ kind: 'ticket', headline: 'Ще +2 квитки' });
    expect(five[0].headline).toBe('Квиток прокомпостовано!');
    expect(buildTicketCelebrations([], ads([]))).toEqual([]);
  });
});

describe('номер пасажира: заголовок і рубежі', () => {
  it('новенький із номером — «Новий пасажир № 37!», на рубежі — порядковим словом, без номера — просто «новий»', () => {
    expect(newcomerHeadline(null)).toEqual({ headline: 'Новий пасажир!', milestone: false });
    expect(newcomerHeadline(37)).toEqual({ headline: 'Новий пасажир № 37!', milestone: false });
    expect(newcomerHeadline(100)).toEqual({ headline: 'Сотий пасажир!', milestone: true });
    expect(newcomerHeadline(25)).toEqual({ headline: 'Двадцять пʼятий пасажир!', milestone: true });
    expect(newcomerHeadline(750)).toEqual({ headline: 'Пасажир № 750!', milestone: true });
  });
  it('найближчий рубіж після числа; за останнім зі списку — наступна тисяча', () => {
    expect(nextPassengerMilestone(0)).toBe(10);
    expect(nextPassengerMilestone(99)).toBe(100);
    expect(nextPassengerMilestone(100)).toBe(150);
    expect(nextPassengerMilestone(10000)).toBe(11000);
  });
});
