/**
 * «Місце словами» в далекому місті: `detailForm` дає те саме, що повний розбір сторінки (`parseLocal`), і має
 * побайтову копію на сервері — нею обхід бази доріг містом (`backend/src/dovede/crawl-core.ts`) називає місця так,
 * як їх надіслала б сторінка.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detailForm, type DetailCity } from './cityDetail';
import { METRO_STATIONS } from './kyivMetroData';
import { parseLocal } from './parseLocal';
import fixtures from '../compose/fixtures/kyiv-city-modes.json';
import korostenStops from '../eval/korosten-stops.json';
import { KYIV_LEARN_PLACES, LEARN_PLACES, ZHYTOMYR_LEARN_PLACES } from '../../../../../backend/src/dovede/learn-places';
import { ZT_OWN } from '../../../../../backend/src/dovede/zhytomyr-own-data';
import { looksLikeMetro, normalizeKey, seedFromIntent, siteForm } from '../../../../../backend/src/dovede/crawl-core';

const K = { date: '2026-11-17', mins: 600 };
const GENITIVE: Record<DetailCity, string> = { Kyiv: 'Києва', Zhytomyr: 'Житомира', Korosten: 'Коростеня' };

/** Як локальний обхід брав форму назви до цього модуля: повний розбір фрази «з Малина до <міста> до <назви>» */
function viaParse(city: DetailCity, name: string): string | null {
  const got = seedFromIntent(parseLocal(`з Малина до ${GENITIVE[city]} до ${name}`, K).intent);
  return got && got.city === city ? got.place : null;
}

/** Колишній `siteForm` команди `dovede:crawl` — на повному розборі */
function oldSiteForm(city: DetailCity, name: string): string | null {
  if (looksLikeMetro(name)) return null;
  const got = viaParse(city, name);
  if (!got) return null;
  return normalizeKey(got) === normalizeKey(name) ? name : got;
}

/** Зупинки, кінцеві й місця з відповідей сервера, що лежать у фікстурі видів транспорту */
function fixtureNames(): string[] {
  const out = new Set<string>();
  for (const a of Object.values(fixtures.answers) as Array<{ ask: { from: string; to: string }; route: { steps: Array<Record<string, unknown>> } }>) {
    for (const v of [a.ask.from, a.ask.to]) if (!/^[a-z]+\.[a-z0-9.:-]+$/i.test(v)) out.add(v);
    for (const s of a.route.steps) for (const k of ['fromStop', 'toStop', 'headsign']) if (typeof s[k] === 'string') out.add(s[k] as string);
  }
  return [...out];
}

/** Назви з тестів обходу: зупинки, кінцеві, загальні слова, обірвані назви */
const CRAWL_NAMES = [
  'вулиця Ентузіастів 7', 'вул. Ентузіастів', 'Русанівка', 'Лісова', 'Лівобережна', 'ст. м. Лівобережна', 'Святошин',
  'Академмістечко (зупинка)', 'вул. Сімʼї Сосніних', 'Микільська Борщагівка', 'Ринок', 'Дарницький вокзал', 'Кінотеатр «Росія»',
  'Національний університет біоресурсів і природокористування України', 'Супермаркет', 'ж/м Теремки', 'Гіпермаркет', 'Авторинок',
  'Національний музей народної архітектури та побуту', 'Універмаг "Дитячий світ"', 'вул. Татарська', 'Медучилище', 'станція',
  'Дорога', 'Дитяча поліклініка', 'ТРЦ Лавина', 'Польова 12', 'Охматдит', 'Вулиця Ентузіастів, 7', 'Ніде', 'вокзал', 'автовокзал',
  'Епіцентр на Кільцевій', 'Університет імені Драгоманова', 'Київський зоопарк', 'Житомирська', 'на розі', 'Предславинська 28',
  'обласна лікарня біля метро Святошин', 'Хрещатик 22 до Подолу', 'Поділ', 'вул. Київська 77', 'майдан Соборний',
  // кінцева з Києва, яку в Житомирі «к» перед «Олімпійське» робить станцією метро — новим «куди»
  'ж/к "Олімпійське містечко"',
];

const CORPUS: Record<DetailCity, string[]> = {
  Kyiv: [...new Set([...KYIV_LEARN_PLACES, ...ZHYTOMYR_LEARN_PLACES, ...fixtureNames(), ...CRAWL_NAMES, ...METRO_STATIONS.map((s) => s.name)])],
  Zhytomyr: [
    ...new Set([...ZHYTOMYR_LEARN_PLACES, ...KYIV_LEARN_PLACES, ...CRAWL_NAMES, ...ZT_OWN.dirs.flatMap((d) => d.stops.map((s) => s[0])), ...ZT_OWN.dirs.map((d) => d.name)]),
  ],
  Korosten: [...new Set([...LEARN_PLACES.Korosten, ...CRAWL_NAMES, ...korostenStops.stops.map((s) => s.name)])],
};

describe('cityDetail: detailForm — те саме, що повний розбір сторінки', () => {
  it.each(['Kyiv', 'Zhytomyr', 'Korosten'] as const)('%s: усі назви з місць, фікстур і тестів обходу', (city) => {
    const names = CORPUS[city];
    expect(names.length).toBeGreaterThan(city === 'Kyiv' ? 150 : city === 'Zhytomyr' ? 300 : 100);
    const diff = names.filter((n) => detailForm(city, n) !== viaParse(city, n)).map((n) => `${n} → ${detailForm(city, n)} / ${viaParse(city, n)}`);
    expect(diff).toEqual([]);
    // і форма, з якою обхід питає сервер, не змінилась
    expect(names.filter((n) => siteForm(city, n) !== oldSiteForm(city, n))).toEqual([]);
  });

  it('приклади: відмінок, номер будинку, межа назви, відоме сторінці місце', () => {
    expect(detailForm('Kyiv', 'вулицю Ентузіастів 7')).toBe('вулиця Ентузіастів 7');
    expect(detailForm('Zhytomyr', 'Польову 12')).toBe('Польова 12');
    expect(detailForm('Kyiv', 'Національний університет біоресурсів і природокористування України')).toBe('Національний університет біоресурсів і природокористування');
    expect(detailForm('Kyiv', 'Лівобережна')).toBeNull();
    expect(detailForm('Kyiv', 'вокзал')).toBeNull();
    expect(detailForm('Zhytomyr', 'автовокзал')).toBeNull();
    expect(detailForm('Kyiv', 'ТРЦ Лавина біля метро Святошин')).toBeNull();
  });
});

describe('cityDetail: копія на сервері', () => {
  it.each(['cityDetail.ts', 'kyivMetro.ts', 'kyivRing.ts'])('backend/src/dovede/%s байт-у-байт та сама', (f) => {
    const here = fs.readFileSync(path.resolve(__dirname, f), 'utf8');
    const mirror = fs.readFileSync(path.resolve(__dirname, '../../../../../backend/src/dovede', f), 'utf8');
    expect(mirror).toBe(here);
  });
});
