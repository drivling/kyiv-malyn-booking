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
  combineCorridor,
  isKorostenQuestion,
  korostenStopByLabel,
  mergeKorostenSpans,
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

  it('малинське місце + «в Коростень» / «з Коростеня» — лишаємось у Малині, поїздка коридором (етап 3)', () => {
    for (const q of [
      'як доїхати з Паперової фабрики в Коростень до міської лікарні',
      'з Коростеня до Паперової фабрики',
      'з автостанції в Коростень',
      'з Царського села до Коростеня',
      'з вокзалу в Коростень',
    ]) {
      expect(switches(q), q).toBe(false);
      expect(classify(malyn(q)), q).toMatchObject({ kind: expect.stringMatching(/^(from|to)_malyn$/), far: 'Korosten' });
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

describe('combineCorridor: два розбори одного питання → поїздка Малин ↔ Коростень (етап 3)', () => {
  const malynIndex = buildStopPlaces(malynStopsFile.stops);
  const malynRoutes = malynRoutesFile.routes as RouteLike[];
  beforeAll(() => setStopPlaces(malynIndex));
  afterAll(() => setStopPlaces(index));
  const combine = (q: string) => combineCorridor(parseLocal(q, now, malynIndex, malynRoutes).intent, parseLocal(q, now, index).intent, index);
  const ends = (q: string) => {
    const c = combine(q);
    return c ? [c.from?.id, c.from?.detail ?? null, c.to?.id, c.to?.detail ?? null, c.unknown] : null;
  };

  it('місце Малина + зупинка Коростеня — в обидва боки; зупинка — `detail` міста, невідомих слів не лишається', () => {
    expect(ends('як доїхати з Паперової фабрики в Коростень до міської лікарні')).toEqual(['malyn.paperova', null, 'city.Korosten', 'Міськлікарня', []]);
    expect(ends('з Пашин до Паперової фабрики')).toEqual(['city.Korosten', 'Пашини', 'malyn.paperova', null, []]);
    expect(ends('з Паперової фабрики в Коростень на вокзал')).toEqual(['malyn.paperova', null, 'city.Korosten', 'Залізничний вокзал', []]);
    expect(ends('з міськлікарні Коростеня на автостанцію')).toEqual(['city.Korosten', 'Міськлікарня', 'malyn.avtostantsiya', null, []]);
    expect(ends('з Пашин до Малина')).toEqual(['city.Korosten', 'Пашини', 'city.Malyn', null, []]);
    expect(ends('як з Малина доїхати до Коростеня до Грозиного')).toEqual(['city.Malyn', null, 'city.Korosten', 'Грозине', []]);
  });

  it('«з вокзалу в Коростень» — вокзал малинський; без зупинки Коростеня кінець — місто', () => {
    expect(ends('з вокзалу в Коростень')).toEqual(['malyn.vokzal', null, 'city.Korosten', null, []]);
    expect(ends('з Коростеня до Паперової фабрики')).toEqual(['city.Korosten', null, 'malyn.paperova', null, []]);
  });

  it('обидва кінці в Коростені чи інше місто — не коридор', () => {
    expect(combine('з Пашин до міськлікарні')).toBeNull();
    expect(combine('у Коростені з вокзалу до ринку')).toBeNull();
    expect(combine('з Пашин до ринку')).toBeNull();
    expect(combine('з Києва до Коростеня')).toBeNull();
  });

  it('korostenStopByLabel: назва з `detail` → зупинка датасету', () => {
    expect(korostenStopByLabel(index, 'Міськлікарня')).toBe('st_1079');
    expect(korostenStopByLabel(index, 'Пашини')).toBe('st_1087');
    expect(korostenStopByLabel(index, 'Паперова фабрика')).toBeNull();
  });
});

describe('mergeKorostenSpans: підсвічування коростенських слів на сторінці Малина', () => {
  const malynIndex = buildStopPlaces(malynStopsFile.stops);
  const malynRoutes = malynRoutesFile.routes as RouteLike[];
  beforeAll(() => setStopPlaces(malynIndex));
  afterAll(() => setStopPlaces(index));
  const marked = (q: string) =>
    mergeKorostenSpans(parseLocal(q, now, malynIndex, malynRoutes).spans, parseLocal(q, now, index).spans).map((s) => `${s.kind}:${q.slice(s.start, s.end)}`);

  it('коростенські місця підсвічені; «невідоме» слово стає місцем; малинське лишається малинським', () => {
    // шматок місця бере й прийменник, як і в малинському розборі
    expect(marked('з Паперової фабрики в Коростень до міськлікарні')).toEqual(['from:з Паперової', 'to:в Коростень', 'to:до міськлікарні']);
    const pashyny = marked('з Пашин до Паперової фабрики');
    expect(pashyny[0]).toBe('from:з Пашин');
    expect(pashyny.some((x) => x.startsWith('unknown:'))).toBe(false);
    expect(pashyny.some((x) => x.startsWith('to:') && x.includes('Паперової'))).toBe(true);
  });

  it('шматки не перекриваються', () => {
    for (const q of ['з вокзалу в Коростень', 'як з Малина доїхати до Коростеня до Грозиного', 'з міськлікарні Коростеня на автостанцію о 9']) {
      const spans = mergeKorostenSpans(parseLocal(q, now, malynIndex, malynRoutes).spans, parseLocal(q, now, index).spans);
      for (let i = 1; i < spans.length; i++) expect(spans[i].start, q).toBeGreaterThanOrEqual(spans[i - 1].end);
    }
  });
});
