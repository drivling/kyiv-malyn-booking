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
