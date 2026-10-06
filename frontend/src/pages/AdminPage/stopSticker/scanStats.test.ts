import { describe, it, expect } from 'vitest';
import type { StickerScanStats } from '@/types';
import {
  dailySeries,
  dayLabels,
  dayParts,
  filterStopRows,
  hourBuckets,
  kyivToday,
  niceMax,
  opensLabel,
  scopeTotals,
  sortStopRows,
  stickerStopCatalog,
  stopStatRows,
} from './scanStats';
import { STICKER_DATASET } from './stickerTestDataset';

const stats: StickerScanStats = {
  rows: [
    { stopId: 'st_0015', side: 'a', total: 12, last7d: 4, last30d: 9, lastAt: '2026-10-05T07:30:00.000Z' },
    { stopId: 'st_0015', side: 'b', total: 2, last7d: 2, last30d: 2, lastAt: '2026-10-06T07:30:00.000Z' },
    { stopId: 'st_0019', side: 's', total: 3, last7d: 0, last30d: 3, lastAt: '2026-09-20T12:00:00.000Z' },
    { stopId: 'st_gone', side: 'a', total: 1, last7d: 0, last30d: 0, lastAt: '2026-08-01T12:00:00.000Z' },
  ],
  total: 18,
  last7d: 6,
  last30d: 14,
  days: 30,
  daily: [
    { day: '2026-10-04', stopId: 'st_0015', side: 'a', count: 2 },
    { day: '2026-10-06', stopId: 'st_0015', side: 'a', count: 1 },
    { day: '2026-10-06', stopId: 'st_0019', side: 's', count: 3 },
  ],
  hourly: [
    { hour: 5, stopId: 'st_0015', side: 'a', count: 1 },
    { hour: 10, stopId: 'st_0015', side: 'a', count: 2 },
    { hour: 11, stopId: 'st_0015', side: 'b', count: 4 },
    { hour: 22, stopId: 'st_0019', side: 's', count: 1 },
    { hour: 23, stopId: 'st_0019', side: 's', count: 1 },
    { hour: 4, stopId: 'st_0019', side: 's', count: 1 },
  ],
  printed: [
    { stopId: 'st_0015', side: 'a', count: 2, lastAt: '2026-10-02T09:00:00.000Z' },
    { stopId: 'st_0015', side: 'b', count: 1, lastAt: '2026-10-03T09:00:00.000Z' },
  ],
};

describe('ряди графіків', () => {
  it('по добах — суцільний ряд до сьогодні з нулями, по зупинці або по всій мережі', () => {
    expect(dailySeries(stats.daily, 4, '2026-10-06')).toEqual([
      { day: '2026-10-03', count: 0 },
      { day: '2026-10-04', count: 2 },
      { day: '2026-10-05', count: 0 },
      { day: '2026-10-06', count: 4 },
    ]);
    expect(dailySeries(stats.daily, 2, '2026-10-06', { stopId: 'st_0019' }).map((d) => d.count)).toEqual([0, 3]);
    // через межу місяця й року
    expect(dailySeries([], 3, '2027-01-01').map((d) => d.day)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('по годинах і частинах доби: межі 05 / 11 / 17 / 23, ніч через північ', () => {
    const hours = hourBuckets(stats.hourly);
    expect(hours).toHaveLength(24);
    expect(hours[11]).toBe(4);
    expect(dayParts(hours)).toEqual([
      { key: 'morning', label: 'Ранок', range: '05–11', count: 3 },
      { key: 'day', label: 'День', range: '11–17', count: 4 },
      { key: 'evening', label: 'Вечір', range: '17–23', count: 1 },
      { key: 'night', label: 'Ніч', range: '23–05', count: 2 },
    ]);
    expect(hourBuckets(stats.hourly, { stopId: 'st_0019' }).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('підсумки обсягу, шкала й підписи', () => {
    expect(scopeTotals(stats)).toEqual({ total: 18, last7d: 6, last30d: 14, printed: 2, scanned: 4 });
    expect(scopeTotals(stats, { stopId: 'st_0015' })).toEqual({ total: 14, last7d: 6, last30d: 11, printed: 2, scanned: 2 });
    expect([niceMax(0), niceMax(3), niceMax(7), niceMax(13), niceMax(48), niceMax(120)]).toEqual([1, 3, 10, 20, 50, 200]);
    expect([1, 3, 5, 11, 21, 112].map(opensLabel)).toEqual([
      '1 відкриття',
      '3 відкриття',
      '5 відкриттів',
      '11 відкриттів',
      '21 відкриття',
      '112 відкриттів',
    ]);
    expect(dayLabels('2026-10-06')).toEqual({ short: '06.10', long: '06.10, вт' });
    expect(kyivToday(new Date('2026-10-05T21:30:00Z'))).toBe('2026-10-06');
  });
});

describe('список зупинок', () => {
  const catalog = stickerStopCatalog(STICKER_DATASET);
  const rows = stopStatRows(catalog, stats, (id) => (id === 'st_gone' ? 'Знята зупинка' : id));
  const byId = Object.fromEntries(rows.map((r) => [r.stopId, r]));

  it('усі зупинки з відправленнями + зупинки з історією, лічильники по наклейках і друк', () => {
    expect(catalog.map((c) => c.stopId).sort()).toEqual(['st_0015', 'st_0019', 'st_0035', 'st_0054', 'st_0064', 'st_0070', 'st_0097']);
    expect(catalog.find((c) => c.stopId === 'st_0015')?.lines.map((l) => l.routeId)).toEqual(['5', '11']);
    expect(rows).toHaveLength(8);
    expect(byId.st_0015).toMatchObject({ sides: { a: 12, b: 2 }, total: 14, last7d: 6, lastScanAt: '2026-10-06T07:30:00.000Z' });
    expect(byId.st_0015.printedSides).toEqual(['a', 'b']);
    expect(byId.st_0015.lastPrintAt).toBe('2026-10-03T09:00:00.000Z');
    expect(byId.st_gone).toMatchObject({ name: 'Знята зупинка', lines: [], total: 1 });
    expect(byId.st_0035).toMatchObject({ total: 0, printedSides: [], lastPrintAt: null });
    expect(stopStatRows(catalog, null, (id) => id).every((r) => r.total === 0)).toBe(true);
  });

  it('сортування, пошук і «лише з наклейками»', () => {
    expect(sortStopRows(rows, 'popular').slice(0, 3).map((r) => r.stopId)).toEqual(['st_0015', 'st_0019', 'st_gone']);
    expect(sortStopRows(rows, 'recent')[0].stopId).toBe('st_0015');
    const names = sortStopRows(rows, 'name').map((r) => r.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'uk')));
    expect(filterStopRows(rows, { query: 'ВОКЗ' }).map((r) => r.stopId)).toEqual(['st_0019']);
    expect(filterStopRows(rows, { query: 'st_0035' }).map((r) => r.stopId)).toEqual(['st_0035']);
    expect(filterStopRows(rows, { onlyWithStickers: true }).map((r) => r.stopId).sort()).toEqual(['st_0015', 'st_0019', 'st_gone']);
  });
});
