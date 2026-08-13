import { describe, expect, it } from 'vitest';
import { parseTimetablePages } from './schedule-timetable-sync';

describe('parseTimetablePages', () => {
  it('accepts empty / missing', () => {
    expect(parseTimetablePages(undefined)).toEqual([]);
    expect(parseTimetablePages(null)).toEqual([]);
    expect(parseTimetablePages([])).toEqual([]);
  });

  it('keeps url+html pairs', () => {
    expect(
      parseTimetablePages([
        { url: ' https://swrailway.gov.ua/a ', html: '<table></table>' },
        { url: '', html: 'x' },
        { html: 'no-url' },
      ])
    ).toEqual([{ url: 'https://swrailway.gov.ua/a', html: '<table></table>' }]);
  });

  it('rejects non-array pages', () => {
    expect(() => parseTimetablePages({ url: 'x' })).toThrow(/pages must be an array/);
  });
});
