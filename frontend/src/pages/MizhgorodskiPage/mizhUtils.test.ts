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
});
