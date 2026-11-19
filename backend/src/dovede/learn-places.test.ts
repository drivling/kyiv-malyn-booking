/**
 * «Доведе» · стартові списки обходу (learn-places.ts). `detailForm` — побайтова копія форми сторінки; що вона дає те
 * саме, що повний розбір `parseLocal`, перевіряє фронтенд (src/pages/DovedePage/nlu/cityDetail.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { detailForm } from './cityDetail';
import { normalizeKey } from './crawl-core';
import { LEARN_PLACES } from './learn-places';

describe('dovede-crawl: готові списки місць', () => {
  it.each(['Kyiv', 'Zhytomyr'] as const)('%s: кожен рядок сторінка розуміє як «місце словами» цього міста, без повторів', (city) => {
    const places = LEARN_PLACES[city];
    expect(places.length).toBeGreaterThan(15);
    expect(new Set(places.map(normalizeKey)).size).toBe(places.length);
    // місце, яке словник уже знає сам (метро, вокзал), сервер не питають — у списку йому не місце
    expect(places.filter((p) => detailForm(city, p) === null)).toEqual([]);
    // рядок без зайвих пробілів: ключ у базі — слова як написані
    expect(places.filter((p) => p !== p.replace(/\s+/g, ' ').trim())).toEqual([]);
  });
});
