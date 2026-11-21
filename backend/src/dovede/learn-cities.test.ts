/**
 * Реєстр міст навчання (Docs/dovede-learning-roadmap.md, крок 1). Значення тут записано такими, якими вони були в
 * коді до реєстру (`ARRIVAL_POINTS`, `DEFAULT_ORIGINS`, `CITY_NAME`, глибина «Навчити місто») — тест тримає їх
 * незмінними для Києва й Житомира й перевіряє, що похідні переліки справді беруться з реєстру.
 */
import { describe, expect, it } from 'vitest';
import { LEARN_CITIES, LEARN_CITY_CODES, LEARN_CITY_LIST, byLearnCity, isLearnCity, learnCity, learnCityByPlaceId } from './learn-cities';
import { ARRIVAL_POINTS, POINT_LABEL, seedFromIntent } from './crawl-core';
import { CITY_NAME } from './city-route';
import { CAMPAIGN_PRESETS } from './city-campaign';
import { LEARN_PLACES } from './learn-places';

describe('реєстр міст навчання', () => {
  it('Київ і Житомир — ті самі значення, що були в коді до реєстру; Коростень — третім (крок 3)', () => {
    expect(LEARN_CITY_CODES).toEqual(['Kyiv', 'Zhytomyr', 'Korosten']);
    expect(LEARN_CITY_LIST).toBe('Kyiv | Zhytomyr | Korosten');
    expect(CITY_NAME).toEqual({ Kyiv: 'Київ', Zhytomyr: 'Житомир', Korosten: 'Коростень' });
    expect(ARRIVAL_POINTS).toEqual({
      Kyiv: ['kyiv.akadem', 'kyiv.sviatoshyn', 'kyiv.zhytomyrska', 'kyiv.pas', 'kyiv.borshch'],
      Zhytomyr: ['zhytomyr.avtovokzal'],
      Korosten: ['korosten.vokzal'],
    });
    expect(byLearnCity((c) => [...c.defaultOrigins])).toEqual({ Kyiv: ['kyiv.akadem', 'kyiv.pas'], Zhytomyr: ['zhytomyr.avtovokzal'], Korosten: ['korosten.vokzal'] });
    expect(byLearnCity((c) => c.maxDepth)).toEqual({ Kyiv: 1, Zhytomyr: 2, Korosten: 1 });
    expect(byLearnCity((c) => c.genitive)).toEqual({ Kyiv: 'Києва', Zhytomyr: 'Житомира', Korosten: 'Коростеня' });
  });

  it('пресети кампаній беруть типові точки й глибину з реєстру', () => {
    const learn = CAMPAIGN_PRESETS.find((p) => p.id === 'learn')!;
    expect(learn.cities).toEqual(['Kyiv', 'Zhytomyr', 'Korosten']);
    expect(learn.defaults('Korosten')).toEqual({ origins: ['korosten.vokzal'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 1 });
    expect(learn.defaults('Kyiv')).toEqual({ origins: ['kyiv.akadem', 'kyiv.pas'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 1 });
    expect(learn.defaults('Zhytomyr')).toEqual({ origins: ['zhytomyr.avtovokzal'], dirs: ['to', 'from'], main: 'weekday@09', extra: 'weekday@17', maxDepth: 2 });
    expect(CAMPAIGN_PRESETS.find((p) => p.id === 'modes')!.cities).toEqual(['Kyiv']);
    for (const id of ['refill-evening', 'refresh', 'unanswered', 'custom']) {
      expect(CAMPAIGN_PRESETS.find((p) => p.id === id)!.cities, id).toEqual(['Kyiv', 'Zhytomyr', 'Korosten']);
    }
    expect(CAMPAIGN_PRESETS.find((p) => p.id === 'custom')!.defaults('Korosten').origins).toEqual(['korosten.vokzal']);
  });

  it('кожне місто повне: точки мають підпис, типові точки — серед точок прибуття, є стартові місця', () => {
    for (const city of LEARN_CITIES) {
      expect(city.arrivalPoints.length, city.code).toBeGreaterThan(0);
      for (const id of city.arrivalPoints) expect(POINT_LABEL[id], id).toBeTruthy();
      for (const id of city.defaultOrigins) expect(city.arrivalPoints, id).toContain(id);
      expect(LEARN_PLACES[city.code].length, city.code).toBeGreaterThan(0);
      expect(learnCity(city.code)).toBe(city);
    }
    expect(new Set(LEARN_CITIES.map((c) => c.placeId)).size).toBe(LEARN_CITIES.length);
  });

  it('чуже місто не проходить; місто з розбору сторінки знаходиться за id місця', () => {
    expect(isLearnCity('Kyiv')).toBe(true);
    expect(isLearnCity('Korosten')).toBe(true);
    for (const bad of ['Malyn', 'korosten', 'kyiv', '', null, undefined, 5]) expect(isLearnCity(bad), String(bad)).toBe(false);
    expect(learnCityByPlaceId('city.Zhytomyr')).toBe('Zhytomyr');
    expect(learnCityByPlaceId('city.Korosten')).toBe('Korosten');
    expect(learnCityByPlaceId('city.Malyn')).toBeNull();
    expect(seedFromIntent({ to: { id: 'city.Kyiv', detail: ' Охматдит ' } })).toEqual({ city: 'Kyiv', place: 'Охматдит', dir: 'to' });
    expect(seedFromIntent({ from: { id: 'city.Zhytomyr', detail: 'Житній ринок' } })).toEqual({ city: 'Zhytomyr', place: 'Житній ринок', dir: 'from' });
    expect(seedFromIntent({ to: { id: 'city.Korosten', detail: 'Грушевського 22' } })).toEqual({ city: 'Korosten', place: 'Грушевського 22', dir: 'to' });
    expect(seedFromIntent({ to: { id: 'city.Malyn', detail: 'вокзал' } })).toBeNull();
  });
});
