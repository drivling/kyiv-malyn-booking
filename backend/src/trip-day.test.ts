import { expect, test } from 'vitest';
import { parseDayString, tripDayKey, tripDayWhere, tripDayWindow } from './trip-day';

test('tripDayWindow: локальна північ → наступна північ, для Date і для рядка', () => {
  const { start, end } = tripDayWindow(new Date(2026, 11, 1, 18, 30));
  expect(start).toEqual(new Date(2026, 11, 1));
  expect(end).toEqual(new Date(2026, 11, 2));
  expect(tripDayWindow('2026-12-01')).toEqual({ start: new Date(2026, 11, 1), end: new Date(2026, 11, 2) });
  // те саме, що бачить мерж (getFullYear/getMonth/getDate) і пошук (setHours(0))
  const viaSetHours = new Date(2026, 11, 1, 23, 59);
  viaSetHours.setHours(0, 0, 0, 0);
  expect(tripDayWhere(new Date(2026, 11, 1, 23, 59)).gte).toEqual(viaSetHours);
});

test('tripDayKey і parseDayString — локальні, без зсуву через UTC', () => {
  expect(tripDayKey(new Date(2026, 0, 5, 0, 30))).toBe('2026-01-05');
  expect(parseDayString('2026-01-05')).toEqual(new Date(2026, 0, 5));
  expect(parseDayString('2026-01-05T10:00:00')).toEqual(new Date(2026, 0, 5));
});
