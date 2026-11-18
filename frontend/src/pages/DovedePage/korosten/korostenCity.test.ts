import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseLocal } from '../nlu/parseLocal';
import { setStopPlaces } from '../nlu/places';
import type { RouteLike } from '../nlu/routes';
import { buildStopPlaces } from '../nlu/stopPlaces';
import { classify } from '../compose/composeStories';
import stopsFile from '../eval/korosten-stops.json';
import routesFile from '../eval/korosten-routes.json';
import malynStopsFile from '../eval/malyn-stops.json';
import malynRoutesFile from '../eval/malyn-routes.json';
import {
  buildKorostenPlaces,
  isKorostenQuestion,
  isMalynKorostenTrip,
  korostenShape,
  mentionsOtherCity,
  namesKorostenAsEnd,
  remapForKorosten,
} from './korostenCity';

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

describe('поїздка Малин ↔ Коростень — питання Малина, а не міста Коростеня (етап 3)', () => {
  const malynIndex = buildStopPlaces(malynStopsFile.stops);
  const malynRoutes = malynRoutesFile.routes as RouteLike[];
  beforeAll(() => setStopPlaces(malynIndex));
  afterAll(() => setStopPlaces(index));
  const malyn = (q: string) => parseLocal(q, now, malynIndex, malynRoutes).intent;
  /** те саме рішення, що й на сторінці в Малині: перемкнути на Коростень? */
  const switches = (q: string) => isKorostenQuestion(q) && !isMalynKorostenTrip(q, malyn(q));

  it('малинське місце + «в Коростень» / «з Коростеня» — лишаємось у Малині, відповідь «вчу»', () => {
    for (const q of [
      'як доїхати з Паперової фабрики в Коростень до міської лікарні',
      'з Коростеня до Паперової фабрики',
      'з автостанції в Коростень',
      'з Царського села до Коростеня',
      'з вокзалу в Коростень',
    ]) {
      expect(switches(q), q).toBe(false);
      expect(classify(malyn(q)), q).toEqual({ kind: 'outside', city: 'Korosten' });
    }
  });

  it('питання містом Коростенем як і раніше перемикають сторінку', () => {
    for (const q of [
      'з Пашин до міськлікарні',
      'коли №4 на Грозине',
      'як у Коростені доїхати з Пашин до ринку',
      'з Пашин до ринку в Коростені',
      'Коростень: з Пашин до ринку',
      'в Коростені з вокзалу до ринку',
      'з вокзалу до центру в Коростені',
      'з центру Коростеня на вокзал',
      'з Пашин до Коростеня-Подільського',
    ]) {
      expect(switches(q), q).toBe(true);
    }
  });

  it('Київ і Житомир правило не зачіпає: без слова «Коростень» воно не спрацьовує, малинська відповідь та сама', () => {
    for (const q of ['з вокзалу в Київ', 'з ринку до Житомира', 'з Паперової фабрики на Академмістечко', 'з Житомира на автостанцію']) {
      expect(isKorostenQuestion(q), q).toBe(false);
      expect(isMalynKorostenTrip(q, malyn(q)), q).toBe(false);
      expect(namesKorostenAsEnd(q), q).toBe(false);
      expect(['from_malyn', 'to_malyn'], q).toContain(classify(malyn(q)).kind);
    }
    // Коростень разом з Києвом чи Житомиром — теж не місто Коростень (`mentionsOtherCity`), сторінка лишається в Малині
    expect(switches('з Коростеня до Києва')).toBe(false);
  });

  it('namesKorostenAsEnd: у режимі Коростеня «в Коростень» повертає сторінку в Малин', () => {
    expect(namesKorostenAsEnd('з Паперової фабрики в Коростень')).toBe(true);
    expect(namesKorostenAsEnd('з Коростеня до лікарні')).toBe(true);
    expect(namesKorostenAsEnd('як у Коростені доїхати до вокзалу')).toBe(false);
    expect(namesKorostenAsEnd('з центру Коростеня на вокзал')).toBe(false);
    expect(namesKorostenAsEnd('з Пашин до Коростеня-Подільського')).toBe(false);
    expect(namesKorostenAsEnd('Коростень: з Пашин до ринку')).toBe(false);
  });
});
