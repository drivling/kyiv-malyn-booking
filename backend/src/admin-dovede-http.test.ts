/**
 * HTTP: POST /dovede/understand («Доведе», фаза 2) — доступ лише адміну, перемикачі, денний ліміт,
 * журнал DovedeQuery. Claude підмінено заглушкою.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { listenLocal } from './http-test-server';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import { createAdminDovedeRouter, intentsAgree, pickupNote } from './routes/admin-dovede';
import { validateIntent, type TripIntent } from './dovede/intent';
import type { UnderstandFn, UnderstandResult } from './dovede/understand';
import express from 'express';
import type { DriveTimeFn } from './drive-time';
import type { CityRoutes, CityRouteQuery } from './dovede/city-route';
import { setAdminPassword } from './middleware/require-admin';
import { dovedeAccessToken } from './dovede/access';

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

function fakePrisma(callsToday = 0): { prisma: PrismaClient; rows: Row[]; countWhere: unknown[]; synonymRows: Row[] } {
  const rows: Row[] = [];
  const synonymRows: Row[] = [];
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
    // синоніми з адмінки: маленька таблиця в памʼяті з унікальною фразою
    dovedeSynonym: {
      findMany: async () => [...synonymRows].sort((x, y) => String(x.phrase).localeCompare(String(y.phrase))),
      upsert: async ({ where, create, update }: { where: { phrase: string }; create: Row; update: Row }) => {
        const hit = synonymRows.find((x) => x.phrase === where.phrase);
        if (hit) return Object.assign(hit, update);
        const row = { id: synonymRows.length + 1, createdAt: new Date('2026-11-14T08:00:00.000Z'), ...create };
        synonymRows.push(row);
        return row;
      },
      deleteMany: async ({ where }: { where: { id: number } }) => {
        const at = synonymRows.findIndex((x) => x.id === where.id);
        if (at >= 0) synonymRows.splice(at, 1);
        return { count: at >= 0 ? 1 : 0 };
      },
    },
    transportStop: {
      findMany: async ({ where }: { where: { cityCode: string } }) =>
        where.cityCode === 'Malyn'
          ? [{ id: 'st_0071', name: 'Поворот на Коновальця' }, { id: 'st_0160', name: '№5 т.3' }]
          : where.cityCode === 'Korosten'
            ? [{ id: 'st_1079', name: 'Міськлікарня' }, { id: 'st_1087', name: 'Пашини' }, { id: 'st_1088', name: 'Пашини (навпроти)' }]
            : [],
    },
    transportRoute: {
      findMany: async ({ where }: { where: { cityCode: string; unreliable: boolean } }) =>
        where.cityCode === 'Malyn' && where.unreliable === false
          ? [
              { id: '11', shortName: '11/1', fromName: 'Паперова фабрика', toName: 'Залізничний вокзал ' },
              { id: '5', shortName: '', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
            ]
          : where.cityCode === 'Korosten' && where.unreliable === false
            ? [{ id: '2b', shortName: '2-Б', fromName: 'Мельника', toName: 'Пашини' }]
            : [],
    },
  } as unknown as PrismaClient;
  return { prisma, rows, countWhere, synonymRows };
}

async function appWith(opts: { prisma: PrismaClient; understand?: UnderstandFn | null; enabled?: boolean; cap?: number; driveTime?: DriveTimeFn; cityRoutes?: CityRoutes; guestPassword?: string }) {
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
      driveTime: opts.driveTime ?? (async ({ fixedMinutes }) => ({ minutes: fixedMinutes, source: 'fixed' })),
      ...(opts.cityRoutes ? { cityRoutes: opts.cityRoutes } : {}),
      ...(opts.guestPassword ? { access: { isPublic: () => false, password: () => opts.guestPassword ?? null } } : {}),
    }),
  );
  return listenLocal(app);
}

test('без токена адміна — 401, Claude не викликається', async () => {
  const { prisma, rows } = fakePrisma();
  let called = 0;
  const app = await listenLocal(createApp({
    prisma,
    adminPassword: PASSWORD,
    dovedeUnderstand: async () => {
      called++;
      return okResult();
    },
  }));
  const res = await request(app).post('/dovede/understand').send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 401);
  assert.equal(called, 0);
  assert.equal(rows.length, 0);
});

test('createApp без ключа: 503 з fallback local', async () => {
  const { prisma } = fakePrisma();
  const app = await listenLocal(createApp({ prisma, adminPassword: PASSWORD, dovedeUnderstand: null }));
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'no_key' });
});

test('успіх: намір, згода з місцевим розбором, рядок журналу з токенами', async () => {
  const { prisma, rows, countWhere } = fakePrisma();
  const seen: Array<{ text: string; now: unknown }> = [];
  const app = await appWith({
    prisma,
    understand: async (text, now) => {
      seen.push({ text, now });
      return okResult();
    },
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: '  з Києва на вокзал  ', local: INTENT });
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
  const app = await appWith({ prisma, understand: async () => okResult({ ...INTENT, to: { id: 'malyn.avtostantsiya', text: 'автостанція' } }) });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва на вокзал', local: INTENT });
  assert.equal(res.body.agree, false);
  assert.equal(rows[0].agree, false);
});

test('місцевий розбір з чужим id не ламає запит: id переноситься в unknown', async () => {
  const { prisma, rows } = fakePrisma();
  const app = await appWith({ prisma });
  const res = await request(app)
    .post('/dovede/understand')
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
  const app = await appWith({
    prisma,
    enabled: false,
    understand: async () => {
      called++;
      return okResult();
    },
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'disabled' });
  assert.equal(called, 0);
  assert.deepEqual(rows, [{ text: 'з Києва в Малин', localIntent: undefined, status: 'disabled' }]);
});

test('денний ліміт вичерпано: 429 cap, Claude не викликається', async () => {
  const { prisma, rows } = fakePrisma(25);
  let called = 0;
  const app = await appWith({
    prisma,
    cap: 25,
    understand: async () => {
      called++;
      return okResult();
    },
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 429);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'cap' });
  assert.equal(called, 0);
  assert.equal(rows[0].status, 'cap');
});

test('збій Claude: 503 з причиною, у журналі — виклик і помилка', async () => {
  const { prisma, rows } = fakePrisma();
  const app = await appWith({
    prisma,
    understand: async () => ({ ok: false, failure: 'timeout', message: 'Claude не відповів вчасно', model: 'claude-opus-5-5', latencyMs: 8000, promptVersion: 'dovede-understand-v1' }),
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
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
  const res = await request(await appWith({ prisma })).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { fallback: 'local', reason: 'api_error' });
});

test('порожнє й задовге питання — 400', async () => {
  const { prisma, rows } = fakePrisma();
  const app = await appWith({ prisma });
  assert.equal((await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: '   ' })).status, 400);
  assert.equal((await request(app).post('/dovede/understand').set('Authorization', AUTH).send({})).status, 400);
  assert.equal((await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'я'.repeat(301) })).status, 400);
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
  const app = await appWith({
    prisma,
    understand: async (_text, _now, stops) => {
      seen.push(stops);
      return okResult(withStop);
    },
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з поворот на коновальця на вокзал', local: withStop });
  assert.equal(res.status, 200);
  assert.equal(res.body.intent.from.id, 'st_0071');
  assert.equal(res.body.agree, true);
  assert.deepEqual(seen, [[{ id: 'st_0071', name: 'Поворот на Коновальця' }, { id: 'st_0160', name: '№5 т.3' }]]);
  assert.equal((rows[0].localIntent as TripIntent).from?.id, 'st_0071');
});

test('маршрути міста з бази: Claude отримує номер для показу й кінцеві; id маршруту проходить, чужий — відкидається', async () => {
  const { prisma, rows } = fakePrisma();
  const seen: unknown[] = [];
  const about5: TripIntent = { ...INTENT, intent: 'route', from: null, to: null, routes: ['5', '99'], confidence: 'high' };
  const app = await appWith({
    prisma,
    understand: async (_text, _now, _stops, routes) => {
      seen.push(routes);
      return okResult({ ...about5, routes: ['5'] });
    },
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'куди їде автобус №5', local: about5 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.intent.routes, ['5']);
  assert.equal(res.body.agree, true, 'чужий маршрут 99 з місцевого розбору відкинуто — розбори збіглися');
  assert.deepEqual(seen, [
    [
      { id: '11', no: '11/1', fromName: 'Паперова фабрика', toName: 'Залізничний вокзал' },
      { id: '5', no: '5', fromName: 'Лікарня', toName: 'Залізничний вокзал' },
    ],
  ]);
  assert.deepEqual((rows[0].localIntent as TripIntent).routes, ['5']);
});

function logPrisma(stored: Row[]): { prisma: PrismaClient; findArgs: Row[] } {
  const findArgs: Row[] = [];
  const base = fakePrisma(2).prisma as unknown as { dovedeQuery: Row };
  base.dovedeQuery.findMany = async (args: Row) => {
    findArgs.push(args);
    return stored;
  };
  return { prisma: base as unknown as PrismaClient, findArgs };
}

const logRow = (over: Row): Row => ({
  id: 1,
  createdAt: new Date('2026-11-13T10:00:00.000Z'),
  text: 'з Києва на вокзал',
  localIntent: INTENT,
  aiIntent: INTENT,
  agree: true,
  status: 'ok',
  aiCalled: true,
  model: 'claude-opus-5-5',
  promptVersion: 'dovede-understand-v4',
  latencyMs: 2000,
  inputTokens: 50,
  outputTokens: 80,
  cacheReadTokens: 1700,
  cacheWriteTokens: 0,
  error: null,
  ...over,
});

test('журнал: без токена адміна — 401', async () => {
  const { prisma, findArgs } = logPrisma([]);
  const res = await request(await appWith({ prisma })).get('/admin/dovede/queries');
  assert.equal(res.status, 401);
  assert.equal(findArgs.length, 0);
});

test('журнал: зведення, позначки й невпізнані слова; період рахується від київської півночі', async () => {
  const unknownIntent: TripIntent = { ...INTENT, to: null, unknown: ['Епіцентр'] };
  const { prisma, findArgs } = logPrisma([
    logRow({ id: 4, text: 'до епіцентру з вокзалу', localIntent: unknownIntent, aiIntent: { ...unknownIntent, unknown: ['епіцентр'] }, latencyMs: 4000 }),
    logRow({ id: 3, text: 'на Епіцентр', localIntent: unknownIntent, aiIntent: null, agree: null, status: 'timeout', latencyMs: 8000, error: 'timeout' }),
    logRow({ id: 2, agree: false, aiIntent: { ...INTENT, to: { id: 'malyn.tsentr', text: 'центр' } }, latencyMs: 1000 }),
    logRow({ id: 1 }),
  ]);
  const res = await request(await appWith({ prisma })).get('/admin/dovede/queries?days=7').set('Authorization', AUTH);
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  // 13.11 12:20Z → київська північ 12.11 22:00Z, мінус 6 днів
  assert.deepEqual((findArgs[0].where as { createdAt: { gte: Date } }).createdAt.gte.toISOString(), '2026-11-06T22:00:00.000Z');
  assert.equal(res.body.callsToday, 2);
  assert.equal(res.body.dailyCap, 300);
  const s = res.body.summary;
  assert.deepEqual([s.total, s.aiCalls, s.aiOk, s.aiFailed, s.agreed, s.disagreed, s.withUnknown, s.noPlace], [4, 4, 3, 1, 2, 1, 2, 2]);
  assert.equal(s.medianLatencyMs, 2000);
  assert.deepEqual(s.topUnknown, [{ word: 'епіцентр', count: 2, example: 'до епіцентру з вокзалу' }]);
  assert.deepEqual(res.body.items.map((i: { id: number; flags: string[] }) => [i.id, i.flags]), [
    [4, ['unknown', 'no_place']],
    [3, ['fail', 'unknown', 'no_place']],
    [2, ['disagree']],
    [1, []],
  ]);
});

test('журнал: only=problems і only=<позначка> фільтрують таблицю, а не зведення; невідомий days → 7', async () => {
  const { prisma } = logPrisma([logRow({ id: 2, agree: false }), logRow({ id: 1 })]);
  const app = await appWith({ prisma });
  const problems = await request(app).get('/admin/dovede/queries?only=problems&days=abc').set('Authorization', AUTH);
  assert.equal(problems.body.days, 7);
  assert.equal(problems.body.summary.total, 2);
  assert.deepEqual(problems.body.items.map((i: { id: number }) => i.id), [2]);
  const fails = await request(app).get('/admin/dovede/queries?only=fail').set('Authorization', AUTH);
  assert.equal(fails.body.matched, 0);
});

test('синоніми: лише адмін додає й видаляє; фраза нормалізується, місце має бути у словнику', async () => {
  const { prisma, synonymRows } = fakePrisma();
  const app = await appWith({ prisma });
  assert.equal((await request(app).post('/admin/dovede/synonyms').send({ phrase: 'епіцентр', placeId: 'malyn.tsentr' })).status, 401);
  assert.equal((await request(app).get('/admin/dovede/synonyms')).status, 401);

  const saved = await request(app).post('/admin/dovede/synonyms').set('Authorization', AUTH).send({ phrase: '  «Епіцентр»,  ', placeId: 'malyn.tsentr' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.phrase, 'епіцентр');
  // зупинка міста з бази теж місце; та сама фраза вдруге — міняє місце, а не додає другий рядок
  const moved = await request(app).post('/admin/dovede/synonyms').set('Authorization', AUTH).send({ phrase: 'Епіцентр', placeId: 'st_0071' });
  assert.equal(moved.body.placeId, 'st_0071');
  assert.equal(synonymRows.length, 1);

  for (const bad of [{ phrase: 'x', placeId: 'malyn.tsentr' }, { phrase: '12 34', placeId: 'malyn.tsentr' }, { phrase: 'а'.repeat(61), placeId: 'malyn.tsentr' }, { phrase: 'епіцентр', placeId: 'lm.nema-takoho' }, { phrase: 'епіцентр' }]) {
    assert.equal((await request(app).post('/admin/dovede/synonyms').set('Authorization', AUTH).send(bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal(synonymRows.length, 1);

  const list = await request(app).get('/admin/dovede/synonyms').set('Authorization', AUTH);
  assert.deepEqual(list.body.synonyms.map((x: Row) => [x.phrase, x.placeId]), [['епіцентр', 'st_0071']]);
  assert.equal((await request(app).delete('/admin/dovede/synonyms/abc').set('Authorization', AUTH)).status, 400);
  assert.equal((await request(app).delete(`/admin/dovede/synonyms/${saved.body.id}`).set('Authorization', AUTH)).status, 200);
  assert.equal(synonymRows.length, 0);
});

test('синоніми діють одразу: сторінка читає їх з /dovede/synonyms, Claude отримує з питанням', async () => {
  const { prisma } = fakePrisma();
  const seen: unknown[] = [];
  const app = await appWith({
    prisma,
    understand: async (_text, _now, _stops, _routes, synonyms) => {
      seen.push(synonyms);
      return okResult();
    },
  });
  assert.deepEqual((await request(app).get('/dovede/synonyms').set('Authorization', AUTH)).body, { synonyms: [] });
  await request(app).post('/admin/dovede/synonyms').set('Authorization', AUTH).send({ phrase: 'Епіцентр', placeId: 'malyn.tsentr' });
  // кеш скинуто записом — без очікування
  assert.deepEqual((await request(app).get('/dovede/synonyms').set('Authorization', AUTH)).body, { synonyms: [{ phrase: 'епіцентр', placeId: 'malyn.tsentr' }] });
  await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'до епіцентру' });
  assert.deepEqual(seen, [[{ phrase: 'епіцентр', placeId: 'malyn.tsentr' }]]);
  // без доступу до «Доведе» список не віддаємо
  assert.equal((await request(app).get('/dovede/synonyms')).status, 401);
});

test('час у дорозі: лише з доступом; сталий час — з маршруту в адмінці, години виїзду — за Києвом', async () => {
  const asked: Array<{ slug?: string; departAt?: string; fixed?: number }> = [];
  const prisma = {
    tripRoute: {
      findUnique: async ({ where }: { where: { slug: string } }) => {
        asked.push({ slug: where.slug });
        return where.slug === 'Malyn-Kyiv' ? { carDurationMinutes: 100 } : null;
      },
    },
  } as unknown as PrismaClient;
  const app = await appWith({
    prisma,
    driveTime: async ({ departAt, fixedMinutes }) => {
      asked.push({ departAt: departAt.toISOString(), fixed: fixedMinutes });
      return departAt.getUTCHours() === 5 ? { minutes: 112, source: 'traffic' } : { minutes: fixedMinutes, source: 'fixed' };
    },
  });
  const url = '/dovede/drive-time?from=Malyn&to=Kyiv&date=2026-11-17&times=07:00,10:30,07:00,zz';
  assert.equal((await request(app).get(url)).status, 401);

  const res = await request(app).get(url).set('Authorization', AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { fixedMinutes: 100, source: 'traffic', minutes: { '07:00': 112, '10:30': 100 } });
  // 07:00 за Києвом у листопаді = 05:00 UTC
  assert.deepEqual(asked, [
    { slug: 'Malyn-Kyiv' },
    { departAt: '2026-11-17T05:00:00.000Z', fixed: 100 },
    { departAt: '2026-11-17T08:30:00.000Z', fixed: 100 },
  ]);

  const other = await request(app).get('/dovede/drive-time?from=Kyiv&to=Zhytomyr&date=2026-11-17&times=09:00').set('Authorization', AUTH);
  assert.deepEqual(other.body, { fixedMinutes: 95, source: 'fixed', minutes: { '09:00': 95 } });
  assert.equal((await request(app).get('/dovede/drive-time?from=Malyn&to=Kyiv&date=завтра').set('Authorization', AUTH)).status, 400);
});

test('звідки забирають: лише адмін; примітки водіїв згруповано за напрямком і текстом, без імен і телефонів', async () => {
  let where: unknown;
  let select: unknown;
  const prisma = {
    viberListing: {
      findMany: async (args: { where: unknown; select: unknown }) => {
        where = args.where;
        select = args.select;
        return [
          { route: 'Malyn-Kyiv', notes: 'до  Академмістечка' },
          { route: 'Malyn-Kyiv', notes: 'До Академмістечка' },
          { route: 'Malyn-Kyiv', notes: null },
          { route: 'Kyiv-Malyn', notes: 'від Житомирської' },
        ];
      },
    },
  } as unknown as PrismaClient;
  const app = await appWith({ prisma });
  assert.equal((await request(app).get('/admin/dovede/pickups')).status, 401);

  const res = await request(app).get('/admin/dovede/pickups?days=30').set('Authorization', AUTH);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    days: 30,
    total: 4,
    routes: [
      { route: 'Malyn-Kyiv', total: 3, withNote: 2 },
      { route: 'Kyiv-Malyn', total: 1, withNote: 1 },
    ],
    notes: [
      { route: 'Malyn-Kyiv', note: 'до Академмістечка', count: 2 },
      { route: 'Kyiv-Malyn', note: 'від Житомирської', count: 1 },
    ],
  });
  assert.deepEqual(select, { route: true, notes: true });
  assert.deepEqual(where, { listingType: 'driver', createdAt: { gte: new Date('2026-10-14T12:20:00.000Z') } });
});

test('звідки забирають: чужі контакти з приміток вирізано — посилання, ніки, телефони', () => {
  assert.equal(pickupNote('Оболонь; https://t.me/some_person'), 'Оболонь');
  assert.equal(pickupNote('https://t.me/some_person'), '');
  assert.equal(pickupNote('пишіть @some_person або +380 50 123 45 67; до Цирку'), 'пишіть або; до Цирку');
  assert.equal(pickupNote('t.me/abc ; (вівторок)'), '(вівторок)');
  assert.equal(pickupNote('о 8.00 від  метро'), 'о 8.00 від метро');
  assert.equal(pickupNote(null), '');
});

test('дорога містом: лише з доступом; час за Києвом переводиться в UTC; будь-яка невдача — 200 з fallback', async () => {
  const asked: CityRouteQuery[] = [];
  const background: boolean[] = [];
  let fail = false;
  const cityRoutes = {
    find: async (q: CityRouteQuery, bg = false) => {
      asked.push(q);
      background.push(bg);
      if (fail) throw new Error('db down');
      return { ok: true, source: 'stored', city: q.city, fromLabel: 'автовокзал Житомир-1', toLabel: q.to, steps: [{ kind: 'walk', minutes: 4, meters: 300 }], minutes: 4, fetchedAt: '2026-11-17T08:00:00.000Z' };
    },
  } as unknown as CityRoutes;
  const app = await appWith({ prisma: {} as PrismaClient, cityRoutes });
  const url = '/dovede/city-route?city=Zhytomyr&from=zhytomyr.avtovokzal&to=%D0%9F%D0%BE%D0%BB%D1%8C%D0%BE%D0%B2%D0%B0&date=2026-11-18&time=09:20';
  assert.equal((await request(app).get(url)).status, 401);

  const res = await request(app).get(url).set('Authorization', AUTH);
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.deepEqual([res.body.ok, res.body.source, res.body.minutes], [true, 'stored', 4]);
  assert.deepEqual([asked[0].city, asked[0].to, asked[0].time, asked[0].departAt.toISOString()], ['Zhytomyr', 'Польова', '09:20', '2026-11-18T07:20:00.000Z']);

  // learn=1 — навчання без обліку попиту: лише з токеном адміна; гостеві прапорець нічого не дає
  assert.equal((await request(app).get(`${url}&learn=1`).set('Authorization', AUTH)).body.ok, true);
  const guestApp = await appWith({ prisma: {} as PrismaClient, cityRoutes, guestPassword: 'guest-pass' });
  assert.equal((await request(guestApp).get(`${url}&learn=1`).set('X-Dovede-Token', dovedeAccessToken('guest-pass'))).body.ok, true);
  assert.deepEqual(background, [false, true, false]);

  fail = true;
  assert.deepEqual((await request(app).get(url).set('Authorization', AUTH)).body, { ok: false, fallback: 'maps', reason: 'error' });
  for (const bad of ['city=Malyn&from=a&to=b&date=2026-11-18&time=09:20', 'city=Kyiv&from=a&to=b&date=18.11&time=09:20', 'city=Kyiv&from=a&date=2026-11-18&time=09:20', 'city=Kyiv&from=a&to=b&date=2026-11-18&time=9']) {
    assert.equal((await request(app).get(`/dovede/city-route?${bad}`).set('Authorization', AUTH)).status, 400);
  }
});

test('місто в адмінці: лише адмін; зведення, крок навчання, архів і відновлення — нічого не видаляється', async () => {
  const done: string[] = [];
  const cityRoutes = {
    stats: async () => ({ callsToday: 3, dailyCap: 150, archivedRoutes: 0, routes: [], lines: [], stops: [], demand: [] }),
    learnTick: async (n: number) => (done.push(`learn:${n}`), { asked: 2, learned: 1 }),
    archiveGoogle: async () => (done.push('archive'), { routes: 5, lines: 3, stops: 9 }),
    restoreGoogle: async () => (done.push('restore'), { routes: 5, lines: 3, stops: 9 }),
    resetDemand: async () => (done.push('reset'), { reset: 7 }),
    setFreshDays: async (n: number) => (done.push(`fresh:${n}`), n),
    setDailyCap: async (n: number | null) => (done.push(`cap:${n}`), n ?? 150),
    places: async () => [{ city: 'Kyiv', key: 'охматдит', label: 'Охматдит', routes: 5, archivedRoutes: 0, minMinutes: 31, maxMinutes: 48, archivedAt: null }],
    archivePlace: async (city: string, key: string) => (!key || key.includes('.') ? null : (done.push(`place:archive:${city}:${key}`), { city, key: key.toLowerCase(), label: key, routes: 5 })),
    restorePlace: async (city: string, key: string) => (done.push(`place:restore:${city}:${key}`), { city, key: key.toLowerCase(), routes: 5 }),
  } as unknown as CityRoutes;
  const app = await appWith({ prisma: {} as PrismaClient, cityRoutes });
  // архів одного місця: лише адмін; місто й дія перевіряються; id точки посадки — 400
  assert.equal((await request(app).get('/admin/dovede/city/places')).status, 401);
  assert.equal((await request(app).post('/admin/dovede/city/place/archive').send({ city: 'Kyiv', key: 'Охматдит', action: 'archive' })).status, 401);
  const placesRes = await request(app).get('/admin/dovede/city/places').set('Authorization', AUTH);
  assert.equal(placesRes.headers['cache-control'], 'private, no-store');
  assert.deepEqual(placesRes.body.places.map((p: { key: string; routes: number }) => [p.key, p.routes]), [['охматдит', 5]]);
  const place = (body: Record<string, unknown>) => request(app).post('/admin/dovede/city/place/archive').set('Authorization', AUTH).send(body);
  assert.deepEqual((await place({ city: 'Kyiv', key: 'Охматдит', action: 'archive' })).body, { action: 'archive', city: 'Kyiv', key: 'охматдит', label: 'Охматдит', routes: 5 });
  assert.deepEqual((await place({ city: 'Kyiv', key: 'Охматдит', action: 'restore' })).body, { action: 'restore', city: 'Kyiv', key: 'охматдит', routes: 5 });
  for (const bad of [{ city: 'Malyn', key: 'Охматдит', action: 'archive' }, { city: 'Kyiv', key: 'Охматдит', action: 'delete' }, { city: 'Kyiv', key: 'kyiv.akadem', action: 'archive' }, { city: 'Kyiv', action: 'archive' }]) {
    assert.equal((await place(bad)).status, 400);
  }
  assert.deepEqual(done.splice(0), ['place:archive:Kyiv:Охматдит', 'place:restore:Kyiv:Охматдит']);
  assert.equal((await request(app).get('/admin/dovede/city')).status, 401);
  // список міст навчання — з реєстру, лише адмінові; чуже місто — 400 з тим самим текстом, що й до реєстру
  assert.equal((await request(app).get('/admin/dovede/city/cities')).status, 401);
  assert.deepEqual((await request(app).get('/admin/dovede/city/cities').set('Authorization', AUTH)).body, { cities: [{ code: 'Kyiv', name: 'Київ', genitive: 'Києва' }, { code: 'Zhytomyr', name: 'Житомир', genitive: 'Житомира' }] });
  const badCity = await request(app).get('/admin/dovede/city/demand?city=Korosten').set('Authorization', AUTH);
  assert.equal(badCity.status, 400);
  assert.equal(badCity.body.error, 'city: Kyiv | Zhytomyr; only: unanswered');
  assert.equal((await request(app).get('/admin/dovede/city/quality?city=Malyn').set('Authorization', AUTH)).body.error, 'city: Kyiv або Zhytomyr');
  assert.equal((await request(app).post('/admin/dovede/city/archive').send({ action: 'archive' })).status, 401);
  assert.equal((await request(app).get('/admin/dovede/city').set('Authorization', AUTH)).body.callsToday, 3);
  assert.deepEqual((await request(app).post('/admin/dovede/city/learn').set('Authorization', AUTH)).body, { asked: 2, learned: 1 });
  assert.deepEqual((await request(app).post('/admin/dovede/city/archive').set('Authorization', AUTH).send({ action: 'archive' })).body, { action: 'archive', routes: 5, lines: 3, stops: 9 });
  assert.deepEqual((await request(app).post('/admin/dovede/city/archive').set('Authorization', AUTH).send({ action: 'restore' })).body, { action: 'restore', routes: 5, lines: 3, stops: 9 });
  assert.equal((await request(app).post('/admin/dovede/city/archive').set('Authorization', AUTH).send({ action: 'delete' })).status, 400);
  // лічильник попиту й строк свіжості — теж лише адмін
  assert.equal((await request(app).post('/admin/dovede/city/demand/reset')).status, 401);
  assert.equal((await request(app).put('/admin/dovede/city/settings').send({ freshDays: 14 })).status, 401);
  assert.deepEqual((await request(app).post('/admin/dovede/city/demand/reset').set('Authorization', AUTH)).body, { reset: 7 });
  assert.deepEqual((await request(app).put('/admin/dovede/city/settings').set('Authorization', AUTH).send({ freshDays: 14 })).body, { freshDays: 14 });
  for (const bad of [0, 366, 7.5, '14', null]) {
    assert.equal((await request(app).put('/admin/dovede/city/settings').set('Authorization', AUTH).send({ freshDays: bad })).status, 400);
  }
  // денний ліміт Google: число 0–5000 або null (як у змінній); разом зі строком свіжості — одним запитом
  const put = (body: unknown) => request(app).put('/admin/dovede/city/settings').set('Authorization', AUTH).send(body as object);
  assert.deepEqual((await put({ dailyCap: 1500 })).body, { dailyCap: 1500 });
  assert.deepEqual((await put({ dailyCap: null })).body, { dailyCap: 150 });
  assert.deepEqual((await put({ freshDays: 21, dailyCap: 0 })).body, { freshDays: 21, dailyCap: 0 });
  for (const bad of [-1, 5001, 2.5, '100']) assert.equal((await put({ dailyCap: bad })).status, 400);
  assert.equal((await put({})).status, 400);
  assert.equal((await request(app).put('/admin/dovede/city/settings').send({ dailyCap: 10 })).status, 401);
  assert.deepEqual(done, ['learn:5', 'archive', 'restore', 'reset', 'fresh:14', 'cap:1500', 'cap:null', 'fresh:21', 'cap:0']);
});

test('Коростень (етап 2): city=Korosten — зупинки й маршрути Коростеня, без малинських синонімів; місцевий намір з id Коростеня не відкидається', async () => {
  const { prisma, rows, synonymRows } = fakePrisma();
  synonymRows.push({ id: 1, phrase: 'епіцентр', placeId: 'st_0071' });
  const seen: Array<{ stops: unknown; routes: unknown; synonyms: unknown; city: unknown }> = [];
  const korostenIntent: TripIntent = { ...INTENT, from: { id: 'st_1087', text: 'з Пашин' }, to: { id: 'st_1079', text: 'до міськлікарні' } };
  const app = await appWith({
    prisma,
    understand: async (_text, _now, stops, routes, synonyms, city) => {
      seen.push({ stops, routes, synonyms, city });
      return { ...okResult(korostenIntent), promptVersion: 'dovede-understand-korosten-v1' };
    },
  });
  const res = await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Пашин до міськлікарні', local: korostenIntent, city: 'Korosten' });
  assert.equal(res.status, 200);
  assert.equal(res.body.intent.from.id, 'st_1087');
  assert.equal(seen[0].city, 'Korosten');
  assert.deepEqual((seen[0].stops as Array<{ id: string }>).map((s) => s.id), ['st_1079', 'st_1087', 'st_1088']);
  assert.deepEqual((seen[0].routes as Array<{ id: string; no: string }>).map((r) => [r.id, r.no]), [['2b', '2-Б']]);
  assert.deepEqual(seen[0].synonyms, []);
  assert.equal((rows[0].localIntent as TripIntent).from?.id, 'st_1087', 'місцевий намір перевірено зупинками Коростеня');
  assert.equal(rows[0].promptVersion, 'dovede-understand-korosten-v1');
  // без city — Малин, як і раніше
  await request(app).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Києва в Малин' });
  assert.equal(seen[1].city, 'Malyn');
  assert.deepEqual((seen[1].stops as Array<{ id: string }>).map((s) => s.id), ['st_0071', 'st_0160']);
});
