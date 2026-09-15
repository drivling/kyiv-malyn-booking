import { describe, it, expect } from 'vitest';
import {
  dateUrlToIso,
  formatDateUrl,
  isoToDateUrl,
  nowClock,
  parseDateUrl,
  todayDateUrl,
  tomorrowDateUrl,
} from './dateUrl';

describe('dateUrl', () => {
  it('formatDateUrl / parseDateUrl — round trip DD.MM.YY', () => {
    expect(formatDateUrl(new Date(2026, 8, 5))).toBe('05.09.26');
    expect(parseDateUrl('05.09.26')?.getTime()).toBe(new Date(2026, 8, 5).getTime());
    expect(parseDateUrl('5.9.2026')?.getTime()).toBe(new Date(2026, 8, 5).getTime());
    expect(parseDateUrl('2026-09-05')).toBeNull();
    expect(parseDateUrl('')).toBeNull();
  });

  it('dateUrlToIso — значення для <input type="date">', () => {
    expect(dateUrlToIso('16.09.26')).toBe('2026-09-16');
    expect(dateUrlToIso('1.1.26')).toBe('2026-01-01');
    expect(dateUrlToIso('abc')).toBe('');
    expect(dateUrlToIso('')).toBe('');
  });

  it('isoToDateUrl — назад у DD.MM.YY без зсуву зон', () => {
    expect(isoToDateUrl('2026-09-16')).toBe('16.09.26');
    expect(isoToDateUrl('2026-01-01')).toBe('01.01.26');
    expect(isoToDateUrl('2026-02-30')).toBe(''); // неіснуюча дата
    expect(isoToDateUrl('16.09.26')).toBe('');
    expect(isoToDateUrl('')).toBe('');
  });

  it('todayDateUrl / tomorrowDateUrl — через кінець місяця і року', () => {
    expect(todayDateUrl(new Date(2026, 8, 30))).toBe('30.09.26');
    expect(tomorrowDateUrl(new Date(2026, 8, 30))).toBe('01.10.26');
    expect(tomorrowDateUrl(new Date(2026, 11, 31))).toBe('01.01.27');
    expect(tomorrowDateUrl(new Date(2028, 1, 28))).toBe('29.02.28'); // високосний
  });

  it('nowClock — HH:MM з нулями', () => {
    expect(nowClock(new Date(2026, 0, 1, 7, 5))).toBe('07:05');
    expect(nowClock(new Date(2026, 0, 1, 23, 59))).toBe('23:59');
  });
});
