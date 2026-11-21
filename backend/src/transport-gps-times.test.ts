/**
 * Час у дорозі з GPS-треків (Docs/dovede-learning-roadmap.md, крок 6): проєкція на лінію, проїзди, зважена медіана,
 * звіт «наш час / за GPS» і ендпоінт адмінки.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { listenLocal } from './http-test-server';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { createTransportTestStore } from './transport-test-store';
import type { TransportDataset } from './local-transport';
import { parseRunTimesDays } from './transport-gps';
import { buildChainLine, buildRunTimes, findPasses, normalizeRouteNo, projectOnChain, weightedMedian, type GpsPoint } from './transport-gps-times';

/** пряма вулиця на схід: 1° довготи на широті 50.95 ≈ 70 063 м */
const LAT = 50.95;
const M_PER_DEG = (Math.PI / 180) * 6_371_000 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (m: number) => 28.6 + m / M_PER_DEG;
const stop = (id: string, m: number, name = id) => ({ id, name, lat: LAT, lng: lngAt(m) });

/** маршрут «7»: A —1000 м— B —500 м (через технічну точку)— C —1500 м— D; назад тими самими зупинками */
function dataset(): TransportDataset {
  const stops = [stop('A', 0), stop('B', 1000), stop('t1', 1250, '№7 т.1'), stop('C', 1500), stop('D', 3000)];
  const order = ['A', 'B', 't1', 'C', 'D'];
  return {
    stops,
    routes: [{ id: '7', fromName: 'A', toName: 'D', shortName: '7-А' }] as TransportDataset['routes'],
    routeStops: order.map((stopId, i) => ({ routeId: '7', stopId, orderThere: i + 1, orderBack: order.length - i, mapOnly: stopId === 't1' })),
    trips: [
      { id: '7-1', routeId: '7', directionId: '1', departureTime: '08:00:00', arrivalTime: '08:12:00' },
      { id: '7-2', routeId: '7', directionId: '1', departureTime: '09:00:00', arrivalTime: '09:10:00' },
      { id: '7-3', routeId: '7', directionId: '1', departureTime: '10:00:00', arrivalTime: '10:11:00', endStopId: 'C' },
    ],
    segments: [
      { routeId: '7', fromStopId: 'A', toStopId: 'B', seconds: 120 },
      { routeId: '7', fromStopId: 'B', toStopId: 't1', seconds: 60 },
      { routeId: '7', fromStopId: 't1', toStopId: 'C', seconds: 60 },
      { routeId: '7', fromStopId: 'C', toStopId: 'D', seconds: 120 },
    ],
    meta: { defaultSec: 120 },
  };
}

/** рейс автобуса лінією: `speeds` — км/год на кожному з трьох відрізків, точка кожні `everySec` */
function run(vehicleId: string, startIso: string, speeds: [number, number, number], everySec: number, reverse = false, routeNo = '7А'): GpsPoint[] {
  const bounds = [0, 1000, 1500, 3000];
  const out: GpsPoint[] = [];
  const t0 = new Date(startIso).getTime();
  const total = bounds.slice(1).reduce((n, b, i) => n + (b - bounds[i]) / (speeds[i] / 3.6), 0);
  for (let t = 0; t <= total + 1; t += everySec) {
    let left = t;
    let m = 3000;
    for (let i = 0; i < 3; i++) {
      const v = speeds[i] / 3.6;
      const dur = (bounds[i + 1] - bounds[i]) / v;
      if (left <= dur) {
        m = bounds[i] + left * v;
        break;
      }
      left -= dur;
    }
    out.push({ vehicleId, routeNo, at: new Date(t0 + t * 1000), lat: LAT, lng: lngAt(reverse ? 3000 - m : m), speed: 20 });
  }
  return out;
}

test('normalizeRouteNo: номер із фіду збігається з номером для показу й id', () => {
  assert.equal(normalizeRouteNo('2-Б'), '2Б');
  assert.equal(normalizeRouteNo(' 2 б '), '2Б');
  assert.equal(normalizeRouteNo('2b'), '2B');
});

test('projectOnChain: відстань уздовж лінії й відступ; далеко від лінії — нічого; лінія, що підходить до себе, — два місця', () => {
  const line = buildChainLine([
    { id: 'A', lat: LAT, lng: lngAt(0), technical: false },
    { id: 'B', lat: LAT, lng: lngAt(1000), technical: false },
  ]);
  const [hit] = projectOnChain(line, LAT + 20 / 111_195, lngAt(400));
  assert.ok(Math.abs(hit.s - 400) < 1 && Math.abs(hit.off - 20) < 1);
  assert.deepEqual(projectOnChain(line, LAT + 200 / 111_195, lngAt(400)), []);
  // туди й назад тією самою вулицею в одному ланцюжку (заїзд): точка лягає на обидва боки
  const spur = buildChainLine([
    { id: 'A', lat: LAT, lng: lngAt(0), technical: false },
    { id: 'B', lat: LAT, lng: lngAt(1000), technical: false },
    { id: 'C', lat: LAT + 300 / 111_195, lng: lngAt(1000), technical: false },
    { id: 'D', lat: LAT + 300 / 111_195, lng: lngAt(0), technical: false },
    { id: 'E', lat: LAT + 30 / 111_195, lng: lngAt(0), technical: false },
    { id: 'F', lat: LAT + 30 / 111_195, lng: lngAt(1000), technical: false },
  ]);
  assert.equal(projectOnChain(spur, LAT + 15 / 111_195, lngAt(500)).length, 2);
});

test('weightedMedian: вага зсуває медіану; порожньо — null', () => {
  assert.equal(weightedMedian([{ value: 1, weight: 1 }, { value: 2, weight: 1 }, { value: 10, weight: 1 }]), 2);
  assert.equal(weightedMedian([{ value: 1, weight: 1 }, { value: 10, weight: 5 }]), 10);
  assert.equal(weightedMedian([]), null);
});

test('findPasses: проїзд рахується лише в напрямку руху; стоянка на кінцевій і великі проміжки — ні', () => {
  const ds = dataset();
  const pts = (ids: string[]) => ids.map((id) => ({ id, ...ds.stops.find((s) => s.id === id)!, technical: id === 't1' }));
  const there = buildChainLine(pts(['A', 'B', 't1', 'C', 'D']));
  const back = buildChainLine(pts(['D', 'C', 't1', 'B', 'A']));
  const bus = run('bus', '2026-11-18T08:00:00Z', [20, 20, 20], 60);
  assert.ok(findPasses(there, bus).length >= 7);
  assert.equal(findPasses(back, bus).length, 0);
  // стоїть на початку (швидкість 0), потім їде: перший проміжок — відстій, не дорога
  const standing: GpsPoint[] = [
    { vehicleId: 's', routeNo: '7', at: '2026-11-18T08:00:00Z', lat: LAT, lng: lngAt(10), speed: 0 },
    { vehicleId: 's', routeNo: '7', at: '2026-11-18T08:05:00Z', lat: LAT, lng: lngAt(900), speed: 25 },
    { vehicleId: 's', routeNo: '7', at: '2026-11-18T08:07:00Z', lat: LAT, lng: lngAt(1700), speed: 25 },
  ];
  assert.deepEqual(findPasses(there, standing).map((p) => Math.round(p.from)), [900]);
  // точки з проміжком понад 10 хв — не один проїзд
  const gap: GpsPoint[] = [
    { vehicleId: 'g', routeNo: '7', at: '2026-11-18T08:00:00Z', lat: LAT, lng: lngAt(200), speed: 20 },
    { vehicleId: 'g', routeNo: '7', at: '2026-11-18T08:20:00Z', lat: LAT, lng: lngAt(2500), speed: 20 },
  ];
  assert.equal(findPasses(there, gap).length, 0);
});

test('buildRunTimes: часті точки відтворюють час кожного відрізка; рідкі — загальний час; довіра за кількістю проїздів', () => {
  const ds = dataset();
  // 12 рейсів «туди»: 30, 15 і 45 км/год → по 120 с на кожен відрізок; точка раз на хвилину (кожна третя з 20-секундних)
  const dense = Array.from({ length: 12 }, (_, i) => run(`d${i}`, `2026-11-18T${String(6 + i).padStart(2, '0')}:00:00Z`, [30, 15, 45], 20)).flat();
  const report = buildRunTimes(ds, dense.filter((_, i) => i % 3 === 0));
  assert.deepEqual(report.unknownRouteNos, []);
  const route = report.routes[0];
  assert.equal(route.routeId, '7');
  assert.equal(route.routeNo, '7-А');
  const there = route.directions.find((d) => d.direction === 'there')!;
  assert.deepEqual(there.spans.map((s) => [s.fromStopId, s.toStopId, s.meters, s.ourSec]), [['A', 'B', 1000, 120], ['B', 'C', 500, 120], ['C', 'D', 1500, 120]]);
  for (const s of there.spans) assert.equal(s.confidence, 'ok', `${s.fromStopId}→${s.toStopId}`);
  const near = (got: number | null, want: number, tol: number) => assert.ok(got !== null && Math.abs(got - want) <= tol, `${got} ≈ ${want}`);
  near(there.spans[0].gpsSec, 120, 15);
  near(there.spans[2].gpsSec, 120, 15);
  near(there.gpsSec, 360, 40);
  assert.equal(there.ourSec, 360);
  assert.equal(there.covered, 1);
  // розклад: медіана повних рейсів напрямку (12 і 10 хв), скорочений рейс не рахується
  assert.equal(there.timetableSec, 660);
  // «назад» ніхто не їхав
  const back = route.directions.find((d) => d.direction === 'back')!;
  assert.equal(back.gpsSec, null);
  assert.ok(back.spans.every((s) => s.confidence === 'none' && s.gpsSec === null));

  // рідкі точки (раз на 4 хв) і лише два рейси: проїздів мало — довіри немає
  const sparse = [run('s1', '2026-11-18T08:00:00Z', [20, 20, 20], 240), run('s2', '2026-11-18T09:00:00Z', [20, 20, 20], 240)].flat();
  const few = buildRunTimes(ds, sparse).routes[0].directions[0];
  assert.ok(few.spans.every((s) => s.confidence !== 'ok'));

  // номер маршруту, якого немає в датасеті
  assert.deepEqual(buildRunTimes(ds, [{ vehicleId: 'x', routeNo: '99', at: '2026-11-18T08:00:00Z', lat: LAT, lng: lngAt(0), speed: 10 }]).unknownRouteNos, ['99']);
});

test('GET /admin/transport/gps/run-times: лише адмін, лише місто запиту, days 1–30; без точок — порожній звіт, не помилка', async () => {
  assert.equal(parseRunTimesDays(undefined), 7);
  assert.equal(parseRunTimesDays('30'), 30);
  assert.equal(parseRunTimesDays('0'), null);
  assert.equal(parseRunTimesDays('31'), null);
  assert.equal(parseRunTimesDays('x'), null);

  const now = Date.now();
  const store = createTransportTestStore({
    tripPoint: [
      { id: 1, code: 'Malyn', hasLocalTransport: true },
      { id: 2, code: 'Korosten', hasLocalTransport: false },
    ],
    transportVehiclePosition: [
      { id: 1, cityCode: 'Korosten', vehicleId: 'a', plate: 'P', routeNo: '1', at: new Date(now - 3_600_000), lat: 50.9, lng: 28.6, speed: 10, satellites: 8, createdAt: new Date() },
      { id: 2, cityCode: 'Korosten', vehicleId: 'a', plate: 'P', routeNo: '1', at: new Date(now - 40 * 86_400_000), lat: 50.9, lng: 28.6, speed: 10, satellites: 8, createdAt: new Date() },
      { id: 3, cityCode: 'Malyn', vehicleId: 'm', plate: 'P', routeNo: '1', at: new Date(now - 3_600_000), lat: 50.7, lng: 29.2, speed: 10, satellites: 8, createdAt: new Date() },
    ],
  });
  const app = await listenLocal(createApp({ prisma: store.prisma as unknown as PrismaClient, adminPassword: 'gps-times' }));
  const auth = { Authorization: adminAuthToken('gps-times') };
  await request(app).get('/admin/transport/gps/run-times?city=Korosten').expect(401);
  await request(app).get('/admin/transport/gps/run-times?city=Korosten&days=0').set(auth).expect(400);
  await request(app).get('/admin/transport/gps/run-times?city=Nowhere').set(auth).expect(404);
  const res = await request(app).get('/admin/transport/gps/run-times?city=Korosten&days=7').set(auth).expect(200);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.body.cityCode, 'Korosten');
  assert.equal(res.body.points, 1);
  assert.deepEqual(res.body.routes, []);
  assert.ok(!JSON.stringify(res.body).includes('plate'));
  const empty = await request(app).get('/admin/transport/gps/run-times?city=Malyn&days=1').set(auth).expect(200);
  assert.equal(empty.body.points, 1);
  assert.equal(typeof empty.body.from, 'string');
});
