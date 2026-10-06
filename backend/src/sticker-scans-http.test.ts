/**
 * HTTP: відкриття табло з QR-наклейок — POST /transport/sticker-scans (валідація, невідома
 * зупинка, повтор з того самого клієнта) і GET /admin/transport/sticker-scans (auth, агрегати).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { createScanDeduper, clientKey, parseStickerScan } from './sticker-scans';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-x7';
const DAY = 24 * 60 * 60 * 1000;

type Scan = { stopId: string; side: string; createdAt: Date };

function makeApp(initial: Scan[] = []) {
  const scans: Scan[] = [...initial];
  const groupBy = async (args: { where?: { createdAt?: { gte: Date } } }) => {
    const gte = args.where?.createdAt?.gte;
    const by = new Map<string, { stopId: string; side: string; n: number; max: Date }>();
    for (const s of scans) {
      if (gte && s.createdAt < gte) continue;
      const k = `${s.stopId}|${s.side}`;
      const cur = by.get(k) ?? { stopId: s.stopId, side: s.side, n: 0, max: s.createdAt };
      cur.n += 1;
      if (s.createdAt > cur.max) cur.max = s.createdAt;
      by.set(k, cur);
    }
    return [...by.values()].map((g) => ({ stopId: g.stopId, side: g.side, _count: { _all: g.n }, _max: { createdAt: g.max } }));
  };
  const prisma = {
    transportStop: {
      findUnique: async ({ where }: { where: { id: string } }) => (['st_0015', 'st_0019'].includes(where.id) ? { id: where.id } : null),
    },
    stickerScan: {
      create: async ({ data }: { data: { stopId: string; side: string } }) => {
        const row = { ...data, createdAt: new Date() };
        scans.push(row);
        return { id: scans.length, ...row };
      },
      groupBy,
    },
  } as unknown as PrismaClient;
  return { app: createApp({ prisma, adminPassword: TEST_ADMIN_PASSWORD }), scans };
}

async function token(app: ReturnType<typeof createApp>) {
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  return String(login.body.token);
}

test('POST /transport/sticker-scans: записує відкриття наклейки', async () => {
  const { app, scans } = makeApp();
  const res = await request(app).post('/transport/sticker-scans').send({ stopId: 'st_0015', side: 'a' }).expect(201);
  assert.deepEqual(res.body, { ok: true, counted: true });
  assert.equal(scans.length, 1);
  assert.deepEqual({ stopId: scans[0].stopId, side: scans[0].side }, { stopId: 'st_0015', side: 'a' });
});

test('POST /transport/sticker-scans: невалідне тіло — 400, невідома зупинка — 404, нічого не пишеться', async () => {
  const { app, scans } = makeApp();
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_0015', side: 'x' }).expect(400);
  await request(app).post('/transport/sticker-scans').send({ stopId: '../etc', side: 'a' }).expect(400);
  await request(app).post('/transport/sticker-scans').send({}).expect(400);
  await request(app).post('/transport/sticker-scans').send({ stopId: 'st_9999', side: 'a' }).expect(404);
  assert.equal(scans.length, 0);
});

test('POST /transport/sticker-scans: повтор з того самого клієнта не рахується, з іншого — рахується', async () => {
  const { app, scans } = makeApp();
  const send = (ip: string, side = 'b') =>
    request(app).post('/transport/sticker-scans').set('X-Forwarded-For', `${ip}, 10.0.0.1`).set('User-Agent', 'Phone').send({ stopId: 'st_0015', side });
  await send('203.0.113.5').expect(201);
  const again = await send('203.0.113.5').expect(200);
  assert.equal(again.body.counted, false);
  await send('203.0.113.6').expect(201);
  await send('203.0.113.5', 'a').expect(201);
  assert.equal(scans.length, 3);
});

test('GET /admin/transport/sticker-scans: 401 без токена', async () => {
  const { app } = makeApp();
  await request(app).get('/admin/transport/sticker-scans').expect(401);
});

test('GET /admin/transport/sticker-scans: агрегати по наклейках, популярні першими', async () => {
  const now = Date.now();
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
  const { app } = makeApp([
    { stopId: 'st_0015', side: 'a', createdAt: at(1) },
    { stopId: 'st_0015', side: 'a', createdAt: at(10) },
    { stopId: 'st_0015', side: 'a', createdAt: at(40) },
    { stopId: 'st_0015', side: 'b', createdAt: at(2) },
    { stopId: 'st_0019', side: 's', createdAt: at(20) },
    { stopId: 'st_0019', side: 's', createdAt: at(25) },
  ]);
  const res = await request(app).get('/admin/transport/sticker-scans').set('Authorization', await token(app)).expect(200);
  assert.deepEqual(
    res.body.rows.map((r: { stopId: string; side: string; total: number; last7d: number; last30d: number }) => [r.stopId, r.side, r.total, r.last7d, r.last30d]),
    [
      ['st_0015', 'a', 3, 1, 2],
      ['st_0019', 's', 2, 0, 2],
      ['st_0015', 'b', 1, 1, 1],
    ]
  );
  assert.equal(res.body.rows[0].lastAt, at(1).toISOString());
  assert.deepEqual([res.body.total, res.body.last7d, res.body.last30d], [6, 2, 5]);
});

test('parseStickerScan / clientKey / createScanDeduper', () => {
  assert.deepEqual(parseStickerScan({ stopId: ' st_0015 ', side: 's' }), { stopId: 'st_0015', side: 's' });
  assert.equal(parseStickerScan({ stopId: 'st_0015', side: 1 }), null);
  assert.equal(clientKey({ 'x-forwarded-for': '198.51.100.1, 10.0.0.2', 'user-agent': 'UA' }, '127.0.0.1'), '198.51.100.1|UA');
  assert.equal(clientKey({}, '127.0.0.1'), '127.0.0.1|');
  const seen = createScanDeduper(1000, 2);
  assert.equal(seen('k', 0), false);
  assert.equal(seen('k', 500), true);
  assert.equal(seen('k', 1500), false);
  assert.equal(seen('k2', 1600), false);
  assert.equal(seen('k3', 1700), false); // переповнення: старі ключі прибрано
});
