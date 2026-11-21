/**
 * «Доведе» · стартові списки обходу (learn-places.ts). `detailForm` — побайтова копія форми сторінки; що вона дає те
 * саме, що повний розбір `parseLocal`, перевіряє фронтенд (src/pages/DovedePage/nlu/cityDetail.test.ts).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detailForm } from './cityDetail';
import { normalizeKey, siteForm } from './crawl-core';
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

  it('Коростень: список згенеровано зі знімка OpenStreetMap і вулиць переліку зупинок; без виключених назв і повторів', () => {
    const dir = path.resolve(__dirname, '../../../data/korosten-transport/dovede-learn');
    const snapshot = JSON.parse(readFileSync(path.join(dir, 'places.json'), 'utf8')) as { _license: string; places: Array<{ name: string }> };
    const config = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')) as { exclude: string[]; add: string[] };
    const articles = JSON.parse(readFileSync(path.resolve(__dirname, '../../../frontend/src/content/stops/korosten-articles.json'), 'utf8')) as Array<{ place?: string }>;
    const streets = articles.map((a) => (a.place ?? '').split('(')[0].replace(/\s+/g, ' ').trim().replace('вул. ім. ', 'вул. ').replace('вул. ', 'вулиця ').replace('пров. ', 'провулок ')).filter(Boolean);
    const allowed = new Set([...config.add, ...snapshot.places.map((p) => p.name), ...streets].map((n) => n.toLowerCase()));
    const places = LEARN_PLACES.Korosten;
    expect(snapshot._license).toContain('OpenStreetMap');
    expect(places.length).toBeGreaterThan(40);
    expect(new Set(places.map(normalizeKey)).size).toBe(places.length);
    expect(places.filter((p) => !allowed.has(p.toLowerCase()))).toEqual([]);
    expect(places.filter((p) => config.exclude.some((x) => x.toLowerCase() === p.toLowerCase()))).toEqual([]);
    expect(places.filter((p) => p !== p.replace(/\s+/g, ' ').trim())).toEqual([]);
    // нічого з джерел не загубилось: кожна дозволена назва (без виключених і надто коротких) — у списку
    const want = [...allowed].filter((n) => !config.exclude.some((x) => x.toLowerCase() === n) && n.length >= 4 && n.length <= 70);
    expect(want.filter((n) => !places.some((p) => p.toLowerCase() === n))).toEqual([]);
  });

  it('Коростень: кожну назву сторінка читає так само («з Малина до Коростеня до …») — відповідь кампанії знайде й людина', () => {
    expect(LEARN_PLACES.Korosten.filter((p) => siteForm('Korosten', p) !== p)).toEqual([]);
    // чого сторінка назвати не може: назва обривається на числі чи слові «машин…», ініціал — не слово
    expect(siteForm('Korosten', 'Завод шляхових машин')).toBe('Завод шляхових');
    expect(siteForm('Korosten', 'вулиця В. Стуса')).toBeNull();
    expect(siteForm('Korosten', 'вокзал')).toBeNull();
  });
});
