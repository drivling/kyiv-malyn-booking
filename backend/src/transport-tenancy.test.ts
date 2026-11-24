/**
 * Tenancy (Docs/transport-tenancy-2026-11.md): кожен запит до транспортних таблиць обмежений містом; рядки
 * іншого міста не впливають на Малин і не зачіпаються його записами; ?city= відкриває неопубліковане місто
 * лише адміну. M2: ключі складені з містом — два міста можуть мати однакові id, адмін пише датасет кожного
 * окремо; відкриті дані іншого міста поки закриті.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { listenLocal, type LocalServer } from './http-test-server';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { kyivClock } from './arrival-reports';
import { ensureInitialTransportRevision } from './transport-revisions';
import { DEFAULT_TRANSPORT_CITY, parseTransportCity } from './transport-city';
import { TRANSPORT_MODELS, createTransportTestStore, type StoreCall, type StoreRow, type TransportTestStore } from './transport-test-store';

const ADMIN = 'tenancy-test-password';
const auth = { Authorization: adminAuthToken(ADMIN) };
const hhmm = (mins: number) => `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const malynDataset = () => ({
  stops: [
    { id: 'st_0001', name: 'Автостанція', lat: 50.77, lng: 29.24 },
    { id: 'st_0002', name: 'Ринок', lat: 50.771, lng: 29.25 },
  ],
  routes: [{ id: '2', fromName: 'Автостанція', toName: 'Ринок' }],
  routeStops: [
    { routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 2 },
    { routeId: '2', stopId: 'st_0002', orderThere: 2, orderBack: 1 },
  ],
  trips: [{ id: '2-01', routeId: '2', serviceId: 'everyday', headsign: 'Ринок', directionId: '1', departureTime: '07:00:00', blockId: null }],
  segments: [{ routeId: '2', fromStopId: 'st_0001', toStopId: 'st_0002', seconds: 120 }],
  meta: { defaultSec: 120, center: [50.768, 29.242] },
});

/** Рядки Коростеня, як вони лежатимуть у базі після M2 (тут — напряму в сховище) */
function korostenRows(): Record<string, StoreRow[]> {
  const cityCode = 'Korosten';
  return {
    transportStop: [
      { cityCode, id: 'st_1001', name: 'Залізничний вокзал', lat: 50.95, lng: 28.64 },
      { cityCode, id: 'st_1002', name: 'Міський центральний ринок', lat: 50.951, lng: 28.65 },
    ],
    transportRoute: [{ cityCode, id: 'k1', fromName: 'Залізничний вокзал', toName: 'Міський центральний ринок', scheme: '', note: '', sourceUrl: '', schedule: null, unreliable: false, shortName: '1', variants: null }],
    transportRouteStop: [
      { cityCode, id: 9001, routeId: 'k1', stopId: 'st_1001', orderThere: 1, orderBack: 2, mapOnly: false },
      { cityCode, id: 9002, routeId: 'k1', stopId: 'st_1002', orderThere: 2, orderBack: 1, mapOnly: false },
    ],
    transportTrip: [{ cityCode, id: 'k1-01', routeId: 'k1', serviceId: 'everyday', headsign: '', directionId: '1', departureTime: '06:30:00', blockId: null, wheelchairAccessible: '', bikesAllowed: '', startStopId: null, endStopId: null, arrivalTime: null, variantId: null, timepoints: null }],
    transportSegment: [{ cityCode, id: 9001, routeId: 'k1', fromStopId: 'st_1001', toStopId: 'st_1002', seconds: 180 }],
    transportMeta: [{ cityCode, id: 2, payload: { defaultSec: 120, center: [50.95, 28.64] }, updatedAt: new Date('2026-11-05T09:00:00Z') }],
    transportRevision: [{ cityCode, revision: '2026-11-05T09:00:00.000Z', createdAt: new Date('2026-11-05T09:00:00Z'), source: 'dataset', stats: {}, diff: null }],
    stickerScan: [{ cityCode, id: 9001, stopId: 'st_1001', side: 'a', clientId: 'kkkk-1111-kkkk', createdAt: new Date() }],
    stickerReturn: [{ cityCode, id: 9001, stopId: 'st_1001', side: 'a', clientId: 'kkkk-1111-kkkk', via: 'tab', page: 'transport', createdAt: new Date() }],
    stickerPrint: [{ cityCode, id: 9001, stopId: 'st_1001', side: 'a', size: 'A5', createdAt: new Date() }],
    stickerPerson: [{ cityCode, id: 9001, clientId: 'kkkk-1111-kkkk', firstStopId: 'st_1001', firstSide: 'a', firstAt: new Date(), lastStopId: 'st_1001', lastSide: 'a', lastAt: new Date(), scans: 1, stopIds: ['st_1001'], scanDays: 1, lastScanDay: null, returns: 1, lastReturnAt: null, teaserAt: null }],
    transportArrivalReport: [{ cityCode, id: 9001, kind: 'arrived', routeId: 'k1', tripId: 'k1-01', direction: 'there', stopId: 'st_1001', serviceDate: kyivClock(new Date()).date, scheduledTime: '06:30', actualTime: '06:31', delayMin: 1, waitedMin: null, source: 'route', clientId: null, clientEventId: null, createdAt: new Date() }],
    transportVehiclePosition: [{ cityCode, id: 9001, vehicleId: '863071012345678', plate: 'АМ 2298 ЕК', routeNo: '2Б', at: new Date('2026-11-17T07:59:45Z'), lat: 50.96, lng: 28.65, speed: 0, satellites: 9, createdAt: new Date() }],
  };
}

async function setup(opts: { korosten?: boolean; korostenPublished?: boolean } = {}): Promise<{ store: TransportTestStore; app: LocalServer }> {
  const store = createTransportTestStore({
    ...(opts.korosten ? korostenRows() : {}),
    tripPoint: [
      { id: 1, code: 'Malyn', nameUk: 'Малин', hasLocalTransport: true, sortOrder: 10 },
      { id: 2, code: 'Korosten', nameUk: 'Коростень', hasLocalTransport: opts.korostenPublished === true, sortOrder: 40 },
    ],
  });
  const app = await listenLocal(createApp({ prisma: store.prisma, adminPassword: ADMIN }));
  await request(app).put('/transport/dataset').set(auth).send(malynDataset()).expect(200);
  return { store, app };
}

/** Чи обмежений виклик містом: cityCode у where, у даних рядка(ів) або в create для upsert */
function scoped(call: StoreCall): boolean {
  const args = call.args as { where?: StoreRow; data?: StoreRow | StoreRow[]; create?: StoreRow };
  if (typeof args.where?.cityCode === 'string') return true;
  // складений ключ: { cityCode_id: { cityCode, id } }, { cityCode_revision: { cityCode, revision } }
  if (Object.values(args.where ?? {}).some((v) => v && typeof v === 'object' && typeof (v as StoreRow).cityCode === 'string')) return true;
  if (call.method === 'create') return typeof (args.data as StoreRow)?.cityCode === 'string';
  if (call.method === 'createMany') return (args.data as StoreRow[]).every((row) => typeof row.cityCode === 'string');
  if (call.method === 'upsert') return typeof args.create?.cityCode === 'string';
  return false;
}

test('parseTransportCity: без параметра — Малин; місто з транспортом без урахування регістру; решта — null', () => {
  assert.equal(parseTransportCity(undefined), DEFAULT_TRANSPORT_CITY);
  assert.equal(parseTransportCity(''), 'Malyn');
  assert.equal(parseTransportCity(' malyn '), 'Malyn');
  assert.equal(parseTransportCity('KOROSTEN'), 'Korosten');
  // домен Житомира ще не підключено, але транспорт міста вже готується (site-domains.ts, transport)
  assert.equal(parseTransportCity('zhytomyr'), 'Zhytomyr');
  assert.equal(parseTransportCity('Kyiv'), null);
  assert.equal(parseTransportCity(['Malyn']), null);
});

test('кожен запит до транспортних таблиць несе cityCode', async () => {
  const { store, app } = await setup();
  const now = kyivClock(new Date()).mins;
  await request(app).get('/transport/dataset').expect(200);
  await request(app).get('/transport/gtfs.zip').expect(200);
  await request(app).get('/transport/gtfs/stops.txt').expect(200);
  await request(app).get('/transport/changes.rss').expect(200);
  await request(app).get('/transport/revisions').expect(200);
  await request(app).get('/transport/route/2/calendar.ics').expect(200);
  await request(app).get('/transport/stop-redirects').expect(200);
  await request(app).get('/transport/stops/st_0001').expect(200);
  await request(app).put('/admin/transport/stop-redirects').set(auth).send({ redirects: { st_0099: 'st_0001' } }).expect(200);
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_0001', side: 'a' }).expect(201);
  // з id браузера — ще й людина з наклейок (StickerPerson): новий запис, повтор, повернення
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_0001', side: 'b', clientId: 'abcd-1234-efgh' }).expect(201);
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_0001', side: 'b', clientId: 'abcd-1234-efgh' }).expect(200);
  await request(app).post('/transport/sticker-returns').send({ stopId: 'st_0001', side: 'a', clientId: 'abcd-1234-efgh', via: 'reload', page: 'transport' }).expect(201);
  await request(app).post('/admin/transport/sticker-prints').set(auth).send({ stopId: 'st_0001', sides: ['a'], size: 'A5' }).expect(201);
  await request(app).get('/admin/transport/sticker-scans').set(auth).expect(200);
  await request(app).get('/admin/transport/sticker-people').set(auth).expect(200);
  await request(app).get('/admin/transport/gps').set(auth).expect(200);
  await request(app).get('/admin/transport/gps/run-times').set(auth).expect(200);
  const key = (await request(app).get('/admin/transport/sticker-wall-key').set(auth).expect(200)).body.key;
  await request(app).get(`/transport/sticker-wall?key=${key}`).expect(200);
  await request(app).get(`/transport/sticker-wall/people?key=${key}`).expect(200);
  await request(app)
    .post('/transport/arrival-reports')
    .send({ kind: 'arrived', routeId: '2', tripId: '2-01', direction: 'there', stopId: 'st_0001', scheduledTime: hhmm(now), source: 'route', clientId: 'abcd-1234-efgh', clientEventId: '7f3c2a10-1111-4abc-9def-000000000001' })
    .expect(201);
  const reports = (await request(app).get('/admin/transport/arrival-reports').set(auth).expect(200)).body;
  await request(app).delete(`/admin/transport/arrival-reports/${store.tables.transportArrivalReport[0].id}`).set(auth).expect(200);
  assert.ok(reports);
  await ensureInitialTransportRevision(store.prisma);

  const transportCalls = store.calls.filter((c) => (TRANSPORT_MODELS as readonly string[]).includes(c.model));
  assert.ok(transportCalls.length > 40, `calls: ${transportCalls.length}`);
  const unscoped = transportCalls.filter((c) => !scoped(c)).map((c) => `${c.model}.${c.method} ${JSON.stringify(c.args).slice(0, 120)}`);
  assert.deepEqual(unscoped, []);
  // і всі записані рядки — малинські
  for (const model of TRANSPORT_MODELS) {
    assert.ok(store.tables[model].every((row) => row.cityCode === 'Malyn'), model);
  }
});

test('рядки іншого міста не видно в Малині й не зачіпаються його записами', async () => {
  const alone = await setup();
  const withKorosten = await setup({ korosten: true });
  const strip = (body: { revision?: unknown }) => ({ ...body, revision: null });
  const a = await request(alone.app).get('/transport/dataset').expect(200);
  const b = await request(withKorosten.app).get('/transport/dataset').expect(200);
  assert.deepEqual(strip(b.body), strip(a.body));
  assert.equal(b.body.stops.length, 2);

  // Журнал, GTFS і статистика — лише Малин
  const revisions = (await request(withKorosten.app).get('/transport/revisions').expect(200)).body.revisions;
  assert.equal(revisions.length, 1);
  assert.notEqual(revisions[0].revision, '2026-11-05T09:00:00.000Z');
  const stops = (await request(withKorosten.app).get('/transport/gtfs/stops.txt').expect(200)).text;
  assert.equal(stops.includes('st_1001'), false);
  const scans = (await request(withKorosten.app).get('/admin/transport/sticker-scans').set(auth).expect(200)).body;
  assert.equal(JSON.stringify(scans).includes('st_1001'), false);
  const arrivals = (await request(withKorosten.app).get('/admin/transport/arrival-reports').set(auth).expect(200)).body;
  assert.equal(arrivals.total, 0);
  await request(withKorosten.app).delete('/admin/transport/arrival-reports/9001').set(auth).expect(404);

  // Повна заміна датасету Малина і правка редиректів не чіпають Коростень
  const next = malynDataset();
  next.stops.push({ id: 'st_0003', name: 'Лікарня', lat: 50.78, lng: 29.26 });
  await request(withKorosten.app).put('/transport/dataset').set(auth).send(next).expect(200);
  await request(withKorosten.app).put('/admin/transport/stop-redirects').set(auth).send({ redirects: { st_0099: 'st_0001' } }).expect(200);
  const { tables } = withKorosten.store;
  const expected = korostenRows();
  for (const model of TRANSPORT_MODELS) {
    const left = tables[model].filter((row) => row.cityCode === 'Korosten');
    assert.equal(left.length, expected[model].length, model);
  }
  assert.deepEqual(tables.transportMeta.find((row) => row.cityCode === 'Korosten')?.payload, { defaultSec: 120, center: [50.95, 28.64] });
  assert.equal(tables.transportStop.filter((row) => row.cityCode === 'Malyn').length, 3);

  // Скан зупинки Коростеня без city — це запит до Малина, там такої зупинки нема
  await request(withKorosten.app).post('/transport/sticker-scans').send({ stopId: 'st_1001', side: 'a' }).expect(404);
});

test('?city=: неопубліковане місто бачить лише адмін; відкриті дані іншого міста закриті', async () => {
  const { app } = await setup({ korosten: true });
  await request(app).get('/transport/dataset?city=Korosten').expect(404);
  await request(app).get('/transport/stops/st_1001?city=Korosten').expect(404);
  await request(app).get('/transport/stop-redirects?city=Korosten').expect(404);
  await request(app).get('/transport/dataset?city=Atlantis').expect(404);
  await request(app).get('/transport/dataset?city=Kyiv').set(auth).expect(404);
  // Житомир без домену: публічно 404, адмін бачить (поки порожній) датасет без кешу
  await request(app).get('/transport/dataset?city=Zhytomyr').expect(404);
  const zt = await request(app).get('/transport/dataset?city=Zhytomyr').set(auth).expect(200);
  assert.equal(zt.headers['cache-control'], 'private, no-store');
  assert.deepEqual(zt.body.stops, []);

  const admin = await request(app).get('/transport/dataset?city=korosten').set(auth).expect(200);
  assert.equal(admin.headers['cache-control'], 'private, no-store');
  assert.deepEqual(admin.body.stops.map((s: { id: string }) => s.id), ['st_1001', 'st_1002']);
  assert.equal(admin.body.revision, '2026-11-05T09:00:00.000Z');
  const stop = await request(app).get('/transport/stops/st_1001?city=Korosten').set(auth).expect(200);
  assert.equal(stop.body.name, 'Залізничний вокзал');

  // ?city=Malyn — те саме, що без параметра
  const plain = await request(app).get('/transport/dataset').expect(200);
  const named = await request(app).get('/transport/dataset?city=Malyn').expect(200);
  assert.deepEqual(named.body, plain.body);
  assert.equal(named.headers['cache-control'], 'public, max-age=300');

  for (const path of ['/transport/gtfs.zip', '/transport/gtfs/stops.txt', '/transport/changes.rss', '/transport/revisions', '/transport/route/k1/calendar.ics']) {
    await request(app).get(`${path}?city=Korosten`).set(auth).expect(404);
  }
  // запис датасету — лише адмін і лише відоме місто
  await request(app).put('/transport/dataset?city=Korosten').send(malynDataset()).expect(401);
  await request(app).put('/transport/dataset?city=Atlantis').set(auth).send(malynDataset()).expect(404);
  await request(app).put('/admin/transport/stop-redirects?city=Atlantis').set(auth).send({ redirects: {} }).expect(404);

  // Наклейка Коростеня до публікації — 404, адмінська статистика міста — доступна
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_1001', side: 'a', city: 'Korosten' }).expect(404);
  const stats = (await request(app).get('/admin/transport/sticker-scans?city=Korosten').set(auth).expect(200)).body;
  assert.equal(JSON.stringify(stats).includes('st_1001'), true);
  assert.equal(JSON.stringify(stats).includes('st_0001'), false);
});

test('опубліковане місто (TripPoint.hasLocalTransport): читання й записи пасажирів відкриті всім', async () => {
  const { app, store } = await setup({ korosten: true, korostenPublished: true });
  const res = await request(app).get('/transport/dataset?city=Korosten').expect(200);
  assert.equal(res.headers['cache-control'], 'public, max-age=300');
  assert.equal(res.body.routes[0].id, 'k1');

  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_1001', side: 'b', city: 'Korosten' }).expect(201);
  // зупинка Малина під містом Коростень — невідома
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_0001', side: 'b', city: 'Korosten' }).expect(404);
  const scan = store.tables.stickerScan.find((row) => row.side === 'b');
  assert.equal(scan?.cityCode, 'Korosten');

  const now = kyivClock(new Date()).mins;
  await request(app)
    .post('/transport/arrival-reports')
    .send({ kind: 'arrived', routeId: 'k1', tripId: 'k1-01', direction: 'there', stopId: 'st_1001', scheduledTime: hhmm(now), source: 'route', city: 'Korosten' })
    .expect(201);
  assert.equal(store.tables.transportArrivalReport.filter((row) => row.cityCode === 'Korosten').length, 2);
  // відкриті дані все одно закриті до окремої фази
  await request(app).get('/transport/gtfs.zip?city=Korosten').expect(404);
});

test('M2: два міста з однаковими id — запис, читання, журнал і редиректи кожного окремо', async () => {
  const { app, store } = await setup();
  const malynBefore = (await request(app).get('/transport/dataset').expect(200)).body;

  // Коростень отримує ті самі id, що й Малин: маршрут «2», зупинки st_0001 / st_0002, рейс 2-01
  const korosten = malynDataset();
  korosten.stops[0].name = 'Залізничний вокзал';
  korosten.trips[0].departureTime = '06:20:00';
  const put = await request(app).put('/transport/dataset?city=Korosten').set(auth).send(korosten).expect(200);
  assert.equal(put.body.counts.stops, 2);

  const k1 = (await request(app).get('/transport/dataset?city=Korosten').set(auth).expect(200)).body;
  assert.equal(k1.stops[0].name, 'Залізничний вокзал');
  assert.equal(k1.trips[0].departureTime, '06:20:00');
  assert.equal(k1.revision, put.body.revision);
  // Малин той самий, разом із revision
  assert.deepEqual((await request(app).get('/transport/dataset').expect(200)).body, malynBefore);
  assert.equal(store.tables.transportStop.filter((row) => row.id === 'st_0001').length, 2);
  assert.deepEqual(store.tables.transportMeta.map((row) => [row.cityCode, row.id]).sort(), [['Korosten', 2], ['Malyn', 1]]);

  // захист від втрачених оновлень — у кожного міста своя revision
  await request(app).put('/transport/dataset?city=Korosten').set(auth).send({ ...korosten, baseRevision: malynBefore.revision }).expect(409);
  await request(app).put('/transport/dataset?city=Korosten').set(auth).send({ ...korosten, baseRevision: k1.revision }).expect(200);

  // редиректи зупинок — у меті свого міста
  await request(app).put('/admin/transport/stop-redirects?city=Korosten').set(auth).send({ redirects: { st_0099: 'st_0001' } }).expect(200);
  assert.deepEqual((await request(app).get('/transport/stop-redirects?city=Korosten').set(auth).expect(200)).body, { st_0099: 'st_0001' });
  assert.deepEqual((await request(app).get('/transport/stop-redirects').expect(200)).body, {});
  const moved = await request(app).get('/transport/stops/st_0099?city=Korosten').set(auth).expect(301);
  assert.equal(moved.headers.location, '/transport/stops/st_0001?city=Korosten');

  // журнал ревізій: рядки Коростеня не потрапляють у публічний журнал Малина
  const journal = (await request(app).get('/transport/revisions').expect(200)).body.revisions;
  assert.equal(journal.length, 1);
  assert.equal(store.tables.transportRevision.filter((row) => row.cityCode === 'Korosten').length, 3);

  // заміна датасету Малина не чіпає Коростень, і навпаки — порожній датасет Коростеня не чіпає Малин
  const next = malynDataset();
  next.stops.push({ id: 'st_0003', name: 'Лікарня', lat: 50.78, lng: 29.26 });
  await request(app).put('/transport/dataset').set(auth).send(next).expect(200);
  assert.equal((await request(app).get('/transport/dataset?city=Korosten').set(auth).expect(200)).body.stops.length, 2);
  await request(app)
    .put('/transport/dataset?city=Korosten')
    .set(auth)
    .send({ stops: [], routes: [], routeStops: [], trips: [], segments: [], meta: {} })
    .expect(200);
  assert.equal((await request(app).get('/transport/dataset').expect(200)).body.stops.length, 3);
  assert.equal(store.tables.transportStop.filter((row) => row.cityCode === 'Korosten').length, 0);

  // публічно Коростень закритий, поки прапорець вимкнений
  await request(app).get('/transport/dataset?city=Korosten').expect(404);
});

test('тестове сховище тримає ключі як база: дубль (cityCode, id) — P2002', async () => {
  const store = createTransportTestStore();
  await store.prisma.transportStop.create({ data: { cityCode: 'Malyn', id: 'st_0001', name: 'А', lat: 1, lng: 2 } });
  await store.prisma.transportStop.create({ data: { cityCode: 'Korosten', id: 'st_0001', name: 'Б', lat: 1, lng: 2 } });
  await assert.rejects(
    () => store.prisma.transportStop.create({ data: { cityCode: 'Malyn', id: 'st_0001', name: 'В', lat: 1, lng: 2 } }),
    (e: { code?: string }) => e.code === 'P2002',
  );
});
