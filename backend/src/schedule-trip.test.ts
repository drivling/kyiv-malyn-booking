import { describe, expect, test } from 'vitest';
import {
  buildFromToPairs,
  buildLegacyRouteKey,
  corridorSlugFromRouteSlug,
  defaultLabelUk,
  isScheduleActiveOnDate,
  matchesTerminals,
  normalizeViaPointIds,
  parseLegacyRoute,
  resolveArrivalTime,
  validateTripPointSelection,
} from './schedule-trip';

describe('parseLegacyRoute / buildLegacyRouteKey', () => {
  test('Kyiv-Malyn-Irpin', () => {
    expect(parseLegacyRoute('Kyiv-Malyn-Irpin')).toEqual({
      startCode: 'Kyiv',
      endCode: 'Malyn',
      viaCodes: ['Irpin'],
    });
    expect(buildLegacyRouteKey('Kyiv', 'Malyn', ['Irpin'])).toBe('Kyiv-Malyn-Irpin');
  });

  test('Malyn-Zhytomyr without via', () => {
    expect(parseLegacyRoute('Malyn-Zhytomyr')).toEqual({
      startCode: 'Malyn',
      endCode: 'Zhytomyr',
      viaCodes: [],
    });
    expect(buildLegacyRouteKey('Malyn', 'Zhytomyr', [])).toBe('Malyn-Zhytomyr');
  });
});

describe('validateTripPointSelection', () => {
  const points = new Map([
    [1, { id: 1, code: 'Kyiv', nameUk: 'Київ', requiredOnTrip: false }],
    [2, { id: 2, code: 'Malyn', nameUk: 'Малин', requiredOnTrip: true }],
    [3, { id: 3, code: 'Irpin', nameUk: 'Ірпінь', requiredOnTrip: false }],
    [4, { id: 4, code: 'Zhytomyr', nameUk: 'Житомир', requiredOnTrip: false }],
  ]);

  test('requires Malyn on trip', () => {
    const r = validateTripPointSelection({
      startPointId: 1,
      endPointId: 4,
      viaPointIds: [],
      pointsById: points,
    });
    expect(r.ok).toBe(false);
  });

  test('allows Kyiv-Malyn with Irpin via', () => {
    const r = validateTripPointSelection({
      startPointId: 1,
      endPointId: 2,
      viaPointIds: [3],
      pointsById: points,
    });
    expect(r).toEqual({ ok: true, viaPointIds: [3] });
  });

  test('rejects via duplicating terminal', () => {
    const r = validateTripPointSelection({
      startPointId: 1,
      endPointId: 2,
      viaPointIds: [1],
      pointsById: points,
    });
    expect(r.ok).toBe(false);
  });
});

describe('weekdays / arrival / terminals', () => {
  test('isScheduleActiveOnDate', () => {
    // 2026-08-12 is Wednesday = 3
    expect(isScheduleActiveOnDate([1, 2, 3, 4, 5], '2026-08-12')).toBe(true);
    expect(isScheduleActiveOnDate([6, 7], '2026-08-12')).toBe(false);
  });

  test('resolveArrivalTime from duration', () => {
    expect(resolveArrivalTime('08:30', null, 90)).toBe('10:00');
    expect(resolveArrivalTime('08:30', '11:15', 90)).toBe('11:15');
  });

  test('matchesTerminals and from/to pairs', () => {
    expect(matchesTerminals('Kyiv', 'Malyn', 'Kyiv', 'Malyn')).toBe(true);
    expect(matchesTerminals('Kyiv', 'Malyn', 'Malyn', 'Kyiv')).toBe(false);
    const pairs = buildFromToPairs([
      { id: 1, code: 'Kyiv', nameUk: 'Київ', requiredOnTrip: false, appearInFromTo: true },
      { id: 2, code: 'Malyn', nameUk: 'Малин', requiredOnTrip: true, appearInFromTo: true },
      { id: 3, code: 'Irpin', nameUk: 'Ірпінь', requiredOnTrip: false, appearInFromTo: false },
    ]);
    expect(pairs).toHaveLength(2);
    expect(normalizeViaPointIds([3, 3, 'x', 2])).toEqual([3, 2]);
    expect(corridorSlugFromRouteSlug('Kyiv-Malyn-Irpin')).toBe('Kyiv-Malyn');
    expect(defaultLabelUk('Kyiv', 'Malyn', ['Irpin'])).toContain('Ірпінь');
  });
});
