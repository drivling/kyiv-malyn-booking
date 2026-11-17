import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseLocal } from '../nlu/parseLocal';
import { setStopPlaces } from '../nlu/places';
import type { RouteLike } from '../nlu/routes';
import stopsFile from '../eval/korosten-stops.json';
import routesFile from '../eval/korosten-routes.json';
import { buildKorostenPlaces, isKorostenQuestion, korostenShape, mentionsOtherCity, remapForKorosten } from './korostenCity';

const routes = routesFile.routes as RouteLike[];
const index = buildKorostenPlaces(stopsFile.stops);
const now = { date: '2026-11-18', mins: 8 * 60 };

beforeAll(() => setStopPlaces(index));
afterAll(() => setStopPlaces([]));

function ask(q: string) {
  const intent = remapForKorosten(parseLocal(q, now, index, routes).intent);
  return { intent, shape: korostenShape(intent) };
}

describe('«Доведе» в Коростені: місця й форма відповіді', () => {
  it('народні назви й відмінки → зупинки Коростеня, поїздка містом', () => {
    const cases: Array<[string, string, string]> = [
      ['з Пашин до міськлікарні', 'st_1087', 'st_1079'],
      ['як доїхати від Гастелло до вокзалу', 'st_1069', 'st_1001'],
      ['з ринку на Грозине', 'st_1002', 'st_1101'],
      ['з Чолівки в центр', 'st_1010', 'st_1003'],
      ['від Черемушок до водосховища', 'st_1006', 'st_1015'],
      ['з вокзалу до Київської', 'st_1001', 'st_1044'],
      ['з Коростеня-Подільського до районної лікарні', 'st_1031', 'st_1073'],
      ['з Пашин до лікарні', 'st_1087', 'st_1079'],
    ];
    for (const [q, from, to] of cases) {
      const { intent, shape } = ask(q);
      expect([intent.from?.id, intent.to?.id], q).toEqual([from, to]);
      expect(shape.kind, q).toBe('intra');
    }
  });

  it('«в Коростені» — уточнення міста, не місце; «Коростень-Подільський» — зупинка', () => {
    for (const q of ['як у Коростені доїхати з Пашин до ринку', 'з Пашин до ринку в Коростені', 'Коростень: з Пашин до ринку']) {
      const { intent } = ask(q);
      expect([intent.from?.id, intent.to?.id], q).toEqual(['st_1087', 'st_1002']);
    }
    expect(ask('з Коростеня-Подільського до центру').intent.from?.id).toBe('st_1031');
  });

  it('номер маршруту без пари місць — картка маршруту; «2-Б» — свій маршрут, не №2', () => {
    const four = ask('коли №4 на Грозине');
    expect(four.intent.routes).toEqual(['4']);
    expect(four.shape).toMatchObject({ kind: 'route_info', routeIds: ['4'] });
    const twoB = ask('куди їде №2-Б');
    expect(twoB.intent.routes).toEqual(['2b']);
    expect(ask('куди їде №2').intent.routes).toEqual(['2']);
  });

  it('малинські місця, яких у Коростені нема, — невідомі слова, а не малинська відповідь', () => {
    const { intent, shape } = ask('з Царського села до вокзалу');
    expect(intent.from).toBeNull();
    expect(intent.to?.id).toBe('st_1001');
    expect(shape.kind).toBe('unknown_place');
  });

  it('куди — без звідки: питаємо звідки', () => {
    expect(ask('як доїхати до Грозиного').shape).toMatchObject({ kind: 'ask_from' });
  });
});

describe('isKorostenQuestion', () => {
  it('коростенські слова без інших міст — так; міжміські й малинські питання — ні', () => {
    expect(isKorostenQuestion('як у Коростені доїхати до вокзалу')).toBe(true);
    expect(isKorostenQuestion('з Пашин до міськлікарні')).toBe(true);
    expect(isKorostenQuestion('коли №4 на Грозине')).toBe(true);
    expect(isKorostenQuestion('з Коростеня в Малин')).toBe(false);
    expect(isKorostenQuestion('з Коростеня до Києва')).toBe(false);
    expect(isKorostenQuestion('з Царського села на вокзал')).toBe(false);
    expect(mentionsOtherCity('з Пашин до Малина')).toBe(true);
    expect(mentionsOtherCity('з Пашин до ринку')).toBe(false);
  });
});
