/** «Доведе» — синоніми з адмінки: фраза в будь-якому відмінку веде до місця; сильніші за решту словників. */
import { afterEach, describe, expect, it } from 'vitest';
import malynStops from '../eval/malyn-stops.json';
import { parseLocal } from './parseLocal';
import { setStopPlaces } from './places';
import { buildStopPlaces } from './stopPlaces';
import { setSynonyms } from './synonyms';

const NOW = { date: '2026-11-13', mins: 14 * 60 + 20 };
const STOPS = buildStopPlaces(malynStops.stops);
setStopPlaces(STOPS);
const parse = (text: string) => parseLocal(text, NOW, STOPS).intent;

afterEach(() => setSynonyms([]));

describe('«Доведе» — синоніми з адмінки', () => {
  it('без синоніма слово невідоме; з ним — місце, і розбір упевнений', () => {
    expect(parse('з вокзалу до епіцентру').to).toBeNull();
    setSynonyms([{ phrase: 'епіцентр', placeId: 'lm.atb-market' }]);
    const i = parse('з вокзалу до епіцентру');
    expect(i.to).toEqual({ id: 'lm.atb-market', text: 'епіцентру' });
    expect(i.unknown).toEqual([]);
    expect(i.confidence).toBe('high');
    expect(parse('з Епіцентра на вокзал').from?.id).toBe('lm.atb-market');
  });

  it('фраза з кількох слів, довша перемагає коротшу; місцем може бути зупинка, вулиця чи район', () => {
    setSynonyms([
      { phrase: 'нова пошта', placeId: 'lm.nova-poshta-viddilennia-1' },
      { phrase: 'нова пошта на бамі', placeId: 'malyn.tsarske' },
      { phrase: 'бам', placeId: 'st_0071' },
      { phrase: 'до тітки', placeId: 'street.horodyshchanska' },
    ]);
    expect(parse('до нової пошти на бамі з вокзалу').to?.id).toBe('malyn.tsarske');
    expect(parse('до нової пошти з вокзалу').to?.id).toBe('lm.nova-poshta-viddilennia-1');
    expect(parse('з вокзалу на бам').to?.id).toBe('st_0071');
  });

  it('синонім сильніший за кураторське слово; синонім на неіснуюче місце не діє', () => {
    setSynonyms([{ phrase: 'лікарня', placeId: 'malyn.vokzal' }, { phrase: 'епіцентр', placeId: 'lm.nema-takoho' }]);
    expect(parse('до лікарні').to?.id).toBe('malyn.vokzal');
    expect(parse('до епіцентру').to).toBeNull();
  });
});
