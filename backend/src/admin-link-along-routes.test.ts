/**
 * POST /admin/viber-listings/link-along-routes: пасажири без маршруту («Ірпінь → Малин»)
 * привʼязуються до варіанта Київ–Малин через Ірпінь / Бучу; без `apply` — лише показ.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createAdminMaintenanceRouter } from './routes/admin-maintenance';
import { adminAuthToken, setAdminPassword } from './middleware/require-admin';
import { listenLocal } from './http-test-server';

const PASSWORD = 'test-pass';

function makeApp() {
  const update = vi.fn(async () => ({}));
  const prisma = {
    tripPoint: { findMany: vi.fn(async () => [{ id: 1 }, { id: 2 }, { id: 5 }].map((p) => ({ ...p, code: `p${p.id}`, nameUk: '' }))) },
    tripRoute: {
      findMany: vi.fn(async () => [
        { id: 4, slug: 'Kyiv-Malyn', corridorTripRouteId: null, stops: [{ pointId: 1, position: 0 }, { pointId: 2, position: 1 }] },
        {
          id: 9,
          slug: 'Kyiv-Malyn-Irpin',
          corridorTripRouteId: 4,
          stops: [{ pointId: 1, position: 0 }, { pointId: 5, position: 1 }, { pointId: 2, position: 2 }],
        },
      ]),
    },
    viberListing: {
      findMany: vi.fn(async () => [
        { id: 10, route: 'Irpin-Malyn', fromPointId: 5, toPointId: 2 },
        { id: 11, route: 'Malyn-Irpin', fromPointId: 2, toPointId: 5 },
      ]),
      update,
    },
  } as unknown as PrismaClient;
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  app.use(createAdminMaintenanceRouter({ prisma }));
  return { app, update };
}

test('без apply — показує, що привʼяжеться, і нічого не пише', async () => {
  const { app, update } = makeApp();
  const res = await request(await listenLocal(app))
    .post('/admin/viber-listings/link-along-routes')
    .set('Authorization', adminAuthToken(PASSWORD))
    .send({})
    .expect(200);
  assert.deepEqual(res.body, {
    applied: false,
    checked: 2,
    linked: 1,
    changes: [{ id: 10, route: 'Irpin-Malyn', tripRouteId: 9 }],
  });
  assert.equal(update.mock.calls.length, 0);
});

test('apply: true — записує tripRouteId лише тим, кому знайшовся маршрут', async () => {
  const { app, update } = makeApp();
  const res = await request(await listenLocal(app))
    .post('/admin/viber-listings/link-along-routes')
    .set('Authorization', adminAuthToken(PASSWORD))
    .send({ apply: true })
    .expect(200);
  assert.equal(res.body.applied, true);
  assert.deepEqual(update.mock.calls, [[{ where: { id: 10 }, data: { tripRouteId: 9 } }]]);
});

test('без адмін-токена — 401', async () => {
  const { app } = makeApp();
  await request(await listenLocal(app)).post('/admin/viber-listings/link-along-routes').send({}).expect(401);
});
