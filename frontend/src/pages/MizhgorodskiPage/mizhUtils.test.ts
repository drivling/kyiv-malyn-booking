import { describe, expect, test } from 'vitest';
import { isElektrichka, isMarshrutka, isScheduleActiveOnDate, type TransportFilter } from './mizhUtils';

describe('mizh transport filters', () => {
  test('train is a valid TransportFilter value', () => {
    const t: TransportFilter = 'train';
    expect(t).toBe('train');
  });

  test('vehicle type helpers', () => {
    expect(isElektrichka({ vehicleType: 'elektrichka' })).toBe(true);
    expect(isMarshrutka({ vehicleType: 'elektrichka' })).toBe(false);
    expect(isMarshrutka({ vehicleType: 'marshrutka' })).toBe(true);
    expect(isMarshrutka({})).toBe(true);
  });

  test('active weekdays', () => {
    expect(isScheduleActiveOnDate([1, 2, 3, 4, 5], '2026-08-12')).toBe(true);
    expect(isScheduleActiveOnDate([6, 7], '2026-08-12')).toBe(false);
  });

  test('listingMatchesCities dual-read and OD points', async () => {
    const { listingMatchesCities } = await import('./mizhUtils');
    const map = new Map([[10, { slug: 'Kyiv-Malyn' }]]);
    expect(listingMatchesCities({ route: 'Kyiv-Malyn', tripRouteId: 10 }, 'Kyiv', 'Malyn', map)).toBe(true);
    expect(listingMatchesCities({ route: 'Malyn-Kyiv', tripRouteId: null }, 'Kyiv', 'Malyn')).toBe(false);
    const pointIds = new Map([
      ['Irpin', 3],
      ['Malyn', 2],
      ['Kyiv', 1],
    ]);
    expect(
      listingMatchesCities(
        { route: 'Irpin-Malyn', fromPointId: 3, toPointId: 2 },
        'Irpin',
        'Malyn',
        undefined,
        pointIds
      )
    ).toBe(true);
    expect(
      listingMatchesCities(
        { route: 'Kyiv-Malyn', fromPointId: 1, toPointId: 2 },
        'Irpin',
        'Malyn',
        undefined,
        pointIds
      )
    ).toBe(false);
    expect(listingMatchesCities({ route: 'Irpin-Malyn' }, 'Irpin', 'Malyn')).toBe(true);
  });
});
