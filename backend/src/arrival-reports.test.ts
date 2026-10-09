/**
 * Факт прибуття автобуса від пасажирів: розбір тіла, київський час і північ, вікна прийому,
 * HTTP POST /transport/arrival-reports і адмінська статистика / видалення.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import {
  arrivalReportStats,
  buildArrivalRow,
  clockDiff,
  kyivClock,
  minsToHhmm,
  parseArrivalReport,
  parseReportDays,
  type ArrivalReportInput,
  type ArrivalReportRow,
} from './arrival-reports';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-arrivals';

const base = {
  kind: 'arrived',
  routeId: '5',
  tripId: 't5_back_1',
  direction: 'back',
  stopId: 'st_0015',
  scheduledTime: '17:46',
  source: 'route',
};

function input(over: Partial<ArrivalReportInput> = {}): ArrivalReportInput {
  return { ...(parseArrivalReport(base) as ArrivalReportInput), ...over };
}

/** Київ у жовтні — UTC+3 */
const kyiv = (hhmm: string, date = '2026-10-09') => new Date(`${date}T${hhmm}:00+03:00`);

test('parseArrivalReport: валідне тіло, необов’язкові поля і clientId', () => {
  assert.deepEqual(parseArrivalReport({ ...base, minutesAgo: 2, clientId: 'abcd-1234-efgh' }), {
    ...base,
    minutesAgo: 2,
    waitedMin: null,
    clientId: 'abcd-1234-efgh',
  });
  const missed = parseArrivalReport({ ...base, kind: 'missed', waitedMin: 20, minutesAgo: 5, clientId: '<script>' });
  assert.equal(missed?.waitedMin, 20);
  assert.equal(missed?.minutesAgo, 0);
  assert.equal(missed?.clientId, null);
});

test('parseArrivalReport: невалідне — null', () => {
  assert.equal(parseArrivalReport(null), null);
  assert.equal(parseArrivalReport({ ...base, kind: 'late' }), null);
  assert.equal(parseArrivalReport({ ...base, direction: 'up' }), null);
  assert.equal(parseArrivalReport({ ...base, stopId: '../etc' }), null);
  assert.equal(parseArrivalReport({ ...base, scheduledTime: '24:00' }), null);
  assert.equal(parseArrivalReport({ ...base, scheduledTime: '7:46' }), null);
  assert.equal(parseArrivalReport({ ...base, source: 'bot' }), null);
  assert.equal(parseArrivalReport({ ...base, minutesAgo: 31 }), null);
  assert.equal(parseArrivalReport({ ...base, minutesAgo: 1.5 }), null);
  assert.equal(parseArrivalReport({ ...base, kind: 'missed', waitedMin: 0 }), null);
  assert.equal(parseArrivalReport({ ...base, tripId: '' }), null);
});

test('kyivClock / clockDiff / minsToHhmm', () => {
  assert.deepEqual(kyivClock(kyiv('17:52')), { date: '2026-10-09', mins: 17 * 60 + 52 });
  assert.equal(clockDiff(17 * 60 + 52, 17 * 60 + 46), 6);
  assert.equal(clockDiff(17 * 60 + 40, 17 * 60 + 46), -6);
  assert.equal(clockDiff(5, 23 * 60 + 55), 10);
  assert.equal(clockDiff(23 * 60 + 55, 5), -10);
  assert.equal(minsToHhmm(-3), '23:57');
  assert.equal(minsToHhmm(1445), '00:05');
});

test('buildArrivalRow: приїхав — факт за годинником сервера мінус minutesAgo, запізнення', () => {
  const r = buildArrivalRow(input({ minutesAgo: 2 }), kyiv('17:54'));
  assert.ok('row' in r);
  assert.equal(r.row.serviceDate, '2026-10-09');
  assert.equal(r.row.actualTime, '17:52');
  assert.equal(r.row.delayMin, 6);
  assert.equal(r.row.waitedMin, null);
});

test('buildArrivalRow: через північ — доба рейсу за розкладом', () => {
  const late = buildArrivalRow(input({ scheduledTime: '23:55' }), kyiv('00:05', '2026-10-10'));
  assert.ok('row' in late);
  assert.equal(late.row.serviceDate, '2026-10-09');
  assert.equal(late.row.delayMin, 10);
  const early = buildArrivalRow(input({ scheduledTime: '00:05' }), kyiv('23:58'));
  assert.ok('row' in early);
  assert.equal(early.row.serviceDate, '2026-10-10');
  assert.equal(early.row.delayMin, -7);
});

test('buildArrivalRow: вікна прийому для arrived і missed', () => {
  assert.deepEqual(buildArrivalRow(input(), kyiv('19:30')), { error: 'too_far' });
  assert.deepEqual(buildArrivalRow(input(), kyiv('16:00')), { error: 'too_far' });
  assert.ok('row' in buildArrivalRow(input(), kyiv('19:00')));
  const missed = (now: string) => buildArrivalRow(input({ kind: 'missed', waitedMin: 30 }), kyiv(now));
  assert.deepEqual(missed('17:30'), { error: 'too_far' });
  const ok = missed('18:20');
  assert.ok('row' in ok);
  assert.equal(ok.row.actualTime, null);
  assert.equal(ok.row.delayMin, null);
  assert.equal(ok.row.waitedMin, 30);
  assert.deepEqual(missed('21:00'), { error: 'too_far' });
});

test('parseReportDays', () => {
  assert.equal(parseReportDays('7'), 7);
  assert.equal(parseReportDays('1'), 1);
  assert.equal(parseReportDays('5'), 30);
  assert.equal(parseReportDays(undefined), 30);
});

type Stored = ArrivalReportRow & { id: number; createdAt: Date };

function makeApp(initial: Stored[] = []) {
  const rows: Stored[] = [...initial];
  const prisma = {
    transportTrip: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 't5_back_1' ? { routeId: '5' } : null),
    },
    transportStop: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'st_0015' ? { id: where.id } : null),
    },
    transportArrivalReport: {
      create: async ({ data }: { data: ArrivalReportRow }) => {
        const row = { ...data, id: rows.length + 1, createdAt: new Date() };
        rows.push(row);
        return row;
      },
      findMany: async (args: { where?: { createdAt?: { gte: Date }; serviceDate?: { gte: string } } }) => {
        const gte = args.where?.createdAt?.gte;
        const day = args.where?.serviceDate?.gte;
        return rows
          .filter((r) => (!gte || r.createdAt >= gte) && (!day || r.serviceDate >= day))
          .sort((a, b) => b.id - a.id);
      },
      deleteMany: async ({ where }: { where: { id: number } }) => {
        const i = rows.findIndex((r) => r.id === where.id);
        if (i < 0) return { count: 0 };
        rows.splice(i, 1);
        return { count: 1 };
      },
    },
  } as unknown as PrismaClient;
  return { app: createApp({ prisma, adminPassword: TEST_ADMIN_PASSWORD }), prisma, rows };
}

const nowHhmm = () => minsToHhmm(kyivClock(new Date()).mins);

test('POST /transport/arrival-reports: записує факт прибуття, повтор за 10 хв не рахується', async () => {
  const { app, rows } = makeApp();
  const body = { ...base, scheduledTime: nowHhmm() };
  const send = () => request(app).post('/transport/arrival-reports').set('X-Forwarded-For', '203.0.113.5').set('User-Agent', 'Phone').send(body);
  const res = await send().expect(201);
  assert.equal(res.body.counted, true);
  assert.ok(Math.abs(res.body.delayMin) <= 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'arrived');
  assert.equal(rows[0].source, 'route');
  const again = await send().expect(200);
  assert.equal(again.body.counted, false);
  assert.equal(rows.length, 1);
  await request(app)
    .post('/transport/arrival-reports')
    .set('X-Forwarded-For', '203.0.113.5')
    .set('User-Agent', 'Phone')
    .send({ ...body, kind: 'missed', waitedMin: 15 })
    .expect(201);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].waitedMin, 15);
});

test('POST /transport/arrival-reports: 400 / 404 / 422, нічого не пишеться', async () => {
  const { app, rows } = makeApp();
  const post = (b: object) => request(app).post('/transport/arrival-reports').send(b);
  await post({ ...base, kind: 'x' }).expect(400);
  await post({ ...base, scheduledTime: nowHhmm(), tripId: 'unknown' }).expect(404);
  await post({ ...base, scheduledTime: nowHhmm(), routeId: '7' }).expect(404);
  await post({ ...base, scheduledTime: nowHhmm(), stopId: 'st_9999' }).expect(404);
  const far = minsToHhmm(kyivClock(new Date()).mins + 300);
  await post({ ...base, scheduledTime: far }).expect(422);
  assert.equal(rows.length, 0);
});

test('GET /admin/transport/arrival-reports: auth, зведення по рейсу на зупинці', async () => {
  const at = new Date();
  const row = (id: number, over: Partial<Stored>): Stored => ({
    id,
    kind: 'arrived',
    routeId: '5',
    tripId: 't5_back_1',
    direction: 'back',
    stopId: 'st_0015',
    serviceDate: '2026-10-08',
    scheduledTime: '17:46',
    actualTime: '17:50',
    delayMin: 4,
    waitedMin: null,
    source: 'route',
    clientId: null,
    createdAt: at,
    ...over,
  });
  const { app } = makeApp([
    row(1, {}),
    row(2, { serviceDate: '2026-10-09', actualTime: '17:56', delayMin: 10, source: 'board' }),
    row(3, { kind: 'missed', serviceDate: '2026-10-07', actualTime: null, delayMin: null, waitedMin: 30 }),
    row(4, { routeId: '3', tripId: 't3', scheduledTime: '08:00', delayMin: -1 }),
    row(5, { createdAt: new Date(at.getTime() - 40 * 24 * 60 * 60 * 1000) }),
  ]);
  await request(app).get('/admin/transport/arrival-reports').expect(401);
  const res = await request(app)
    .get('/admin/transport/arrival-reports?days=30')
    .set('Authorization', adminAuthToken(TEST_ADMIN_PASSWORD))
    .expect(200);
  assert.deepEqual([res.body.total, res.body.arrived, res.body.missed], [4, 3, 1]);
  assert.deepEqual(res.body.recent.map((r: { id: number }) => r.id), [4, 3, 2, 1]);
  const top = res.body.summary[0];
  assert.deepEqual(
    [top.routeId, top.stopId, top.scheduledTime, top.arrived, top.missed, top.avgDelay, top.minDelay, top.maxDelay, top.days],
    ['5', 'st_0015', '17:46', 2, 1, 7, 4, 10, 3]
  );
  assert.equal(res.body.summary.length, 2);
});

test('arrivalReportStats: days=1 — лише сьогоднішня київська доба рейсу', async () => {
  const { prisma } = makeApp([
    { id: 1, kind: 'arrived', routeId: '5', tripId: 't', direction: 'there', stopId: 'st_0015', serviceDate: '2026-10-08', scheduledTime: '10:00', actualTime: '10:01', delayMin: 1, waitedMin: null, source: 'board', clientId: null, createdAt: kyiv('10:01', '2026-10-08') },
    { id: 2, kind: 'arrived', routeId: '5', tripId: 't', direction: 'there', stopId: 'st_0015', serviceDate: '2026-10-09', scheduledTime: '10:00', actualTime: '10:03', delayMin: 3, waitedMin: null, source: 'board', clientId: null, createdAt: kyiv('10:03') },
  ]);
  const stats = await arrivalReportStats(prisma, { days: 1, now: kyiv('12:00') });
  assert.deepEqual(stats.recent.map((r) => r.id), [2]);
});

test('DELETE /admin/transport/arrival-reports/:id', async () => {
  const { app, rows } = makeApp();
  const auth = adminAuthToken(TEST_ADMIN_PASSWORD);
  await request(app).post('/transport/arrival-reports').send({ ...base, scheduledTime: nowHhmm() }).expect(201);
  await request(app).delete('/admin/transport/arrival-reports/1').expect(401);
  await request(app).delete('/admin/transport/arrival-reports/abc').set('Authorization', auth).expect(400);
  await request(app).delete('/admin/transport/arrival-reports/9').set('Authorization', auth).expect(404);
  await request(app).delete('/admin/transport/arrival-reports/1').set('Authorization', auth).expect(200);
  assert.equal(rows.length, 0);
});
