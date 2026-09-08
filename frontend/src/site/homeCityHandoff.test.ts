import { describe, expect, test } from 'vitest';
import { readCityHandoff } from './homeCityHandoff';

describe('readCityHandoff', () => {
  test('без параметра нічого не змінює', () => {
    expect(readCityHandoff('?from=Kyiv')).toEqual({ code: null, nextSearch: '?from=Kyiv' });
    expect(readCityHandoff('')).toEqual({ code: null, nextSearch: '' });
  });

  test('дістає місто і прибирає його з query', () => {
    expect(readCityHandoff('?city=Korosten&from=Kyiv')).toEqual({
      code: 'Korosten',
      nextSearch: '?from=Kyiv',
    });
  });

  test('єдиний параметр → порожній query', () => {
    expect(readCityHandoff('?city=Malyn')).toEqual({ code: 'Malyn', nextSearch: '' });
  });

  test('порожнє значення ігнорується', () => {
    expect(readCityHandoff('?city=&from=Kyiv').code).toBeNull();
  });
});
