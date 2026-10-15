/**
 * HTTP tests for GET/PUT /transport/dataset with an in-memory Prisma stub.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import type { TransportDataset } from './local-transport';

const TEST_ADMIN_PASSWORD = 'transport-test-admin';

type Store = {
  stops: any[];
  routes: any[];
  routeStops: any[];
  trips: any[];
  segments: any[];
  meta: { id: number; payload: Record<string, unknown> } | null;
};

function emptyStore(): Store {
  return { stops: [], routes: [], routeStops: [], trips: [], segments: [], meta: null };
}

function createTransportPrismaStub(store: Store): PrismaClient {
  const orderBy = (rows: any[], order?: any) => {
    if (!order) return [...rows];
    const keys = Array.isArray(order) ? order : [order];
    return [...rows].sort((a, b) => {
      for (const k of keys) {
        const field = Object.keys(k)[0];
        const av = a[field];
        const bv = b[field];
        if (av < bv) return k[field] === 'desc' ? 1 : -1;
        if (av > bv) return k[field] === 'desc' ? -1 : 1;
      }
      return 0;
    });
  };

  const model = (key: keyof Store) => ({
    findMany: async ({ orderBy: ob }: any = {}) => orderBy(store[key] as any[], ob),
    findUnique: async ({ where }: any) => {
      if (key === 'meta') return store.meta?.id === where.id ? store.meta : null;
      return (store[key] as any[]).find((r) => r.id === where.id) ?? null;
    },
    deleteMany: async () => {
      (store as any)[key] = key === 'meta' ? null : [];
      return { count: 0 };
    },
    createMany: async ({ data }: { data: any[] }) => {
      (store[key] as any[]).push(
        ...data.map((row, i) => ({
          id: row.id ?? (store[key] as any[]).length + i + 1,
          ...row,
        }))
      );
      return { count: data.length };
    },
    upsert: async ({ where, create, update }: any) => {
      if (key !== 'meta') throw new Error('upsert only for meta in stub');
      if (store.meta?.id === where.id) {
        store.meta = { ...store.meta, ...update };
      } else {
        store.meta = { id: create.id ?? 1, payload: create.payload };
      }
      return store.meta;
    },
  });

  const stub: any = {
    transportStop: model('stops'),
    transportRoute: model('routes'),
    transportRouteStop: model('routeStops'),
    transportTrip: model('trips'),
    transportSegment: model('segments'),
    transportMeta: model('meta'),
    $transaction: async (ops: Promise<unknown>[] | ((tx: any) => Promise<unknown>)) => {
      if (typeof ops === 'function') return ops(stub);
      return Promise.all(ops);
    },
  };
  return stub as PrismaClient;
}

function sampleDataset(): TransportDataset {
  return {
    stops: [
      { id: 'st_0001', name: 'Барміна', lat: 50.771, lng: 29.241 },
      { id: 'st_0002', name: 'Лікарня', lat: 50.772, lng: 29.242 },
    ],
    routes: [{ id: '2', fromName: 'Фабрика', toName: 'Лікарня', scheme: '', note: '', sourceUrl: '' }],
    routeStops: [
      { routeId: '2', stopId: 'st_0001', orderThere: 1, orderBack: 2, mapOnly: false },
      { routeId: '2', stopId: 'st_0002', orderThere: 2, orderBack: 1, mapOnly: false },
    ],
    trips: [
      {
        id: '2-01',
        routeId: '2',
        serviceId: 'everyday',
        headsign: 'Лікарня',
        directionId: '1',
        departureTime: '07:00:00',
        blockId: null,
      },
    ],
    segments: [{ routeId: '2', fromStopId: 'st_0001', toStopId: 'st_0002', seconds: 180 }],
    meta: { defaultSec: 120, center: [50.768, 29.242] },
  };
}

function appWithStore(store: Store) {
  return createApp({
    prisma: createTransportPrismaStub(store),
    adminPassword: TEST_ADMIN_PASSWORD,
  });
}

test('GET /transport/dataset: empty store returns empty arrays', async () => {
  const res = await request(appWithStore(emptyStore())).get('/transport/dataset').expect(200);
  assert.deepEqual(res.body.stops, []);
  assert.deepEqual(res.body.routes, []);
  assert.equal(res.headers['cache-control'], 'public, max-age=300');
});

test('PUT /transport/dataset: 401 without admin token', async () => {
  await request(appWithStore(emptyStore())).put('/transport/dataset').send(sampleDataset()).expect(401);
});

test('PUT /transport/dataset: 400 on invalid payload', async () => {
  const app = appWithStore(emptyStore());
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  const res = await request(app)
    .put('/transport/dataset')
    .set('Authorization', String(login.body.token))
    .send({ stops: [] })
    .expect(400);
  assert.ok(res.body.details?.length > 0);
});

test('PUT then GET /transport/dataset: round-trip', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  const dataset = sampleDataset();

  const put = await request(app)
    .put('/transport/dataset')
    .set('Authorization', String(login.body.token))
    .send(dataset)
    .expect(200);
  assert.equal(put.body.ok, true);
  assert.equal(put.body.counts.stops, 2);
  assert.equal(put.body.counts.trips, 1);

  const get = await request(app).get('/transport/dataset').expect(200);
  assert.equal(get.body.stops.length, 2);
  assert.equal(get.body.trips[0].id, '2-01');
  assert.equal(get.body.segments[0].seconds, 180);
  assert.equal(get.body.meta.defaultSec, 120);
});

test('PUT then GET /transport/dataset: unreliable flag round-trips, default false', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  const dataset = sampleDataset();
  dataset.routes = [
    { ...dataset.routes[0], unreliable: true },
    { id: '10-old', fromName: '', toName: '', scheme: '', note: '', sourceUrl: '' },
  ];

  await request(app)
    .put('/transport/dataset')
    .set('Authorization', String(login.body.token))
    .send(dataset)
    .expect(200);

  const get = await request(app).get('/transport/dataset').expect(200);
  const byId = new Map((get.body.routes as Array<{ id: string; unreliable: boolean }>).map((r) => [r.id, r]));
  assert.equal(byId.get('2')?.unreliable, true);
  assert.equal(byId.get('10-old')?.unreliable, false);
});

test('PUT then GET /transport/dataset: trip start/end/arrival round-trip, empty → null', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  const dataset = sampleDataset();
  dataset.trips = [
    { ...dataset.trips[0], startStopId: null, endStopId: 'st_0002', arrivalTime: '07:05:00' },
    { ...dataset.trips[0], id: '2-02', departureTime: '08:00:00', startStopId: '', endStopId: '', arrivalTime: '' },
  ];

  await request(app)
    .put('/transport/dataset')
    .set('Authorization', String(login.body.token))
    .send(dataset)
    .expect(200);

  const get = await request(app).get('/transport/dataset').expect(200);
  const byId = new Map((get.body.trips as Array<Record<string, unknown>>).map((t) => [t.id, t]));
  assert.equal(byId.get('2-01')?.endStopId, 'st_0002');
  assert.equal(byId.get('2-01')?.arrivalTime, '07:05:00');
  assert.equal(byId.get('2-01')?.startStopId, null);
  assert.equal(byId.get('2-02')?.startStopId, null);
  assert.equal(byId.get('2-02')?.endStopId, null);
  assert.equal(byId.get('2-02')?.arrivalTime, null);
});

test('PUT /transport/dataset: 400 names the trip whose arrivalTime is invalid', async () => {
  const app = appWithStore(emptyStore());
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  const dataset = sampleDataset();
  dataset.trips = [{ ...dataset.trips[0], arrivalTime: '06:00:00' }];
  const res = await request(app)
    .put('/transport/dataset')
    .set('Authorization', String(login.body.token))
    .send(dataset)
    .expect(400);
  assert.ok((res.body.details as string[]).some((d) => d.includes('trip 2-01') && d.includes('arrivalTime')));
});

// ---------- Варіанти шляху, опорні часи, revision (Docs/route-variants-2026-10.md) ----------

function variantSample(): TransportDataset {
  const ds = sampleDataset();
  ds.stops.push({ id: 'st_0003', name: 'Вокзал', lat: 50.774, lng: 29.244 });
  ds.routes[0].variants = [
    { id: '2-v1', directionId: '1', name: 'Через вокзал', stops: [{ stopId: 'st_0001' }, { stopId: 'st_0003' }] },
  ];
  ds.trips.push({
    id: '2-02',
    routeId: '2',
    directionId: '1',
    departureTime: '06:45:00',
    variantId: '2-v1',
    timepoints: [{ stopId: 'st_0003', time: '07:05:00' }],
  });
  return ds;
}

async function adminToken(app: ReturnType<typeof appWithStore>): Promise<string> {
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  return String(login.body.token);
}

test('PUT then GET /transport/dataset: variants, trip variantId and timepoints round-trip; counts.variants', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const token = await adminToken(app);
  const put = await request(app).put('/transport/dataset').set('Authorization', token).send(variantSample()).expect(200);
  assert.equal(put.body.counts.variants, 1);

  const get = await request(app).get('/transport/dataset').expect(200);
  assert.deepEqual(get.body.routes[0].variants, [
    { id: '2-v1', directionId: '1', name: 'Через вокзал', stops: [{ stopId: 'st_0001' }, { stopId: 'st_0003' }] },
  ]);
  const byId = new Map((get.body.trips as Array<Record<string, unknown>>).map((t) => [t.id, t]));
  assert.equal(byId.get('2-02')?.variantId, '2-v1');
  assert.deepEqual(byId.get('2-02')?.timepoints, [{ stopId: 'st_0003', time: '07:05:00' }]);
  assert.equal(byId.get('2-01')?.variantId, null);
  assert.equal(byId.get('2-01')?.timepoints, null);
});

test('PUT /transport/dataset: a route without the variants key keeps them (map editor save); [] clears them', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const token = await adminToken(app);
  await request(app).put('/transport/dataset').set('Authorization', token).send(variantSample()).expect(200);

  const withoutKey = variantSample();
  delete withoutKey.routes[0].variants;
  await request(app).put('/transport/dataset').set('Authorization', token).send(withoutKey).expect(200);
  const get = await request(app).get('/transport/dataset').expect(200);
  assert.equal(get.body.routes[0].variants.length, 1);

  const cleared = variantSample();
  cleared.routes[0].variants = [];
  const res = await request(app).put('/transport/dataset').set('Authorization', token).send(cleared).expect(400);
  assert.ok((res.body.details as string[]).some((d) => d.includes('unknown variant 2-v1')));
});

test('PUT /transport/dataset: stale baseRevision → 409; current one or none → 200 with the new revision', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const token = await adminToken(app);
  await request(app).put('/transport/dataset').set('Authorization', token).send(sampleDataset()).expect(200);
  store.meta = { ...(store.meta as { id: number; payload: Record<string, unknown> }), updatedAt: new Date('2026-10-12T10:00:00Z') } as never;

  const get = await request(app).get('/transport/dataset').expect(200);
  assert.equal(get.body.revision, '2026-10-12T10:00:00.000Z');

  const stale = await request(app)
    .put('/transport/dataset')
    .set('Authorization', token)
    .send({ ...sampleDataset(), baseRevision: '2026-10-12T09:00:00.000Z' })
    .expect(409);
  assert.equal(stale.body.revision, '2026-10-12T10:00:00.000Z');

  const ok = await request(app)
    .put('/transport/dataset')
    .set('Authorization', token)
    .send({ ...sampleDataset(), baseRevision: get.body.revision, revision: 'ignored' })
    .expect(200);
  assert.equal(ok.body.revision, '2026-10-12T10:00:00.000Z');
});

// ---------- Відкритий GTFS (Docs/transport-open-data-2026-10.md, фаза 1) ----------

/** supertest віддає бінарну відповідь як Buffer лише з власним парсером */
const binaryParser = (res: NodeJS.ReadableStream, cb: (err: Error | null, data: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

function setRevision(store: Store, iso: string) {
  store.meta = { ...(store.meta as { id: number; payload: Record<string, unknown> }), updatedAt: new Date(iso) } as never;
}

test('GET /transport/gtfs.zip and /transport/gtfs/:file: 404 while the dataset is empty', async () => {
  const app = appWithStore(emptyStore());
  await request(app).get('/transport/gtfs.zip').expect(404);
  await request(app).get('/transport/gtfs/feed_info.txt').expect(404);
});

test('GET /transport/gtfs.zip: zip attachment with cache headers, ETag = revision, 304 on If-None-Match', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const token = await adminToken(app);
  await request(app).put('/transport/dataset').set('Authorization', token).send(sampleDataset()).expect(200);
  setRevision(store, '2026-10-12T10:00:00Z');

  const res = await request(app).get('/transport/gtfs.zip').buffer(true).parse(binaryParser).expect(200);
  assert.equal(res.headers['content-type'], 'application/zip');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="malyn-gtfs.zip"');
  assert.equal(res.headers['cache-control'], 'public, max-age=300');
  assert.equal(res.headers['etag'], '"2026-10-12T10:00:00.000Z"');
  assert.equal(res.headers['last-modified'], 'Mon, 12 Oct 2026 10:00:00 GMT');
  const zip = res.body as Buffer;
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const text = zip.toString('latin1');
  for (const name of ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'feed_info.txt', 'shapes.txt', 'LICENSE.txt']) {
    assert.ok(text.includes(name), name);
  }

  await request(app).get('/transport/gtfs.zip').set('If-None-Match', '"2026-10-12T10:00:00.000Z"').expect(304);
  await request(app).get('/transport/gtfs.zip').set('If-None-Match', '"2026-10-11T10:00:00.000Z"').expect(200);
});

test('GET /transport/gtfs/:file: single feed file as text, feed_version = revision; unknown name → 404', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const token = await adminToken(app);
  await request(app).put('/transport/dataset').set('Authorization', token).send(sampleDataset()).expect(200);
  setRevision(store, '2026-10-12T10:00:00Z');

  const info = await request(app).get('/transport/gtfs/feed_info.txt').expect(200);
  assert.match(info.headers['content-type'], /^text\/plain; charset=utf-8/);
  assert.equal(info.headers['etag'], '"2026-10-12T10:00:00.000Z"');
  assert.equal(info.headers['cache-control'], 'public, max-age=300');
  assert.ok(info.text.endsWith(',20240101,20271231,2026-10-12T10:00:00.000Z\n'), info.text);

  const license = await request(app).get('/transport/gtfs/LICENSE.txt').expect(200);
  assert.ok(license.text.includes('CC BY 4.0'));

  const stops = await request(app).get('/transport/gtfs/stops.txt').expect(200);
  assert.equal(stops.text, 'stop_id,stop_name,stop_lat,stop_lon,location_type\nst_0001,Барміна,50.771000,29.241000,0\nst_0002,Лікарня,50.772000,29.242000,0\n');

  await request(app).get('/transport/gtfs/nope.txt').expect(404);
  await request(app).get('/transport/gtfs/..%2Findex.js').expect(404);
});

test('GET /transport/gtfs.zip: cached per revision; a new revision rebuilds and drops unreliable routes', async () => {
  const store = emptyStore();
  const app = appWithStore(store);
  const token = await adminToken(app);
  await request(app).put('/transport/dataset').set('Authorization', token).send(sampleDataset()).expect(200);
  setRevision(store, '2026-10-12T10:00:00Z');

  const first = await request(app).get('/transport/gtfs/routes.txt').expect(200);
  assert.equal(first.text, 'route_id,agency_id,route_short_name,route_long_name,route_type\n2,malyn,2,Фабрика — Лікарня,3\n');

  // Та сама revision — кеш: зміна в сховищі без бампу revision не видна
  const hidden = sampleDataset();
  hidden.routes = [{ ...hidden.routes[0], unreliable: true }];
  await request(app).put('/transport/dataset').set('Authorization', token).send(hidden).expect(200);
  setRevision(store, '2026-10-12T10:00:00Z');
  const cached = await request(app).get('/transport/gtfs/routes.txt').expect(200);
  assert.equal(cached.text, first.text);

  // Нова revision — перезбірка: ненадійний маршрут і його рейси зникають із фіду
  setRevision(store, '2026-10-13T10:00:00Z');
  const rebuilt = await request(app).get('/transport/gtfs/routes.txt').expect(200);
  assert.equal(rebuilt.headers['etag'], '"2026-10-13T10:00:00.000Z"');
  assert.equal(rebuilt.text, 'route_id,agency_id,route_short_name,route_long_name,route_type\n');
  const trips = await request(app).get('/transport/gtfs/trips.txt').expect(200);
  assert.equal(trips.text, 'route_id,service_id,trip_id,trip_headsign,direction_id,block_id,shape_id\n');
  const zip = await request(app).get('/transport/gtfs.zip').buffer(true).parse(binaryParser).expect(200);
  assert.equal(zip.headers['etag'], '"2026-10-13T10:00:00.000Z"');
});
