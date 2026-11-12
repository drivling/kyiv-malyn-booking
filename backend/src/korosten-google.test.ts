/**
 * Перевірка прогонів через Google (korosten-google.ts): трійки зупинок із ланцюжків, розбір лінії Google, відстані й
 * висновок по трійці. Без мережі.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { datasetChains, decodePolyline, hopTriples, hopVerdict, normalizeLine, pointToPolylineM, segmentDeviationM, type GoogleTransitStep } from './korosten-google';

test('розбір encoded polyline (приклад із документації Google)', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
});

test('відстань до лінії і наскільки пряма зрізає поворот', () => {
  const line = [{ lat: 50.95, lng: 28.63 }, { lat: 50.95, lng: 28.64 }, { lat: 50.96, lng: 28.64 }];
  assert.ok(pointToPolylineM({ lat: 50.95, lng: 28.635 }, line) < 1);
  assert.ok(Math.abs(pointToPolylineM({ lat: 50.951, lng: 28.635 }, line) - 111) < 2);
  // пряма від початку до кінця зрізає кут — відходить від траси на сотні метрів
  assert.ok(segmentDeviationM(line[0], line[2], line) > 300);
  assert.ok(segmentDeviationM(line[0], line[1], line) < 1);
  assert.equal(normalizeLine('2-Б'), normalizeLine('2б'));
});

const dataset = {
  routes: [
    { id: '1', variants: [{ id: '1-v', directionId: '1' as const, stops: [{ stopId: 'a' }, { stopId: 'x', mapOnly: true }, { stopId: 'b' }, { stopId: 'd' }] }] },
    { id: '2b', shortName: '2-Б' },
  ],
  routeStops: [
    { routeId: '1', stopId: 'a', orderThere: 1, orderBack: 3 },
    { routeId: '1', stopId: 'b', orderThere: 2, orderBack: 2 },
    { routeId: '1', stopId: 'c', orderThere: 3, orderBack: 1 },
    { routeId: '2b', stopId: 'a', orderThere: 1, orderBack: -1 },
    { routeId: '2b', stopId: 'b', orderThere: 2, orderBack: -1 },
    { routeId: '2b', stopId: 'c', orderThere: 3, orderBack: -1 },
  ],
};

test('трійки сусідніх зупинок: спільна для маршрутів — одна; технічні точки не рахуються', () => {
  const chains = datasetChains(dataset);
  assert.deepEqual(chains.map((c) => [c.routeNo, c.directionId, c.variantId, c.stopIds.join('')]), [
    ['1', '1', null, 'abc'],
    ['1', '0', null, 'cba'],
    ['1', '1', '1-v', 'abd'],
    ['2-Б', '1', null, 'abc'],
  ]);
  const triples = hopTriples(chains);
  assert.deepEqual(triples.map((t) => [t.key, t.routes.map((r) => r.routeNo + (r.variantId ? `(${r.variantId})` : ''))]), [
    ['a>b>c', ['1', '2-Б']],
    ['c>b>a', ['1']],
    ['a>b>d', ['1(1-v)']],
  ]);
});

test('висновок по трійці: збіг, інша лінія, інша кількість перегонів, точка не на трасі, зрізаний поворот, нема транспорту', () => {
  const [triple] = hopTriples(datasetChains(dataset));
  const a = { lat: 50.95, lng: 28.63 };
  const b = { lat: 50.95, lng: 28.64 };
  const c = { lat: 50.96, lng: 28.64 };
  const road = [a, b, c];
  const step = (line: string, stopCount: number, polyline = road): GoogleTransitStep => ({ line, stopCount, departure: a, arrival: c, polyline });
  assert.equal(hopVerdict(triple, { a, b, c }, [[step('2Б', 2)]]).status, 'ok');
  assert.equal(hopVerdict(triple, { a, b, c }, [[step('5', 2)]]).status, 'other-line');
  assert.equal(hopVerdict(triple, { a, b, c }, [[step('1', 1)]]).status, 'stop-count');
  assert.equal(hopVerdict(triple, { a, b: { lat: 50.95, lng: 28.643 }, c }, [[step('1', 2)]]).status, 'off-route');
  // наша B на трасі, але траса Google іде іншим боком: прямі відходять далеко від неї
  const detour = [a, { lat: 50.945, lng: 28.63 }, { lat: 50.945, lng: 28.645 }, b, c];
  assert.equal(hopVerdict(triple, { a, b, c }, [[step('1', 2, detour)]]).status, 'cut');
  assert.equal(hopVerdict(triple, { a, b, c }, []).status, 'no-transit');
  // пересадка (два кроки) — не наш прямий маршрут
  assert.equal(hopVerdict(triple, { a, b, c }, [[step('1', 1), step('7', 1)]]).status, 'other-line');
});
