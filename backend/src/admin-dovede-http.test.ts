/**
 * HTTP: POST /admin/dovede/understand («Доведе», фаза 2) — доступ лише адміну, перемикачі, денний ліміт,
 * журнал DovedeQuery. Claude підмінено заглушкою.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { createAdminDovedeRouter, intentsAgree } from './routes/admin-dovede';
import { validateIntent, type TripIntent } from './dovede/intent';
import type { UnderstandFn, UnderstandResult } from './dovede/understand';
import express from 'express';
import { setAdminPassword } from './middleware/require-admin';

const PASSWORD = 'http-test-admin-password-dovede';
const AUTH = adminAuthToken(PASSWORD);

const INTENT: TripIntent = {
  intent: 'trip',
  from: { id: 'city.Kyiv', text: 'Києва' },
  to: { id: 'malyn.vokzal', text: 'вокзал' },
  when: { day: 'today', kind: 'depart' },
  modes: [],
  unknown: [],
  confidence: 'high',
};

const okResult = (intent: TripIntent = INTENT): UnderstandResult => ({
  ok: true,
  intent,
  model: 'claude-opus-5-5',
  latencyMs: 1200,
  promptVersion: 'dovede-understand-v1',
  usage: { inputTokens: 50, outputTokens: 80, cacheReadTokens: 1700, cacheWriteTokens: 0 },
});

type Row = Record<string, unknown>;

function fakePrisma(callsToday = 0): { prisma: PrismaClient; rows: Row[]; countWhere: unknown[] } {
  const rows: Row[] = [];
  const countWhere: unknown[] = [];
  const prisma = {
    dovedeQuery: {
      create: async ({ data }: { data: Row }) => {
        rows.push(data);
        return data;
      },
      count: async ({ where }: { where: unknown }) => {
        countWhere.push(where);
        return callsToday;
      },
    },
    transportStop: {
      findMany: async ({ where }: { where: { cityCode: string } }) =>
        where.cityCode === 'Malyn' ? [{ id: 'st_0071', name: 'Поворот на Коновальця' }, { id: 'st_0160', name: '№5 т.3' }] : [],
    },
  } as unknown as PrismaClient;
  return { prisma, rows, countWhere };
}

function appWith(opts: { prisma: PrismaClient; understand?: UnderstandFn | null; enabled?: boolean; cap?: number }) {
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  app.use(
    createAdminDovedeRouter({
      prisma: opts.prisma,
      understand: opts.understand === undefined ? async () => okResult() : opts.understand,
      enabled: () => opts.enabled ?? true,
      dailyCap: () => opts.cap ?? 300,
      now: () => new Date('2026-11-13T12:20:00.000Z'),
    }),
  );
  return app;
}

test('без токена адміна — 401, Claude не викликається', async () => {
  const { prisma, rows } = fakePrisma();
  let called = 0;
  const app = createApp({
    prisma,
    adminPassword: PASSWORD,
    dovedeUnderstand: async () => {
      called++;
      return okResult();
    },
  });
  const res = await request(app).post('/admin/dovede/understand').send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 401);
  assert.equal(called, 0);
  assert.equal(rows.length, 0);
});

test('createApp без ключа: 503 з fallback local', async () => {
  const { prisma } = fakePrisma();
  const app = createApp({ prisma, adminPassword: PASSWORD, dovedeUnderstand: null });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'no_key' });
});

test('успіх: намір, згода з місцевим розбором, рядок журналу з токенами', async () => {
  const { prisma, rows, countWhere } = fakePrisma();
  const seen: Array<{ text: string; now: unknown }> = [];
  const app = appWith({
    prisma,
    understand: async (text, now) => {
      seen.push({ text, now });
      return okResult();
    },
  });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: '  з Києва на вокзал  ', local: INTENT });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { intent: INTENT, agree: true, model: 'claude-opus-5-5', latencyMs: 1200 });
  assert.deepEqual(seen, [{ text: 'з Києва на вокзал', now: { date: '2026-11-13', mins: 14 * 60 + 20 } }], '«зараз» — серверний київський час');
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { ...rows[0], localIntent: undefined, aiIntent: undefined },
    {
      text: 'з Києва на вокзал',
      localIntent: undefined,
      aiIntent: undefined,
      agree: true,
      status: 'ok',
      aiCalled: true,
      model: 'claude-opus-5-5',
      promptVersion: 'dovede-understand-v1',
      latencyMs: 1200,
      inputTokens: 50,
      outputTokens: 80,
      cacheReadTokens: 1700,
      cacheWriteTokens: 0,
      error: undefined,
    },
  );
  assert.deepEqual(rows[0].aiIntent, INTENT);
  assert.deepEqual(countWhere, [{ aiCalled: true, createdAt: { gte: new Date('2026-11-12T22:00:00.000Z') } }]);
});

test('розбіжність із місцевим розбором: agree = false', async () => {
  const { prisma, rows } = fakePrisma();
  const app = appWith({ prisma, understand: async () => okResult({ ...INTENT, to: { id: 'malyn.avtostantsiya', text: 'автостанція' } }) });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва на вокзал', local: INTENT });
  assert.equal(res.body.agree, false);
  assert.equal(rows[0].agree, false);
});

test('місцевий розбір з чужим id не ламає запит: id переноситься в unknown', async () => {
  const { prisma, rows } = fakePrisma();
  const app = appWith({ prisma });
  const res = await request(app)
    .post('/admin/dovede/understand')
    .set('Authorization', AUTH)
    .send({ text: 'з Львова на вокзал', local: { ...INTENT, from: { id: 'city.Lviv', text: 'Львова' } } });
  assert.equal(res.status, 200);
  const logged = rows[0].localIntent as TripIntent;
  assert.equal(logged.from, null);
  assert.deepEqual(logged.unknown, ['Львова']);
});

test('вимкнено (DOVEDE_ENABLED=0): 503 disabled, Claude не викликається, у журналі aiCalled немає', async () => {
  const { prisma, rows } = fakePrisma();
  let called = 0;
  const app = appWith({
    prisma,
    enabled: false,
    understand: async () => {
      called++;
      return okResult();
    },
  });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'disabled' });
  assert.equal(called, 0);
  assert.deepEqual(rows, [{ text: 'з Києва в Малин', localIntent: undefined, status: 'disabled' }]);
});

test('денний ліміт вичерпано: 429 cap, Claude не викликається', async () => {
  const { prisma, rows } = fakePrisma(25);
  let called = 0;
  const app = appWith({
    prisma,
    cap: 25,
    understand: async () => {
      called++;
      return okResult();
    },
  });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'cap' });
  assert.equal(called, 0);
  assert.equal(rows[0].status, 'cap');
});

test('збій Claude: 503 з причиною, у журналі — виклик і помилка', async () => {
  const { prisma, rows } = fakePrisma();
  const app = appWith({
    prisma,
    understand: async () => ({ ok: false, failure: 'timeout', message: 'Claude не відповів вчасно', model: 'claude-opus-5-5', latencyMs: 8000, promptVersion: 'dovede-understand-v1' }),
  });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'timeout' });
  assert.equal(rows[0].status, 'timeout');
  assert.equal(rows[0].aiCalled, true);
  assert.equal(rows[0].error, 'Claude не відповів вчасно');
});

test('виняток усередині (зокрема збій журналу) теж дає fallback local, а не 500', async () => {
  const { prisma } = fakePrisma();
  (prisma.dovedeQuery as unknown as { count: () => Promise<number> }).count = async () => {
    throw new Error('db down');
  };
  const res = await request(appWith({ prisma })).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'api_error' });
});

test('порожнє й задовге питання — 400', async () => {
  const { prisma, rows } = fakePrisma();
  const app = appWith({ prisma });
  assert.equal((await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: '   ' })).status, 400);
  assert.equal((await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({})).status, 400);
  assert.equal((await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'я'.repeat(301) })).status, 400);
  assert.equal(rows.length, 0);
});

test('intentsAgree: текст місця й упевненість не важать, місця / день / час / транспорт — важать', () => {
  const a = validateIntent(INTENT);
  assert.equal(intentsAgree(a, { ...a, from: { id: 'city.Kyiv', text: 'Киева' }, confidence: 'medium' }), true);
  assert.equal(intentsAgree(a, { ...a, from: null }), false);
  assert.equal(intentsAgree(a, { ...a, when: { day: 'tomorrow', kind: 'depart' } }), false);
  assert.equal(intentsAgree(a, { ...a, modes: ['elektrichka'] }), false);
  assert.equal(intentsAgree(a, { ...a, when: { day: 'today', kind: 'any' } }), true, 'без часу kind нічого не змінює');
  assert.equal(intentsAgree({ ...a, when: { day: 'today', time: '09:00', kind: 'arrive' } }, { ...a, when: { day: 'today', time: '09:00', kind: 'depart' } }), false);
});

test('зупинки міста з бази: Claude отримує їх усі, id зупинки дозволений у відповіді й у місцевому розборі', async () => {
  const { prisma, rows } = fakePrisma();
  const seen: unknown[] = [];
  const withStop: TripIntent = { ...INTENT, from: { id: 'st_0071', text: 'поворот на коновальця' } };
  const app = appWith({
    prisma,
    understand: async (_text, _now, stops) => {
      seen.push(stops);
      return okResult(withStop);
    },
  });
  const res = await request(app).post('/admin/dovede/understand').set('Authorization', AUTH).send({ text: 'з поворот на коновальця на вокзал', local: withStop });
  assert.equal(res.status, 200);
  assert.equal(res.body.intent.from.id, 'st_0071');
  assert.equal(res.body.agree, true);
  assert.deepEqual(seen, [[{ id: 'st_0071', name: 'Поворот на Коновальця' }, { id: 'st_0160', name: '№5 т.3' }]]);
  assert.equal((rows[0].localIntent as TripIntent).from?.id, 'st_0071');
});
