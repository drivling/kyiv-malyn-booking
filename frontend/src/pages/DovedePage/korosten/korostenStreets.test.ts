/**
 * Вулиці й будинки Коростеня (крок 7а плану навчання): слова людини → місце з точкою зі своїх даних.
 * Дані — справжній згенерований файл; знімок OpenStreetMap лежить у data/korosten-transport/dovede-streets/osm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import doc from '../data/korosten-streets.json';
import malynDoc from '../data/malyn-streets.json';
import { parseLocal } from '../nlu/parseLocal';
import { streetPrecision, type Street } from '../nlu/streets';
import { korostenSpot, setKorostenStreets } from './korostenStreets';

const streets = (doc as unknown as { streets: Street[] }).streets;

describe('вулиці Коростеня: дані', () => {
  it('файл згенеровано зі знімка: кожна вулиця є в знімку, id не повторюються, є ліцензія', () => {
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../data/korosten-transport/dovede-streets/osm/streets.json'), 'utf8')) as {
      _license: string;
      elements: Array<{ tags: { name: string } }>;
    };
    const names = new Set(snapshot.elements.map((e) => e.tags.name));
    expect(snapshot._license).toContain('OpenStreetMap');
    expect((doc as { license: string }).license).toContain('ODbL');
    expect(streets.length).toBeGreaterThan(200);
    expect(new Set(streets.map((s) => s.id)).size).toBe(streets.length);
    // «1-й провулок Лесі Українки» у знімку — «1-й Лесі Українки» + «провулок» у файлі: звіряємо за словами
    const words = (t: string) => t.toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
    const keys = new Set([...names].map(words));
    const known = (s: Street) => keys.has(words(`${s.kind} ${s.name}`)) || keys.has(words(s.name));
    expect(streets.filter((s) => !known(s)).map((s) => s.label)).toEqual([]);
    // будинків із точкою — понад тисячу
    expect(streets.reduce((n, s) => n + Object.keys(s.houses).length + Object.keys(s.near).length, 0)).toBeGreaterThan(1000);
  });
});

describe('korostenSpot: слова людини → місце з точкою', () => {
  beforeAll(() => setKorostenStreets(streets));
  afterAll(() => setKorostenStreets([]));

  it('вулиця з будинком із даних — точна точка; id у своєму просторі `kstreet.`', () => {
    const p = korostenSpot('Грушевського 12');
    expect(p).toMatchObject({ id: 'kstreet.hrushevskoho:12', city: 'Korosten', label: 'вул. Грушевського, 12' });
    expect(p?.latLng?.[0]).toBeGreaterThan(50.9);
    expect(streetPrecision(p!.id)).toBe('exact');
    expect(korostenSpot('вулиця Грушевського 12')?.id).toBe('kstreet.hrushevskoho:12');
    expect(korostenSpot('вул. Грушевського, буд. 12')?.id).toBe('kstreet.hrushevskoho:12');
  });

  it('будинок, привʼязаний за розташуванням, сусідній номер і вулиця без будинку — з чесною точністю', () => {
    expect(streetPrecision(korostenSpot('Грушевського 67')!.id)).toBe('near');
    expect(streetPrecision(korostenSpot('Грушевського 9')!.id)).toBe('neighbour');
    expect(korostenSpot('вулиця Шевченка')).toMatchObject({ id: 'kstreet.shevchenka', label: 'вул. Шевченка' });
  });

  it('провулок — лише коли сказано «провулок»', () => {
    expect(korostenSpot('провулок Шевченка 4')?.id).toBe('kstreet.shevchenka-provulok:4');
    expect(korostenSpot('Шевченка 4')?.id).toBe('kstreet.shevchenka:4');
  });

  it('не адреса з даних — null: невідома вулиця, заклад, зайві слова', () => {
    expect(korostenSpot('Вигадана 5')).toBeNull();
    expect(korostenSpot('музична школа')).toBeNull();
    expect(korostenSpot('магазин на Грушевського')).toBeNull();
    expect(korostenSpot('')).toBeNull();
  });

  it('вулиці Малина не зачеплено: розбір малинського питання той самий із даними Коростеня й без них', () => {
    const q = 'до вулиці Городищанської, будинок 54';
    const now = { date: '2026-11-18', mins: 480 };
    const withData = parseLocal(q, now).intent;
    setKorostenStreets([]);
    const without = parseLocal(q, now).intent;
    setKorostenStreets(streets);
    expect(withData).toEqual(without);
    expect((malynDoc as unknown as { streets: Street[] }).streets.every((s) => s.id.startsWith('street.'))).toBe(true);
  });

  it('без даних (не завантажились) — null, а не помилка', () => {
    setKorostenStreets([]);
    expect(korostenSpot('Грушевського 12')).toBeNull();
    setKorostenStreets(streets);
  });
});
