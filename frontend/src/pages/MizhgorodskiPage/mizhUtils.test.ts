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

    const stopsByTripRouteId = new Map([[20, [1, 3, 2]]]); // Kyiv, Irpin, Malyn
    expect(
      listingMatchesCities(
        { route: 'Kyiv-Malyn', tripRouteId: 20, fromPointId: 1, toPointId: 2 },
        'Irpin',
        'Malyn',
        undefined,
        pointIds,
        stopsByTripRouteId
      )
    ).toBe(true);
    expect(
      listingMatchesCities(
        { route: 'Kyiv-Malyn', tripRouteId: 20, fromPointId: 1, toPointId: 2 },
        'Malyn',
        'Irpin',
        undefined,
        pointIds,
        stopsByTripRouteId
      )
    ).toBe(false);
  });

  test('quick chips and boarding time helpers', async () => {
    const {
      buildQuickDirectChips,
      boardingTimeAtStop,
      citiesFromQuickChip,
    } = await import('./mizhUtils');
    const points = [
      { id: 1, code: 'Kyiv', nameUk: 'Київ' },
      { id: 2, code: 'Malyn', nameUk: 'Малин', quickDirectPointIds: [1, 4] },
      { id: 4, code: 'Korosten', nameUk: 'Коростень' },
    ];
    const chips = buildQuickDirectChips(points[1], points);
    expect(chips.map((c) => c.label)).toEqual(['Київ ↔ Малин', 'Коростень ↔ Малин']);
    expect(citiesFromQuickChip('Malyn', 'Kyiv', true)).toEqual({ from: 'Malyn', to: 'Kyiv' });
    const { chipsFromOdPairs } = await import('./mizhUtils');
    const odChips = chipsFromOdPairs('Malyn', [
      { fromCode: 'Kyiv', toCode: 'Malyn', fromNameUk: 'Київ', toNameUk: 'Малин' },
      { fromCode: 'Kyiv', toCode: 'Korosten', fromNameUk: 'Київ', toNameUk: 'Коростень' },
      { fromCode: 'Malyn', toCode: 'Korosten', fromNameUk: 'Малин', toNameUk: 'Коростень' },
    ]);
    expect(odChips.map((c) => c.otherCode).sort()).toEqual(['Korosten', 'Kyiv']);
    expect(
      boardingTimeAtStop(
        '08:00',
        [
          { pointId: 1, position: 0, departureOffsetMinutes: 0 },
          { pointId: 3, position: 1, departureOffsetMinutes: 45 },
          { pointId: 2, position: 2, departureOffsetMinutes: 90 },
        ],
        3
      )
    ).toBe('08:45');
  });
});
