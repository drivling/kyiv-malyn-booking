import { afterEach, describe, it, expect, vi } from 'vitest';
import { getKyivCalendarDate, getKyivMinutesNow, searchDateKyivOffsetDays } from './kyivTime';

afterEach(() => {
  vi.useRealTimers();
});

describe('kyivTime', () => {
  it('getKyivMinutesNow — хвилини за Києвом незалежно від зони процесу', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T05:18:00Z')); // 08:18 за Києвом (UTC+3 у вересні)
    expect(getKyivMinutesNow()).toBe(8 * 60 + 18);
  });

  it('getKyivCalendarDate — після півночі за Києвом уже наступна дата', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T22:30:00Z')); // 01:30 17.09 за Києвом
    expect(getKyivCalendarDate()).toEqual({ d: 17, m: 9, y: 2026 });
  });

  it('searchDateKyivOffsetDays — сьогодні / завтра / вчора / невалідне', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T05:18:00Z'));
    expect(searchDateKyivOffsetDays('16.09.26')).toBe(0);
    expect(searchDateKyivOffsetDays('17.09.26')).toBe(1);
    expect(searchDateKyivOffsetDays('15.09.26')).toBe(-1);
    expect(searchDateKyivOffsetDays('1.10.2026')).toBe(15);
    expect(searchDateKyivOffsetDays('2026-09-16')).toBeNull();
    expect(searchDateKyivOffsetDays('')).toBeNull();
  });
});
