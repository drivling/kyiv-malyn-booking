/**
 * Віджет «Відкриття з QR» на стіну: ключ посилання, знімок сьогоднішніх сканів (київська доба,
 * «учора на цю пору», остання година, рекорд дня) і нові скани після курсора; HTTP-доступ за ключем.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { isStickerWallKey, stickerWallKey, stickerWallSnapshot } from './sticker-wall';

const ADMIN = 'wall-test-admin-password';
type Row = { id: number; stopId: string; side: string; createdAt: Date };

function stub(rows: Row[]): PrismaClient {
  return {
    stickerScan: {
      findMany: async (args: { where?: { createdAt?: { gte: Date } } }) => {
        const gte = args.where?.createdAt?.gte;
        return rows.filter((r) => !gte || r.createdAt >= gte).sort((a, b) => a.id - b.id);
      },
    },
  } as unknown as PrismaClient;
}

const at = (iso: string) => new Date(iso);
// 06.10.2026, 13:00 за Києвом (UTC+3)
const NOW = at('2026-10-06T10:00:00Z');
const ROWS: Row[] = [
  { id: 1, stopId: 'st_0019', side: 's', createdAt: at('2026-09-20T09:00:00Z') },
  { id: 2, stopId: 'st_0019', side: 's', createdAt: at('2026-09-20T10:00:00Z') },
  { id: 3, stopId: 'st_0019', side: 's', createdAt: at('2026-09-20T11:00:00Z') },
  { id: 4, stopId: 'st_0015', side: 'a', createdAt: at('2026-10-05T07:00:00Z') }, // учора 10:00 — до «цієї пори»
  { id: 5, stopId: 'st_0015', side: 'a', createdAt: at('2026-10-05T12:00:00Z') }, // учора 15:00 — пізніше
  { id: 6, stopId: 'st_0015', side: 'a', createdAt: at('2026-10-05T21:10:00Z') }, // 00:10 сьогодні
  { id: 7, stopId: 'st_0015', side: 'b', createdAt: at('2026-10-06T08:30:00Z') }, // 11:30
  { id: 8, stopId: 'st_0049', side: 's', createdAt: at('2026-10-06T09:40:00Z') }, // 12:40
];

test('stickerWallKey: стабільний для пароля, інший для іншого пароля; перевірка ключа', () => {
  const key = stickerWallKey(ADMIN);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(stickerWallKey(ADMIN), key);
  assert.notEqual(stickerWallKey('other'), key);
  assert.equal(isStickerWallKey(key, ADMIN), true);
  assert.equal(isStickerWallKey(key, 'other'), false);
  assert.equal(isStickerWallKey(undefined, ADMIN), false);
  assert.equal(isStickerWallKey(key.slice(0, 31), ADMIN), false);
});

test('stickerWallSnapshot: київська доба, учора на цю пору, остання година, рекорд, курсор', async () => {
  const s = await stickerWallSnapshot(stub(ROWS), { now: NOW });
  assert.equal(s.day, '2026-10-06');
  assert.equal(s.total, 3);
  assert.equal(s.yesterdaySameTime, 1);
  assert.equal(s.hourly[0], 1);
  assert.equal(s.hourly[11], 1);
  assert.equal(s.hourly[12], 1);
  assert.deepEqual(
    s.stops.map((x) => [x.stopId, x.today, x.lastHour, x.last3h]),
    [
      ['st_0015', 2, 0, 1],
      ['st_0049', 1, 1, 1],
    ]
  );
  assert.equal(s.stops[0].lastAt, '2026-10-06T08:30:00.000Z');
  assert.equal(s.stops[0].hourly[0], 1);
  assert.deepEqual(s.bestDay, { day: '2026-09-20', count: 3 });
  // без курсора — усі сьогоднішні скани; курсор = найбільший сьогоднішній id
  assert.deepEqual(s.events.map((e) => e.id), [6, 7, 8]);
  assert.equal(s.lastId, 8);
  const next = await stickerWallSnapshot(stub(ROWS), { now: NOW, after: 7 });
  assert.deepEqual(next.events, [{ id: 8, stopId: 'st_0049', side: 's', createdAt: '2026-10-06T09:40:00.000Z' }]);
  const none = await stickerWallSnapshot(stub(ROWS), { now: NOW, after: 8 });
  assert.deepEqual(none.events, []);
  assert.equal(none.lastId, 8);
});

test('GET /transport/sticker-wall: лише з ключем; ключ видає адмін-ендпоінт', async () => {
  const app = createApp({ prisma: stub(ROWS), adminPassword: ADMIN });
  await request(app).get('/transport/sticker-wall').expect(403);
  await request(app).get('/transport/sticker-wall?key=0123456789abcdef0123456789abcdef').expect(403);
  await request(app).get('/admin/transport/sticker-wall-key').expect(401);
  const login = await request(app).post('/admin/login').send({ password: ADMIN }).expect(200);
  const keyRes = await request(app).get('/admin/transport/sticker-wall-key').set('Authorization', login.body.token).expect(200);
  assert.equal(keyRes.body.key, stickerWallKey(ADMIN));
  const res = await request(app).get(`/transport/sticker-wall?key=${keyRes.body.key}&after=7`).expect(200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(typeof res.body.total, 'number');
  assert.ok(Array.isArray(res.body.stops));
  assert.ok(res.body.events.every((e: { id: number }) => e.id > 7));
});
