/**
 * Облік реклами «Доведе»: розбір подій, клас пристрою, POST /ads/events (повтор, `page` лише з доступом і хто саме,
 * `punched` — талон після ролика)
 * і зведення для стіни (GET /ads/wall — лише з ключем стіни; сьогодні / усього, входи, останні перегляди).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adWallSnapshot, deviceOf, parseAdEvent } from './ad-events';
import { dovedeAccessToken } from './dovede/access';
import { adminAuthToken } from './middleware/require-admin';
import { stickerWallKey } from './sticker-wall';

const ADMIN_PASSWORD = 'ads-test-admin';
const GUEST_PASSWORD = 'ads-test-guest';
type Row = {
  id: number;
  cityCode: string;
  placement: string;
  event: string;
  viewId: string;
  clientId: string | null;
  video: string | null;
  stopId: string | null;
  access: string | null;
  device: string | null;
  createdAt: Date;
};

type Person = { id: number; cityCode: string; clientId: string; teaserAt: Date | null };

function store(initial: Row[] = [], initialPeople: Person[] = []) {
  const rows = [...initial];
  const people = [...initialPeople];
  const prisma = {
    // люди з наклейок: номер пасажира в переглядах і позначка «досмотрів тизер» (src/sticker-people.ts)
    stickerPerson: {
      findMany: async (args: { where: { cityCode: string } }) => people.filter((p) => p.cityCode === args.where.cityCode),
      updateMany: async (args: { where: { cityCode: string; clientId: string; teaserAt: null }; data: { teaserAt: Date } }) => {
        const hit = people.filter((p) => p.cityCode === args.where.cityCode && p.clientId === args.where.clientId && p.teaserAt === null);
        hit.forEach((p) => (p.teaserAt = args.data.teaserAt));
        return { count: hit.length };
      },
    },
    adEvent: {
      create: async ({ data }: { data: Omit<Row, 'id' | 'createdAt'> }) => {
        if (rows.some((r) => r.viewId === data.viewId && r.event === data.event)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { id: rows.length + 1, createdAt: new Date(), ...data } as Row;
        rows.push(row);
        return row;
      },
      findMany: async (args: { where?: { createdAt?: { gte: Date }; OR?: { placement: string; cityCode?: string }[] } }) => {
        const gte = args.where?.createdAt?.gte;
        const or = args.where?.OR;
        return rows
          .filter((r) => !gte || r.createdAt >= gte)
          .filter((r) => !or || or.some((o) => o.placement === r.placement && (o.cityCode === undefined || o.cityCode === r.cityCode)))
          .sort((a, b) => a.id - b.id);
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows, people };
}

function app(prisma: PrismaClient, isPublic = false) {
  return createApp({ prisma, adminPassword: ADMIN_PASSWORD, dovedeAccess: { isPublic: () => isPublic, password: () => GUEST_PASSWORD } });
}

const VIEW = '0f4c2a8e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
const CLIENT = 'aa11bb22-cc33-dd44-ee55-ff6677889900';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';

test('parseAdEvent: наклейка з зупинкою, «Доведе» без; page і punched — лише «Доведе»; сміття — null', () => {
  assert.deepEqual(parseAdEvent({ placement: 'sticker', event: 'shown', viewId: VIEW, clientId: CLIENT, video: 'hint-1a2b3c4d', stopId: 'st_0015' }), {
    placement: 'sticker',
    event: 'shown',
    viewId: VIEW,
    clientId: CLIENT,
    video: 'hint-1a2b3c4d',
    stopId: 'st_0015',
  });
  assert.equal(parseAdEvent({ placement: 'sticker', event: 'shown', viewId: VIEW }), null, 'наклейка без зупинки');
  assert.equal(parseAdEvent({ placement: 'dovede', event: 'page', viewId: VIEW })?.stopId, null);
  assert.equal(parseAdEvent({ placement: 'dovede', event: 'shown', viewId: VIEW, stopId: 'st_0015' })?.stopId, null);
  assert.equal(parseAdEvent({ placement: 'sticker', event: 'page', viewId: VIEW, stopId: 'st_1' }), null);
  assert.equal(parseAdEvent({ placement: 'dovede', event: 'punched', viewId: VIEW })?.event, 'punched');
  assert.equal(parseAdEvent({ placement: 'sticker', event: 'punched', viewId: VIEW, stopId: 'st_1' }), null);
  for (const bad of [null, {}, { placement: 'x', event: 'shown', viewId: VIEW }, { placement: 'dovede', event: 'clicked', viewId: VIEW }, { placement: 'dovede', event: 'shown', viewId: 'short' }]) {
    assert.equal(parseAdEvent(bad), null, JSON.stringify(bad));
  }
  assert.equal(parseAdEvent({ placement: 'dovede', event: 'shown', viewId: VIEW, clientId: 'bad id', video: 'Bad Name' })?.clientId, null);
});

test('deviceOf: лише клас пристрою', () => {
  assert.equal(deviceOf(IPHONE), 'ios');
  assert.equal(deviceOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'), 'android');
  assert.equal(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130'), 'desktop');
  assert.equal(deviceOf(undefined), 'other');
});

test('POST /ads/events: записує з пристроєм і містом, повтор тієї ж події — 200 без запису, сміття — 400', async () => {
  const { prisma, rows, people } = store([], [{ id: 1, cityCode: 'Malyn', clientId: CLIENT, teaserAt: null }]);
  const a = app(prisma);
  const body = { placement: 'sticker', event: 'started', viewId: VIEW, clientId: CLIENT, video: 'hint-1a2b3c4d', stopId: 'st_0015' };
  const first = await request(a).post('/ads/events').set('User-Agent', IPHONE).send(body).expect(201);
  assert.deepEqual(first.body, { ok: true, counted: true });
  const again = await request(a).post('/ads/events').send(body).expect(200);
  assert.deepEqual(again.body, { ok: true, counted: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].device, 'ios');
  assert.equal(rows[0].cityCode, 'Malyn');
  assert.equal(rows[0].access, null);
  assert.equal(people[0].teaserAt, null, 'почав — ще не досмотрів');
  await request(a).post('/ads/events').send({ ...body, event: 'completed' }).expect(201);
  assert.ok(people[0].teaserAt instanceof Date, 'досмотрений тизер позначено в людини з наклейок');
  await request(a).post('/ads/events').send({ placement: 'sticker', event: 'shown', viewId: VIEW }).expect(400);
  await request(a).post('/ads/events').send({ ...body, event: 'shown', city: 'Atlantis' }).expect(404);
});

test('POST /ads/events page: без доступу — 403; гість із паролем, адмін і відкрита сторінка — свій access', async () => {
  const { prisma, rows } = store();
  const a = app(prisma);
  const page = (viewId: string) => ({ placement: 'dovede', event: 'page', viewId, clientId: CLIENT });
  await request(a).post('/ads/events').send(page('11111111-aaaa')).expect(403);
  await request(a).post('/ads/events').set('X-Dovede-Token', dovedeAccessToken('чужий')).send(page('11111111-aaab')).expect(403);
  await request(a).post('/ads/events').set('X-Dovede-Token', dovedeAccessToken(GUEST_PASSWORD)).send(page('22222222-bbbb')).expect(201);
  await request(a).post('/ads/events').set('Authorization', adminAuthToken(ADMIN_PASSWORD)).send(page('33333333-cccc')).expect(201);
  await request(app(prisma, true)).post('/ads/events').send(page('44444444-dddd')).expect(201);
  assert.deepEqual(
    rows.map((r) => r.access),
    ['guest', 'admin', 'public'],
  );
});

test('POST /ads/events punched: талон після ролика — без доступу; хто компостував — за заголовком, якщо є', async () => {
  const { prisma, rows } = store();
  const a = app(prisma);
  const punched = (viewId: string) => ({ placement: 'dovede', event: 'punched', viewId, clientId: CLIENT, video: 'intro-55427b80' });
  await request(a).post('/ads/events').send(punched('11111111-aaaa')).expect(201);
  await request(a).post('/ads/events').set('X-Dovede-Token', dovedeAccessToken(GUEST_PASSWORD)).send(punched('22222222-bbbb')).expect(201);
  await request(a).post('/ads/events').set('Authorization', adminAuthToken(ADMIN_PASSWORD)).send(punched('33333333-cccc')).expect(201);
  await request(a).post('/ads/events').send(punched('11111111-aaaa')).expect(200);
  await request(a).post('/ads/events').send({ ...punched('44444444-dddd'), placement: 'sticker', stopId: 'st_0015' }).expect(400);
  assert.deepEqual(
    rows.map((r) => [r.event, r.access]),
    [
      ['punched', null],
      ['punched', 'guest'],
      ['punched', 'admin'],
    ],
  );
});

test('зведення стіни: сьогодні й усього, хто дивився, входи на /dovede, наклейки лише свого міста', async () => {
  const NOW = new Date('2026-11-17T12:00:00Z'); // 14:00 за Києвом
  const row = (id: number, r: Partial<Row>): Row => ({
    id,
    cityCode: 'Malyn',
    placement: 'sticker',
    event: 'shown',
    viewId: 'view-0001',
    clientId: CLIENT,
    video: 'hint-1a2b3c4d',
    stopId: 'st_0015',
    access: null,
    device: 'ios',
    createdAt: NOW,
    ...r,
  });
  const yesterday = new Date('2026-11-16T12:00:00Z');
  const { prisma } = store([
    row(1, { viewId: 'view-0000', createdAt: yesterday }),
    row(2, { viewId: 'view-0000', event: 'started', createdAt: yesterday }),
    row(3, {}),
    row(4, { event: 'started' }),
    row(5, { event: 'completed' }),
    row(6, { viewId: 'view-0002', clientId: 'other-client-0002', device: 'android' }),
    row(7, { viewId: 'view-0003', cityCode: 'Korosten' }),
    row(8, { placement: 'dovede', viewId: 'view-0004', stopId: null, video: 'intro-55427b80', device: 'desktop' }),
    row(9, { placement: 'dovede', viewId: 'view-0004', stopId: null, event: 'completed', device: 'desktop' }),
    row(10, { placement: 'dovede', viewId: 'page-0005', stopId: null, event: 'page', access: 'guest', video: null }),
    // пізніша подія того самого перегляду з іншим id браузера — не нова людина
    row(11, { viewId: 'view-0002', event: 'started', clientId: 'third-client-0003', device: 'android' }),
    row(12, { placement: 'dovede', viewId: 'page-0006', stopId: null, event: 'page', access: 'admin', video: null, createdAt: yesterday }),
    // після ролика — талон; компостував адмін (перегляд сам цього не знав)
    row(13, { placement: 'dovede', viewId: 'view-0004', stopId: null, event: 'punched', access: 'admin', device: 'desktop' }),
  ], [
    // люди з наклейок Малина: CLIENT — другий за появою (id 7 після id 3), other-client — не з наклейки
    { id: 7, cityCode: 'Malyn', clientId: CLIENT, teaserAt: null },
    { id: 3, cityCode: 'Malyn', clientId: 'first-person-0001', teaserAt: null },
    { id: 9, cityCode: 'Korosten', clientId: 'other-client-0002', teaserAt: null },
  ]);
  const snap = await adWallSnapshot(prisma, { cityCode: 'Malyn', now: NOW });
  assert.equal(snap.day, '2026-11-17');
  assert.deepEqual(snap.sticker.today, { shown: 2, started: 2, completed: 1 });
  assert.deepEqual(snap.sticker.total, { shown: 3, started: 3, completed: 1 });
  assert.equal(snap.sticker.people, 2, 'люди — за першою подією перегляду, як «хто» у списку');
  assert.deepEqual(snap.dovede.today, { shown: 1, started: 0, completed: 1, pages: 1, punched: 1 });
  assert.equal(snap.dovede.total.punched, 1);
  assert.deepEqual(snap.dovede.access, { admin: 1, guest: 1, public: 0 });
  assert.deepEqual(snap.dovede.todayAccess, { admin: 0, guest: 1, public: 0 }, 'адмін заходив учора');
  assert.equal(snap.dovede.total.pages, 2);
  assert.equal(snap.views.length, 6, 'перегляд із Коростеня не на стіні Малина');
  const mine = snap.views.find((v) => v.viewId === 'view-0001');
  assert.equal(mine?.completed, true);
  assert.equal(mine?.seenBefore, 1, 'той самий браузер бачив рекламу вчора');
  assert.equal(mine?.who, CLIENT.slice(-4));
  assert.equal(mine?.number, 2, 'номер пасажира — порядок появи в місті стіни');
  assert.equal(snap.views.find((v) => v.viewId === 'view-0002')?.number, null, 'людина з наклейок іншого міста — без номера тут');
  const page = snap.views.find((v) => v.viewId === 'page-0005');
  assert.equal(page?.kind, 'page');
  assert.equal(page?.access, 'guest');
  const dovede = snap.views.find((v) => v.viewId === 'view-0004');
  assert.equal(dovede?.completed, true);
  assert.equal(dovede?.started, true, 'досмотрів — значить грав');
  assert.equal(dovede?.punched, true);
  assert.equal(dovede?.access, 'admin', 'хто компостував');
  assert.equal(mine?.punched, false);
});

test('GET /ads/wall: лише з ключем стіни, без кешу', async () => {
  const { prisma } = store();
  const a = app(prisma);
  await request(a).get('/ads/wall').expect(403);
  await request(a).get('/ads/wall?key=0123456789abcdef0123456789abcdef').expect(403);
  const res = await request(a).get(`/ads/wall?key=${stickerWallKey(ADMIN_PASSWORD)}`).expect(200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body.sticker.today, { shown: 0, started: 0, completed: 0 });
  assert.deepEqual(res.body.views, []);
  await request(a).get(`/ads/wall?key=${stickerWallKey(ADMIN_PASSWORD)}&city=Atlantis`).expect(404);
});
