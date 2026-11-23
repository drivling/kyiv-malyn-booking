/**
 * «Доведе» · онлайн-рух Києва (крок 8г): читач GTFS-RT, візити біля контрольних точок, звіт «GPS проти розкладу»,
 * запис у базу й адмінський ендпоінт.
 */
import express from 'express';
import request from 'supertest';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { encodeVehiclePositions, parseVehiclePositions, readMessage, type RtVehicle } from '../gtfs-rt';
import type { KptData } from './kyiv-kpt';
import { createVisitTracker, nearestPoint, routePoints, type KptVisit } from './kyiv-kpt-passes';
import { buildKptGpsReport, kyivHour } from './kyiv-kpt-gps-times';
import { createKyivGpsRecorder, parseKyivGpsDays } from './kyiv-kpt-gps';
import { createAdminDovedeRouter } from '../routes/admin-dovede';
import { createDovedeSettings } from './settings';
import type { CityRoutes } from './city-route';
import { listenLocal } from '../http-test-server';
import { adminAuthToken, setAdminPassword } from '../middleware/require-admin';

/** Тролейбус 7 (route_id 2_7): Оболонь → Центр → Деміївка, 10 + 10 хв о 8-й; назад — дзеркально */
const KPT: KptData = {
  version: '20261123',
  validFrom: '20261123',
  validTo: '20271123',
  dirs: [
    { id: '2_7/0/0', mode: 'TROLLEYBUS', no: '7', name: 'Оболонь - Деміївка', points: [['Оболонь', 50.5, 30.5], ['Центр', 50.45, 30.5], ['Деміївка', 50.4, 30.5]], wd: [480], we: [], run: { '8': [0, 10, 20] } },
    { id: '2_7/1/0', mode: 'TROLLEYBUS', no: '7', name: 'Деміївка - Оболонь', points: [['Деміївка', 50.4, 30.5], ['Центр', 50.45, 30.5], ['Оболонь', 50.5, 30.5]], wd: [480], we: [], run: { '8': [0, 10, 20] } },
  ],
};
const PTS = routePoints(KPT);
/** 2026-11-24 08:00 за Києвом = 06:00 UTC */
const T0 = Date.UTC(2026, 10, 24, 6, 0);
const at = (min: number) => new Date(T0 + min * 60_000);
const veh = (id: string, lat: number, min: number, routeId = '2_7'): RtVehicle => ({ routeId, vehicleId: id, label: '7', lat, lng: 30.5, bearing: 180, speed: 5, at: at(min) });

test('GTFS-RT: стрічка в байтах і назад; чужі сутності й нулі пропущено', () => {
  const body = encodeVehiclePositions({ at: at(0), vehicles: [veh('2_1_0', 50.5, 0), { ...veh('2_2_0', 0, 0), lng: 0 }] });
  const feed = parseVehiclePositions(body);
  assert.equal(feed.version, '2.0');
  assert.equal(feed.at?.getTime(), T0);
  assert.equal(feed.vehicles.length, 1);
  const v = feed.vehicles[0];
  assert.deepEqual([v.routeId, v.vehicleId, v.label, v.bearing, v.speed, v.at.getTime()], ['2_7', '2_1_0', '7', 180, 5, T0]);
  assert.ok(Math.abs(v.lat - 50.5) < 1e-5);
  assert.throws(() => readMessage(Uint8Array.from([0x0a, 0x05, 0x01])));
});

test('найближча контрольна точка — лише в межах 150 м і лише свого маршруту', () => {
  assert.equal(nearestPoint(PTS.get('2_7'), { lat: 50.4509, lng: 30.5 })?.name, 'Центр');
  assert.equal(nearestPoint(PTS.get('2_7'), { lat: 50.475, lng: 30.5 }), null);
  assert.equal(nearestPoint(PTS.get('3_1'), { lat: 50.45, lng: 30.5 }), null);
});

test('візити: стоянка на кінцевій — один візит від приходу до відходу; закривається, коли машина пішла чи зникла', () => {
  const tr = createVisitTracker(PTS);
  assert.deepEqual(tr.feed([veh('a', 50.5, 0)], at(0)), []);
  assert.deepEqual(tr.feed([veh('a', 50.5001, 3)], at(3)), []); // ще на кінцевій
  const left = tr.feed([veh('a', 50.475, 5)], at(5)); // поїхала — між точками
  assert.equal(left.length, 1);
  assert.deepEqual([left[0].point, left[0].firstAt.getTime(), left[0].lastAt.getTime()], ['Оболонь', at(0).getTime(), at(3).getTime()]);
  assert.deepEqual(tr.feed([veh('a', 50.45, 13)], at(13)), []);
  assert.equal(tr.openCount(), 1);
  // машину більше не видно 10+ хв — візит закрито
  const gone = tr.feed([], at(25));
  assert.deepEqual(gone.map((v) => v.point), ['Центр']);
  // стара точка (стрічка віддає давнє) не рахується
  assert.deepEqual(tr.feed([veh('b', 50.5, 0)], at(30)), []);
  assert.equal(tr.openCount(), 0);
});

const pass = (vehicleId: string, point: string, first: number, last = first): KptVisit => ({ routeId: '2_7', vehicleId, point, firstAt: at(first), lastAt: at(last) });

test('звіт: сусідні візити → хвилини за GPS проти розкладу; неправдоподібне відкинуто; мало поїздок — не показуємо', () => {
  assert.equal(kyivHour(at(0)), 8);
  const passes: KptVisit[] = [];
  // 5 машин: Оболонь (відхід хв 2) → Центр через 15 хв → Деміївка ще через 10
  for (let k = 0; k < 5; k++) passes.push(pass(`v${k}`, 'Оболонь', 0, 2), pass(`v${k}`, 'Центр', 17, 18), pass(`v${k}`, 'Деміївка', 28));
  // обідня перерва: Центр → Деміївка за 60 хв — відкинуто
  passes.push(pass('lunch', 'Центр', 0), pass('lunch', 'Деміївка', 60));
  const r = buildKptGpsReport(passes, KPT);
  assert.equal(r.vehicles, 6);
  assert.equal(r.measured, 2);
  assert.equal(r.differs, 1);
  const spans = r.routes[0].spans;
  assert.deepEqual(spans.map((s) => [s.dirId, s.from, s.to, s.samples, s.gpsMin, s.ourMin, s.differs]), [
    ['2_7/0/0', 'Оболонь', 'Центр', 5, 15, 10, true],
    ['2_7/0/0', 'Центр', 'Деміївка', 5, 10, 10, false],
  ]);
  // назад не міряли — у звіті немає; чотири поїздки — замало
  assert.equal(buildKptGpsReport(passes.filter((p) => p.vehicleId !== 'v0'), KPT).measured, 0);
});

function fakePrisma() {
  const rows: KptVisit[] = [];
  const prisma = {
    kyivKptPass: {
      createMany: async ({ data }: { data: KptVisit[] }) => (rows.push(...data), { count: data.length }),
      deleteMany: async ({ where }: { where: { firstAt: { lt: Date } } }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i--) if (rows[i].firstAt < where.firstAt.lt) rows.splice(i, 1);
        return { count: before - rows.length };
      },
      findMany: async ({ where }: { where: { firstAt: { gte: Date } } }) => rows.filter((r) => r.firstAt >= where.firstAt.gte),
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

test('запис: тік бере стрічку, пише закриті візити, чистить старі; помилка мережі — у стані, не виняток', async () => {
  const db = fakePrisma();
  db.rows.push(pass('old', 'Оболонь', -40 * 24 * 60));
  let now = at(0);
  let feed = encodeVehiclePositions({ at: now, vehicles: [veh('a', 50.5, 0)] });
  let fail = false;
  const rec = createKyivGpsRecorder({ prisma: db.prisma, url: 'x', now: () => now, fetchBytes: async () => {
    if (fail) throw new Error('HTTP 503');
    return feed;
  }, tracker: createVisitTracker(PTS) });
  let t = await rec.tick();
  assert.deepEqual([t.vehicles, t.open, t.written, t.deleted], [1, 1, 0, 1]);
  now = at(12);
  feed = encodeVehiclePositions({ at: now, vehicles: [veh('a', 50.45, 12)] });
  t = await rec.tick();
  assert.deepEqual([t.written, db.rows.map((r) => r.point)], [1, ['Оболонь']]);
  fail = true;
  t = await rec.tick();
  assert.equal(t.error, 'HTTP 503');
  assert.equal(rec.status()?.error, 'HTTP 503');
  assert.equal(await rec.flush(), 1);
  assert.deepEqual(db.rows.map((r) => r.point), ['Оболонь', 'Центр']);
});

test('HTTP: звіт і стан запису лише для адміна; дні 1–7', async () => {
  assert.deepEqual([parseKyivGpsDays(undefined), parseKyivGpsDays('7'), parseKyivGpsDays('8'), parseKyivGpsDays('x')], [2, 7, null, null]);
  const PASSWORD = 'kyiv-gps-test';
  const db = fakePrisma();
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  app.use(
    createAdminDovedeRouter({
      prisma: db.prisma,
      understand: null,
      settings: createDovedeSettings({ prisma: db.prisma, env: {} }),
      cityRoutes: {} as CityRoutes,
      access: { isPublic: () => false, password: () => 'guest' },
      driveTime: async () => ({ minutes: 95, source: 'fixed' }),
      now: () => at(60),
      kyivGps: { status: () => ({ at: at(59).toISOString(), vehicles: 400, open: 90, written: 12, deleted: 0 }) },
    }),
  );
  const server = await listenLocal(app);
  assert.equal((await request(server).get('/admin/dovede/kyiv/gps')).status, 401);
  assert.equal((await request(server).get('/admin/dovede/kyiv/gps?days=30').set('Authorization', adminAuthToken(PASSWORD))).status, 400);
  const ok = await request(server).get('/admin/dovede/kyiv/gps').set('Authorization', adminAuthToken(PASSWORD));
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.recording, ok.body.last.vehicles, ok.body.days, ok.body.passes, ok.body.truncated], [true, 400, 2, 0, false]);
});
