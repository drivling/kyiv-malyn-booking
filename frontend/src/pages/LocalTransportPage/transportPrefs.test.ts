import { describe, it, expect, beforeEach } from 'vitest';
import {
  FREQUENT_TO_STOPS_KEY,
  applyTransportPrefs,
  clearTransportDeviceData,
  collectTransportPrefs,
  mergeFrequentToStops,
  parseTransportPrefs,
  readFrequentToStops,
  transportPrefsFileText,
} from './transportPrefs';

beforeEach(() => {
  localStorage.clear();
});

describe('transportPrefs: файл налаштувань', () => {
  it('collect: версія 1, домен, дата, часті зупинки з localStorage (сміття відкидається, ≤ 5)', () => {
    localStorage.setItem(FREQUENT_TO_STOPS_KEY, JSON.stringify(['Лікарня', 7, '', 'Вокзал', 'А', 'Б', 'В', 'Г']));
    const prefs = collectTransportPrefs(new Date('2026-10-20T10:00:00.000Z'));
    expect(prefs).toEqual({ version: 1, site: 'localhost', exportedAt: '2026-10-20T10:00:00.000Z', frequentToStops: ['Лікарня', 'Вокзал', 'А', 'Б', 'В'] });
    expect(JSON.parse(transportPrefsFileText(prefs))).toEqual(prefs);
    localStorage.setItem(FREQUENT_TO_STOPS_KEY, '{not json');
    expect(readFrequentToStops()).toEqual([]);
  });

  it('parse: лише назви з датасету, без повторів, ≤ 5; невідомі — окремо', () => {
    const text = JSON.stringify({ version: 1, frequentToStops: ['Лікарня', 'Лікарня', 'Стара назва', ' Вокзал ', 42] });
    expect(parseTransportPrefs(text, ['Лікарня', 'Вокзал'])).toEqual({ frequentToStops: ['Лікарня', 'Вокзал'], unknownStops: ['Стара назва'] });
    expect(parseTransportPrefs(JSON.stringify({ version: 1, frequentToStops: ['a', 'b', 'c', 'd', 'e', 'f'] })).frequentToStops).toHaveLength(5);
  });

  it('parse: не JSON, не об\'єкт, інша версія, без списку → зрозуміла помилка', () => {
    expect(() => parseTransportPrefs('{')).toThrow(/не вдалося прочитати JSON/);
    expect(() => parseTransportPrefs('[]')).toThrow(/не файл налаштувань/);
    expect(() => parseTransportPrefs('{"version":2,"frequentToStops":[]}')).toThrow(/версія файлу: 2/);
    expect(() => parseTransportPrefs('{"version":1}')).toThrow(/нема списку/);
  });

  it('apply: імпортоване наперед, старе за ним, без повторів, записано в localStorage', () => {
    localStorage.setItem(FREQUENT_TO_STOPS_KEY, JSON.stringify(['Ринок', 'Лікарня']));
    expect(mergeFrequentToStops(['Лікарня', 'Вокзал'], ['Ринок', 'Лікарня'])).toEqual(['Лікарня', 'Вокзал', 'Ринок']);
    const merged = applyTransportPrefs({ frequentToStops: ['Лікарня', 'Вокзал'], unknownStops: [] });
    expect(merged).toEqual(['Лікарня', 'Вокзал', 'Ринок']);
    expect(JSON.parse(localStorage.getItem(FREQUENT_TO_STOPS_KEY)!)).toEqual(['Лікарня', 'Вокзал', 'Ринок']);
  });

  it('clear: прибирає ключі транспорту й кеші malin-transport-*, не чіпає сесію входу', async () => {
    localStorage.setItem(FREQUENT_TO_STOPS_KEY, '["Лікарня"]');
    localStorage.setItem('sticker-origin', '{}');
    localStorage.setItem('arrival-report-client', 'abc');
    localStorage.setItem('transport-dataset:v1', '{}');
    localStorage.setItem('site-local-transport:malyn', '1');
    localStorage.setItem('user_state', '{"type":"telegram"}');
    const deleted: string[] = [];
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: {
        keys: async () => ['malin-transport-shell-abc', 'malin-transport-fonts-v1', 'other-app'],
        delete: async (name: string) => {
          deleted.push(name);
          return true;
        },
      },
    });
    try {
      const r = await clearTransportDeviceData();
      expect(r).toEqual({ keys: 5, caches: 2 });
      expect(localStorage.getItem('user_state')).toBe('{"type":"telegram"}');
      expect(localStorage.getItem(FREQUENT_TO_STOPS_KEY)).toBeNull();
      expect(localStorage.getItem('site-local-transport:malyn')).toBeNull();
      expect(deleted).toEqual(['malin-transport-shell-abc', 'malin-transport-fonts-v1']);
    } finally {
      Reflect.deleteProperty(window, 'caches');
    }
  });
});
