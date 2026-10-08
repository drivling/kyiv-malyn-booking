import { describe, expect, it } from 'vitest';
import type { StickerWallSnapshot } from '@/types';
import {
  agoLabel,
  buildCelebrations,
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
    expect(textOn('#ffd23f')).toBe('#10131a');
    expect(wallUrl('https://malin.kiev.ua', 'ab cd')).toBe('https://malin.kiev.ua/admin/wall?key=ab%20cd');
  });
});
