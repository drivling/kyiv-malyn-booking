import { describe, expect, it } from 'vitest';
import { isDaily, normalizeWeekdays, tripsPerDay, tripsPerDayText, weekdaysLabel } from './weekdays';

describe('weekdays', () => {
  it('labels ranges and lists in Ukrainian short form', () => {
    expect(weekdaysLabel([1, 2, 3, 4, 5, 6, 7])).toBe('щодня');
    expect(weekdaysLabel(undefined)).toBe('щодня');
    expect(weekdaysLabel([])).toBe('щодня');
    expect(weekdaysLabel([1, 2, 3, 4, 5, 6])).toBe('Пн–Сб');
    expect(weekdaysLabel([1, 5, 6, 7])).toBe('Пн, Пт–Нд');
    expect(weekdaysLabel([5, 6, 7])).toBe('Пт–Нд');
    expect(weekdaysLabel([5])).toBe('Пт');
    expect(weekdaysLabel([7, 1])).toBe('Пн, Нд');
    expect(weekdaysLabel([1, 3, 5])).toBe('Пн, Ср, Пт');
  });

  it('normalizes garbage and detects daily', () => {
    expect(normalizeWeekdays([9, 0, 3, 3, 1])).toEqual([1, 3]);
    expect(isDaily([1, 2, 3, 4, 5, 6, 7])).toBe(true);
    expect(isDaily([5])).toBe(false);
  });

  it('counts trips per weekday', () => {
    const rows = [{ activeWeekdays: [1, 2, 3, 4, 5, 6, 7] }, { activeWeekdays: [5] }, { activeWeekdays: [1, 5, 6, 7] }];
    expect(tripsPerDay(rows)).toEqual({ min: 1, max: 3 });
    expect(tripsPerDayText(rows)).toBe('від 1 до 3 рейсів залежно від дня тижня');
    expect(tripsPerDayText([{ activeWeekdays: null }, {}])).toBe('2 рейсів щодня');
  });
});
