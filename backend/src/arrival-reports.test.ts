/**
 * Факт прибуття автобуса від пасажирів: розбір тіла, київський час і північ, вікна прийому,
 * HTTP POST /transport/arrival-reports і адмінська статистика / видалення. Записи з черги в браузері
 * (Docs/transport-offline-writes-2026-10.md): occurredAt замість серверного «зараз», ідемпотентність за
 * clientId + clientEventId.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import {
  MAX_OCCURRED_AGE_DAYS,
  arrivalReportStats,
  buildArrivalRow,
  clockDiff,
  kyivClock,
  minsToHhmm,
  parseArrivalReport,
  parseReportDays,
  resolveOccurredAt,
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
    occurredAt: null,
    clientEventId: null,
  });
  const missed = parseArrivalReport({ ...base, kind: 'missed', waitedMin: 20, minutesAgo: 5, clientId: '<script>' });
  assert.equal(missed?.waitedMin, 20);
  assert.equal(missed?.minutesAgo, 0);
  assert.equal(missed?.clientId, null);
});

test('parseArrivalReport: occurredAt і clientEventId із черги браузера', () => {
  const queued = parseArrivalReport({ ...base, occurredAt: '2026-10-09T14:52:00.000Z', clientEventId: '7f3c2a10-1111-4abc-9def-000000000001' });
  assert.ok(queued);
  assert.equal(queued.occurredAt?.toISOString(), '2026-10-09T14:52:00.000Z');
  assert.equal(queued.clientEventId, '7f3c2a10-1111-4abc-9def-000000000001');
  assert.equal(parseArrivalReport({ ...base, occurredAt: '' })?.occurredAt, null);
  assert.equal(parseArrivalReport({ ...base, occurredAt: null })?.occurredAt, null);
  assert.equal(parseArrivalReport({ ...base, clientEventId: 'x' })?.clientEventId, null);
  assert.equal(parseArrivalReport({ ...base, occurredAt: 'вчора' }), null);
  assert.equal(parseArrivalReport({ ...base, occurredAt: 1760000000000 }), null);
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

test('resolveOccurredAt / buildArrivalRow: час події з черги, а не момент отримання', () => {
  const now = kyiv('21:00');
  assert.equal(resolveOccurredAt(null, now), now);
  assert.equal(resolveOccurredAt(kyiv('17:50'), now)?.getTime(), kyiv('17:50').getTime());
  // годинник телефона поспішає більш як на 5 хв — серверний «зараз»
  assert.equal(resolveOccurredAt(kyiv('21:10'), now), now);
  assert.equal(resolveOccurredAt(kyiv('21:04'), now)?.getTime(), kyiv('21:04').getTime());
  // старший за тиждень — застарів
  assert.equal(resolveOccurredAt(kyiv('17:50', '2026-10-01'), now), null);
  assert.equal(resolveOccurredAt(new Date(now.getTime() - MAX_OCCURRED_AGE_DAYS * 24 * 60 * 60 * 1000 + 1000), now)?.getTime(), now.getTime() - MAX_OCCURRED_AGE_DAYS * 24 * 60 * 60 * 1000 + 1000);

  // звіт о 17:50 (розклад 17:46), отриманий о 21:00 — за серверним часом був би too_far
  const late = buildArrivalRow(input({ occurredAt: kyiv('17:50'), minutesAgo: 2, clientEventId: 'ev-0001-aaaa' }), now);
  assert.ok('row' in late);
  assert.deepEqual([late.row.serviceDate, late.row.actualTime, late.row.delayMin, late.row.clientEventId], ['2026-10-09', '17:48', 2, 'ev-0001-aaaa']);
  assert.deepEqual(buildArrivalRow(input({ occurredAt: kyiv('17:50', '2026-10-01') }), now), { error: 'too_old' });
  assert.deepEqual(buildArrivalRow(input(), now), { error: 'too_far' });
  // через північ із occurredAt: доба рейсу — за розкладом
  const overnight = buildArrivalRow(input({ scheduledTime: '23:55', occurredAt: kyiv('00:05', '2026-10-10') }), kyiv('09:00', '2026-10-10'));
  assert.ok('row' in overnight);
  assert.deepEqual([overnight.row.serviceDate, overnight.row.delayMin], ['2026-10-09', 10]);
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

function makeApp(initial: Stored[] = [], opts: { createThrows?: { code: string } } = {}) {
  const rows: Stored[] = [...initial];
  let createThrows = opts.createThrows;
  const prisma = {
    transportTrip: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 't5_back_1' ? { routeId: '5' } : null),
    },
    transportStop: {
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'st_0015' ? { id: where.id } : null),
    },
    transportArrivalReport: {
      create: async ({ data }: { data: ArrivalReportRow }) => {
        if (createThrows) {
          const e = createThrows;
          createThrows = undefined;
          throw Object.assign(new Error('Unique constraint failed'), e);
        }
        const row = { ...data, id: rows.length + 1, createdAt: new Date() };
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { clientId: string; clientEventId: string } }) => {
        const r = rows.find((x) => x.clientId === where.clientId && x.clientEventId === where.clientEventId);
        return r ? { actualTime: r.actualTime, delayMin: r.delayMin } : null;
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

test('POST /transport/arrival-reports: запис із черги — occurredAt, той самий clientEventId не дублюється', async () => {
  const { app, rows } = makeApp();
  const occurredAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const body = {
    ...base,
    scheduledTime: minsToHhmm(kyivClock(occurredAt).mins - 4),
    minutesAgo: 2,
    occurredAt: occurredAt.toISOString(),
    clientId: 'abcd-1234-efgh',
    clientEventId: '7f3c2a10-1111-4abc-9def-000000000001',
  };
  const send = (ip: string, b: object = body) => request(app).post('/transport/arrival-reports').set('X-Forwarded-For', ip).set('User-Agent', 'Phone').send(b);
  // за серверним часом було б 422 (три години тому) — а за occurredAt це факт у вікні
  const res = await send('203.0.113.5').expect(201);
  assert.equal(res.body.counted, true);
  assert.equal(res.body.actualTime, minsToHhmm(kyivClock(occurredAt).mins - 2));
  assert.equal(res.body.delayMin, 2);
  assert.equal(rows[0].clientEventId, body.clientEventId);
  // повтор із черги (інша мережа, через 10+ хв за IP-дедупом) — відповідь та сама, рядок один
  const again = await send('198.51.100.7').expect(200);
  assert.deepEqual([again.body.counted, again.body.actualTime, again.body.delayMin], [false, res.body.actualTime, 2]);
  assert.equal(rows.length, 1);
  // інший запис того самого клієнта — новий рядок
  await send('198.51.100.7', { ...body, clientEventId: '7f3c2a10-1111-4abc-9def-000000000002' }).expect(201);
  assert.equal(rows.length, 2);
  // без clientId ключа ідемпотентності нема — як старий клієнт
  await send('192.0.2.9', { ...body, clientId: undefined }).expect(201);
  assert.equal(rows.length, 3);
  assert.equal(rows[2].clientEventId, body.clientEventId);
});

test('POST /transport/arrival-reports: гонка двох вкладок (P2002) — 200 { counted: false }', async () => {
  const { app, rows } = makeApp([], { createThrows: { code: 'P2002' } });
  const res = await request(app)
    .post('/transport/arrival-reports')
    .send({ ...base, scheduledTime: nowHhmm(), clientId: 'abcd-1234-efgh', clientEventId: 'ev-0001-aaaa' })
    .expect(200);
  assert.equal(res.body.counted, false);
  assert.equal(rows.length, 0);
  // інша помилка бази — 500
  const broken = makeApp([], { createThrows: { code: 'P1001' } });
  await request(broken.app).post('/transport/arrival-reports').send({ ...base, scheduledTime: nowHhmm() }).expect(500);
});

test('POST /transport/arrival-reports: 400 / 404 / 422, нічого не пишеться', async () => {
  const { app, rows } = makeApp();
  const post = (b: object) => request(app).post('/transport/arrival-reports').send(b);
  await post({ ...base, kind: 'x' }).expect(400);
  await post({ ...base, scheduledTime: nowHhmm(), occurredAt: 'not-a-date' }).expect(400);
  const old = await post({ ...base, scheduledTime: nowHhmm(), occurredAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() }).expect(422);
  assert.equal(old.body.error, 'Report is too old');
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
    clientEventId: null,
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
    { id: 1, kind: 'arrived', routeId: '5', tripId: 't', direction: 'there', stopId: 'st_0015', serviceDate: '2026-10-08', scheduledTime: '10:00', actualTime: '10:01', delayMin: 1, waitedMin: null, source: 'board', clientId: null, clientEventId: null, createdAt: kyiv('10:01', '2026-10-08') },
    { id: 2, kind: 'arrived', routeId: '5', tripId: 't', direction: 'there', stopId: 'st_0015', serviceDate: '2026-10-09', scheduledTime: '10:00', actualTime: '10:03', delayMin: 3, waitedMin: null, source: 'board', clientId: null, clientEventId: null, createdAt: kyiv('10:03') },
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
