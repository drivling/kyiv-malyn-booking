import { describe, expect, it } from 'vitest';
import { normalizeWords, wordErrorRate } from './similarity';

describe('normalizeWords', () => {
  it('без регістру й розділових знаків, апострофи однакові', () => {
    expect(normalizeWords("Сім, п’ять — ПʼЯТЬ!")).toEqual(['сім', "п'ять", '—', "п'ять"].filter((w) => w !== '—'));
  });
});

describe('wordErrorRate', () => {
  it('однаковий текст — 0', () => {
    expect(wordErrorRate('З Пашин до вокзалу', 'з пашин, до вокзалу.')).toBe(0);
  });
  it('одне слово з чотирьох не так — 25 %', () => {
    expect(wordErrorRate('З Пашин до вокзалу', 'З Пашин до ринку')).toBe(0.25);
  });
  it('нічого не почув — 100 %; порожній еталон — null', () => {
    expect(wordErrorRate('до вокзалу', '')).toBe(1);
    expect(wordErrorRate('', 'щось')).toBeNull();
  });
});
