/**
 * «Доведе» · кампанії навчання міста (city-campaign.ts): план із заготовки, оцінка вартості, обхід у ширину,
 * бюджет (увесь і на добу), запас для людей, квота Google, помилки, оренда між контейнерами, керування з адмінки.
 * База — у памʼяті; дорога містом — заглушка (`campaignAsk`, `peekMany`, `googleBudget`).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { CampaignInputError, buildPlan, createCityCampaigns, estimateCost, expandSeeds, reserveFor, type CampaignPlan } from './city-campaign';
import { LEARN_PLACES } from './learn-places';
import { createAdminDovedeRouter } from '../routes/admin-dovede';
import { adminAuthToken, setAdminPassword } from '../middleware/require-admin';
import type { CityPeek, CityRouteAnswer, CityRouteQuery, CityRoutes, CityStep } from './city-route';
import { createDovedeSettings } from './settings';

type Row = Record<string, unknown>;

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : (a ?? null) === (b ?? null));

/** Таблиця в памʼяті: рівність, in / notIn / lt / gt / gte / not, OR; orderBy, take, distinct; createMany з унікальним ключем */
function table(unique: string[], defaults: () => Row = () => ({})) {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const c = v as { in?: unknown[]; notIn?: unknown[]; gte?: Date; gt?: number; lt?: Date | number; not?: unknown };
        if (c.in) return c.in.includes(row[k]);
        if (c.notIn) return !c.notIn.includes(row[k]);
        if (c.lt !== undefined) return row[k] != null && (row[k] as number) < (c.lt as number);
        if (c.gt !== undefined) return (row[k] as number) > c.gt;
        if (c.gte !== undefined) return row[k] != null && (row[k] as Date) >= c.gte;
        if ('not' in c) return c.not === null ? row[k] != null : row[k] !== c.not;
      }
      return same(row[k], v);
    });
  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as Row)) row[k] = ((row[k] as number) ?? 0) + (v as { increment: number }).increment;
      else if (v && typeof v === 'object' && 'decrement' in (v as Row)) row[k] = ((row[k] as number) ?? 0) - (v as { decrement: number }).decrement;
      else row[k] = v;
    }
    row.updatedAt = new Date(((row.updatedAt as Date | undefined)?.getTime() ?? 0) + 1);
    return { ...row };
  };
  const sortBy = (list: Row[], orderBy: Row | Row[] | undefined) => {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o));
    return [...list].sort((a, b) => {
      for (const [k, dir] of keys) {
        const x = a[k] instanceof Date ? (a[k] as Date).getTime() : (a[k] as number);
        const y = b[k] instanceof Date ? (b[k] as Date).getTime() : (b[k] as number);
        if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  };
  const insert = (data: Row) => {
    const row: Row = { id: ++seq, createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data };
    rows.push(row);
    return row;
  };
  const dup = (data: Row) => unique.length > 0 && rows.some((r) => unique.every((f) => same(r[f], data[f])));
  return {
    rows,
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => match(r, where)).length,
    findMany: async ({ where, take, orderBy, distinct }: { where?: Row; take?: number; orderBy?: Row | Row[]; distinct?: string[] } = {}) => {
      let list = sortBy(
        rows.filter((r) => match(r, where)),
        orderBy,
      );
      if (distinct) list = list.filter((r, i) => list.findIndex((o) => distinct.every((f) => same(o[f], r[f]))) === i);
      return list.slice(0, take ?? list.length).map((r) => ({ ...r }));
    },
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: Row | Row[] } = {}) => {
      const hit = sortBy(
        rows.filter((r) => match(r, where)),
        orderBy,
      )[0];
      return hit ? { ...hit } : null;
    },
    findUnique: async ({ where }: { where: Row }) => {
      const hit = rows.find((r) => match(r, where));
      return hit ? { ...hit } : null;
    },
    create: async ({ data }: { data: Row }) => ({ ...insert(data) }),
    createMany: async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates?: boolean }) => {
      let count = 0;
      for (const d of data) {
        if (dup(d)) {
          if (skipDuplicates) continue;
          throw new Error('unique');
        }
        insert(d);
        count++;
      }
      return { count };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => apply(rows.find((r) => match(r, where))!, data),
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    },
    groupBy: async ({ by, where }: { by: string[]; where?: Row }) => {
      const groups = new Map<string, Row & { _count: { _all: number } }>();
      for (const r of rows.filter((x) => match(x, where))) {
        const k = by.map((f) => r[f]).join('|');
        const g = groups.get(k) ?? { ...Object.fromEntries(by.map((f) => [f, r[f]])), _count: { _all: 0 } };
        g._count._all++;
        groups.set(k, g);
      }
      return [...groups.values()];
    },
  };
}

function fakeDb() {
  const dovedeCityCampaign = table([], () => ({
    status: 'running',
    waitUntil: null,
    waitReason: null,
    stopReason: null,
    asked: 0,
    ok: 0,
    fromDb: 0,
    noRoute: 0,
    failed: 0,
    places: 0,
    googleCalls: 0,
    spentDay: null,
    spentToday: 0,
    errorsInRow: 0,
    lastError: null,
    report: null,
    leaseHolder: null,
    leaseUntil: null,
    startedAt: null,
    finishedAt: null,
    archivedAt: null,
  }));
  const dovedeCityCampaignPlace = table(['campaignId', 'origin', 'dir', 'placeKey']);
  const dovedeCityCampaignAsk = table(['placeId', 'dayType', 'hour'], () => ({ status: 'queued', source: null, minutes: null, steps: null, googleCalled: false, added: 0, attempts: 0, claimedAt: null, doneAt: null, error: null }));
  const dovedeCityDemand = table(['cityCode', 'fromKey', 'toKey']);
  const dovedeCityRoute = table([]);
  const dovedeSetting = table(['key']);
  const prisma = { dovedeCityCampaign, dovedeCityCampaignPlace, dovedeCityCampaignAsk, dovedeCityDemand, dovedeCityRoute, dovedeSetting } as unknown as PrismaClient;
  return { prisma, dovedeCityCampaign, dovedeCityCampaignPlace, dovedeCityCampaignAsk, dovedeCityDemand, dovedeCityRoute };
}

const ride = (from: string, to: string, head?: string): CityStep => ({ kind: 'transit', minutes: 10, mode: 'BUS', line: '5', fromStop: from, toStop: to, ...(head ? { headsign: head } : {}) });
const ok = (steps: CityStep[], source: 'google' | 'stored' | 'own' = 'google'): CityRouteAnswer => ({ ok: true, source, city: 'Zhytomyr', fromLabel: 'a', toLabel: 'b', steps, minutes: 20, fetchedAt: '2026-11-19T10:00:00.000Z' });
const fail = (reason: 'no_route' | 'cap' | 'denied' | 'error' | 'archived' | 'disabled' | 'no_key'): CityRouteAnswer => ({ ok: false, fallback: 'maps', reason });

/** Дорога містом-заглушка: відповідь за питанням; Google «рахує» лише відповіді з `google: true` */
function stubRoutes(reply: (q: CityRouteQuery) => { answer: CityRouteAnswer; google: boolean }, peek: (q: CityRouteQuery) => CityPeek = () => 'none') {
  const budget = { calls: 0, cap: 1000, refused: 0, blocked: null as 'cap' | 'denied' | null, hasKey: true, enabled: true, lastError: null as { status: number; message: string } | null };
  const asks: CityRouteQuery[] = [];
  const routes = {
    campaignAsk: async (q: CityRouteQuery) => {
      asks.push(q);
      const r = reply(q);
      if (r.google) budget.calls++;
      return { answer: r.answer, googleCalled: r.google };
    },
    peekMany: async (qs: CityRouteQuery[]) => qs.map(peek),
    googleBudget: async () => ({ ...budget }),
  } as unknown as CityRoutes;
  return { routes, budget, asks };
}

// середа 19 листопада 2026, 12:00 за Києвом
const NOW = new Date('2026-11-19T10:00:00.000Z');

function make(reply: Parameters<typeof stubRoutes>[0], over: { peek?: (q: CityRouteQuery) => CityPeek; holder?: string; suspicious?: number } = {}) {
  const db = fakeDb();
  const stub = stubRoutes(reply, over.peek);
  let now = NOW;
  const sent: string[] = [];
  const svc = createCityCampaigns({
    prisma: db.prisma,
    cityRoutes: stub.routes,
    now: () => now,
    holder: over.holder ?? 'test',
    log: () => undefined,
    notify: async (html) => sent.push(html),
    ...(over.suspicious !== undefined ? { suspicious: async () => over.suspicious! } : {}),
  });
  return { ...db, ...stub, svc, sent, setNow: (d: Date) => (now = d), getNow: () => now };
}

const CUSTOM = { preset: 'custom', city: 'Zhytomyr', options: { places: 'Житній ринок\nОбласна лікарня', dirs: ['to' as const], extra: 'weekday@17', maxDepth: 1 }, budget: 100, dailyBudget: 100 };

async function untilIdle(svc: ReturnType<typeof make>['svc'], max = 20) {
  for (let i = 0; i < max; i++) {
    const r = await svc.tick();
    if (!r.asked) return;
  }
}

test('план: «Навчити Житомир» — список, кінцеві маршрутів, питання людей; місця на кожну точку й напрямок без повторів', async () => {
  const db = fakeDb();
  db.dovedeCityDemand.rows.push({ id: 1, cityCode: 'Zhytomyr', fromKey: 'zhytomyr.avtovokzal', toKey: 'польова 12', fromLabel: 'автовокзал', toLabel: 'Польова 12', asked: 3, answered: false });
  const { plan } = await buildPlan(db.prisma, { preset: 'learn', city: 'Zhytomyr' });
  assert.deepEqual(plan.origins, ['zhytomyr.avtovokzal']);
  assert.deepEqual(plan.dirs, ['to', 'from']);
  assert.deepEqual(plan.main, [{ dayType: 'weekday', hour: 9 }]);
  assert.deepEqual(plan.extra, [{ dayType: 'weekday', hour: 17 }]);
  assert.equal(plan.maxDepth, 2);
  assert.ok(plan.seeds.some((s) => s.via === 'terminal'));
  assert.deepEqual(plan.seeds.filter((s) => s.via === 'people'), [{ place: 'Польова 12', origin: 'zhytomyr.avtovokzal', dir: 'to', via: 'people' }]);
  const places = expandSeeds(plan);
  // питання людей — лише як питали (одна точка, один напрямок); решта — туди й назад
  assert.equal(places.filter((p) => p.place === 'Польова 12').length, 1);
  assert.equal(places.filter((p) => p.place === LEARN_PLACES.Zhytomyr[0]).length, 2);
  assert.equal(new Set(places.map((p) => `${p.origin}|${p.dir}|${p.placeKey}`)).size, places.length);
});

test('план: зміни власника й помилки', async () => {
  const db = fakeDb();
  const { plan } = await buildPlan(db.prisma, { preset: 'learn', city: 'Kyiv', options: { origins: ['kyiv.akadem'], dirs: ['from'], main: 'weekday@07,saturday@11', extra: 'weekday@07,sunday@17', maxDepth: 0 } });
  assert.deepEqual(plan.main, [
    { dayType: 'weekday', hour: 7 },
    { dayType: 'saturday', hour: 11 },
  ]);
  // додаткова година, що вже є серед основних, — один раз
  assert.deepEqual(plan.extra, [{ dayType: 'sunday', hour: 17 }]);
  assert.equal(expandSeeds(plan).length, LEARN_PLACES.Kyiv.length);

  const bad = async (input: Parameters<typeof buildPlan>[1], re: RegExp) => assert.rejects(buildPlan(db.prisma, input), (e: unknown) => e instanceof CampaignInputError && re.test(e.message));
  await bad({ preset: 'nope', city: 'Kyiv' }, /Невідома заготовка/);
  await bad({ preset: 'modes', city: 'Zhytomyr' }, /лише для: Київ/);
  await bad({ preset: 'learn', city: 'Zhytomyr', options: { origins: ['kyiv.akadem'] } }, /Точки висадки/);
  await bad({ preset: 'learn', city: 'Kyiv', options: { main: 'вівторок' } }, /Години/);
  await bad({ preset: 'learn', city: 'Kyiv', options: { maxDepth: 4 } }, /Глибина/);
  await bad({ preset: 'custom', city: 'Kyiv', options: { places: '  \n ' } }, /хоч одне місце/);
  await bad({ preset: 'unanswered', city: 'Kyiv' }, /немає місць/);
});

test('оцінка: без глибини й додаткових годин — рівно скільки треба спитати Google; глибше — від і до', () => {
  const plan = (over: Partial<CampaignPlan>): CampaignPlan => ({ city: 'Zhytomyr', origins: [], dirs: ['to'], main: [{ dayType: 'weekday', hour: 9 }], extra: [], maxDepth: 0, seeds: [], ...over });
  assert.deepEqual(estimateCost(plan({}), { places: 50, google: 30, free: 20 }), { low: 30, high: 30 });
  const deep = estimateCost(plan({ maxDepth: 2, extra: [{ dayType: 'weekday', hour: 17 }] }), { places: 50, google: 30, free: 20 });
  // 50 × 0.8 = 40 відповідей → 40 додаткових; глибше — 40 × 0.2 … 40 × 1.2 нових місць
  assert.ok(deep.low > 30 && deep.high > deep.low, JSON.stringify(deep));
  assert.equal(deep.high, 30 + 40 + Math.ceil(40 * 1.2 * 1.8 + 40 * 1.2 * 0.8 * 1.2 * 1.8));
  assert.equal(reserveFor(150), 50);
  assert.equal(reserveFor(2450), 490);
  assert.equal(reserveFor(30), 30);
});

test('оцінка: що вже є в базі — не коштує; бюджет і денна частка — пропозиція', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }), { peek: (q) => (q.to === 'Житній ринок' ? 'fresh' : 'none') });
  t.budget.calls = 100;
  t.budget.cap = 600;
  const r = await t.svc.preview({ preset: 'custom', city: 'Zhytomyr', options: { places: 'Житній ринок\nОбласна лікарня\nПольова 12', dirs: ['to'], maxDepth: 0 } });
  assert.equal(r.title, 'Свій список — Житомир');
  assert.deepEqual(
    { places: r.estimate.places, asks: r.estimate.asks, google: r.estimate.google, free: r.estimate.free, skipped: r.estimate.skipped, low: r.estimate.low, high: r.estimate.high },
    { places: 3, asks: 3, google: 2, free: 1, skipped: 0, low: 2, high: 2 },
  );
  assert.equal(r.estimate.budget, 10);
  // ліміт 600 − запас 120 = 480, половина — 240; бюджет менший — денна частка не більша за нього
  assert.equal(r.estimate.dailyBudget, 10);
  assert.equal(r.estimate.reserve, 120);
  assert.equal(r.estimate.callsToday, 100);
  assert.equal(r.plan.origins[0].label, 'автовокзал Житомир-1');
  // нічого не записано
  assert.equal(t.dovedeCityCampaign.rows.length, 0);
});

test('обхід: основна година для кожного місця, далі нові місця з відповідей, додаткові години — наприкінці; лічильники', async () => {
  const t = make((q) => {
    if (q.to === 'Житній ринок') return { answer: ok([ride('Автовокзал', 'Житній ринок', 'Площа Перемоги')]), google: true };
    if (q.to === 'Обласна лікарня') return { answer: ok([ride('Автовокзал', 'Музична школа')], 'stored'), google: false };
    return { answer: fail('no_route'), google: true };
  });
  const c = await t.svc.create(CUSTOM);
  assert.equal(c.status, 'running');
  assert.equal(c.places, 2);
  assert.equal(c.left, 2);
  await untilIdle(t.svc);

  const order = t.asks.map((q) => `${q.to}@${q.time}`);
  // рівень 0, потім рівень 1 (нові місця), і лише тоді — 17:00 для місць, що мали відповідь
  assert.deepEqual(order.slice(0, 2), ['Житній ринок@09:00', 'Обласна лікарня@09:00']);
  assert.ok(order.indexOf('Житній ринок@17:00') > order.indexOf('Площа Перемоги@09:00'));
  // місце, яке бачили вже, — не нове; глибше за maxDepth не йдемо
  const depth1 = t.dovedeCityCampaignPlace.rows.filter((p) => p.depth === 1).map((p) => p.place);
  assert.deepEqual(depth1.sort(), ['Музична школа', 'Площа Перемоги'].sort());
  const done = (await t.svc.get(c.id))!;
  assert.equal(done.status, 'done');
  assert.equal(done.stopReason, 'finished');
  assert.equal(done.left, 0);
  // 2 + 2 основних, + 17:00 для двох місць рівня 0 (на рівні 1 відповідей немає)
  assert.equal(done.asked, 6);
  assert.equal(done.ok, 4);
  assert.equal(done.fromDb, 2);
  assert.equal(done.noRoute, 2);
  assert.equal(done.googleCalls, 4);
  assert.equal(done.places, 4);
  assert.deepEqual(done.report?.byDepth, [
    { depth: 0, places: 2 },
    { depth: 1, places: 2 },
  ]);
  assert.deepEqual(done.report?.noRoute.sort(), ['Музична школа', 'Площа Перемоги'].sort());
  assert.ok(done.recent.some((r) => r.place === 'Житній ринок' && r.slot === 'weekday@17' && r.google));
});

test('бюджет: вичерпано — кампанія завершена; «додати бюджету» продовжує з того ж місця', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  const c = await t.svc.create({ ...CUSTOM, options: { ...CUSTOM.options, places: 'А1 місце\nБ2 місце\nВ3 місце', extra: '' }, budget: 2, dailyBudget: 2 });
  await untilIdle(t.svc);
  let v = (await t.svc.get(c.id))!;
  assert.equal(v.status, 'done');
  assert.equal(v.stopReason, 'budget');
  assert.equal(v.googleCalls, 2);
  assert.equal(v.left, 1);

  assert.equal(await t.svc.action(c.id, 'extend', { budget: 2 }), 'Бюджет: більше ніж уже витрачено (2) і до 20000');
  const ext = await t.svc.action(c.id, 'extend', { budget: 5, dailyBudget: 5 });
  assert.equal(typeof ext === 'object' && ext?.status, 'running');
  await untilIdle(t.svc);
  v = (await t.svc.get(c.id))!;
  assert.equal(v.stopReason, 'finished');
  assert.equal(v.googleCalls, 3);
});

test('денна частка: витрачено — чекаємо до півночі за Києвом; наступного дня — далі', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  const c = await t.svc.create({ ...CUSTOM, options: { ...CUSTOM.options, places: 'А1 місце\nБ2 місце', extra: '' }, dailyBudget: 1 });
  await t.svc.tick();
  let v = (await t.svc.get(c.id))!;
  assert.equal(v.status, 'waiting');
  assert.equal(v.waitReason, 'daily');
  assert.equal(v.waitUntil, '2026-11-19T22:01:00.000Z');
  assert.equal(v.spentToday, 1);
  // до півночі нічого не питаємо
  t.setNow(new Date('2026-11-19T21:00:00.000Z'));
  assert.deepEqual(await t.svc.tick(), { campaignId: null, asked: 0 });
  t.setNow(new Date('2026-11-19T22:05:00.000Z'));
  await t.svc.tick();
  v = (await t.svc.get(c.id))!;
  assert.equal(v.googleCalls, 2);
  assert.equal(t.asks.length, 2);
});

test('запас для людей: за день витрачено ліміт мінус запас — кампанія чекає, питання не бере', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  t.budget.cap = 150;
  t.budget.calls = 100;
  const c = await t.svc.create(CUSTOM);
  await t.svc.tick();
  const v = (await t.svc.get(c.id))!;
  assert.equal(v.status, 'waiting');
  assert.equal(v.waitReason, 'cap');
  assert.equal(t.asks.length, 0);
  assert.equal(v.left, 2);
});

test('квота Google (429): питання назад у чергу, кампанія чекає «quota»; збій тричі поспіль — пауза «errors»', async () => {
  const t = make(() => {
    t.budget.blocked = 'cap';
    return { answer: fail('cap'), google: false };
  });
  const c = await t.svc.create(CUSTOM);
  await t.svc.tick();
  const v = (await t.svc.get(c.id))!;
  assert.equal(v.status, 'waiting');
  assert.equal(v.waitReason, 'quota');
  assert.equal(v.asked, 0);
  const ask = t.dovedeCityCampaignAsk.rows[0];
  assert.equal(ask.status, 'queued');
  assert.equal(ask.attempts, 0);

  const e = make(() => ({ answer: fail('error'), google: true }));
  const c2 = await e.svc.create({ ...CUSTOM, options: { ...CUSTOM.options, places: 'А1 місце', extra: '' } });
  await e.svc.tick();
  const v2 = (await e.svc.get(c2.id))!;
  assert.equal(v2.status, 'waiting');
  assert.equal(v2.waitReason, 'errors');
  // одне питання тричі: після третьої спроби — «не вдалося»
  assert.equal(e.dovedeCityCampaignAsk.rows[0].status, 'failed');
  assert.equal(v2.failed, 1);
  assert.equal(v2.googleCalls, 3);
});

test('оренда: кампанію, яку веде інший контейнер, не беремо; після строку оренди — беремо', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  const c = await t.svc.create(CUSTOM);
  const row = t.dovedeCityCampaign.rows[0];
  row.leaseHolder = 'other';
  row.leaseUntil = new Date(NOW.getTime() + 60_000);
  assert.deepEqual(await t.svc.tick(), { campaignId: null, asked: 0 });
  t.setNow(new Date(NOW.getTime() + 3 * 60_000));
  const r = await t.svc.tick();
  assert.equal(r.campaignId, c.id);
  assert.ok(r.asked > 0);
  assert.equal(row.leaseHolder, null);
});

test('питання «в роботі» від зниклого контейнера повертається в чергу', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  const c = await t.svc.create({ ...CUSTOM, options: { ...CUSTOM.options, places: 'А1 місце', extra: '' } });
  Object.assign(t.dovedeCityCampaignAsk.rows[0], { status: 'asking', claimedAt: new Date(NOW.getTime() - 10 * 60_000) });
  await t.svc.tick();
  assert.equal((await t.svc.get(c.id))!.status, 'done');
  assert.equal(t.asks.length, 1);
});

test('керування: пауза, відновлення, скасування, сховати лише завершену', async () => {
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  const c = await t.svc.create(CUSTOM);
  const paused = await t.svc.action(c.id, 'pause');
  assert.equal(typeof paused === 'object' && paused?.status, 'paused');
  assert.deepEqual(await t.svc.tick(), { campaignId: null, asked: 0 });
  assert.equal(await t.svc.action(c.id, 'archive'), 'Сховати можна лише завершену чи скасовану кампанію');
  const resumed = await t.svc.action(c.id, 'resume');
  assert.equal(typeof resumed === 'object' && resumed?.status, 'running');
  const cancelled = await t.svc.action(c.id, 'cancel');
  assert.equal(typeof cancelled === 'object' && cancelled?.stopReason, 'cancelled');
  assert.equal(await t.svc.action(c.id, 'resume'), 'Відновити можна лише кампанію на паузі чи в очікуванні');
  const hidden = await t.svc.action(c.id, 'archive');
  assert.equal(typeof hidden, 'object');
  assert.equal((await t.svc.list()).campaigns.length, 0);
  assert.equal(await t.svc.action(999, 'pause'), null);
});

test('HTTP: лише адмін; заготовки, оцінка, запуск, список, одна кампанія, дія; помилки — 400 / 404 / 409', async () => {
  const PASSWORD = 'campaign-test';
  const AUTH = adminAuthToken(PASSWORD);
  const t = make(() => ({ answer: fail('no_route'), google: true }));
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  const settings = createDovedeSettings({ prisma: t.prisma, env: {}, now: () => NOW });
  app.use(createAdminDovedeRouter({ prisma: t.prisma, understand: null, settings, cityRoutes: {} as CityRoutes, campaigns: t.svc, driveTime: async () => ({ minutes: 95, source: 'fixed' }) }));

  assert.equal((await request(app).get('/admin/dovede/city/campaigns')).status, 401);
  assert.equal((await request(app).post('/admin/dovede/city/campaigns').send(CUSTOM)).status, 401);

  const presets = await request(app).get('/admin/dovede/city/campaigns/presets').set('Authorization', AUTH);
  assert.deepEqual(
    presets.body.presets.map((p: { id: string }) => p.id),
    ['learn', 'refill-evening', 'refill-weekend', 'refill-morning', 'refresh', 'unanswered', 'modes', 'custom'],
  );
  const zt = presets.body.presets[0].cities.find((c: { city: string }) => c.city === 'Zhytomyr');
  assert.deepEqual({ main: zt.main, extra: zt.extra, maxDepth: zt.maxDepth }, { main: 'weekday@09', extra: 'weekday@17', maxDepth: 2 });

  assert.equal((await request(app).post('/admin/dovede/city/campaigns/preview').set('Authorization', AUTH).send({ preset: 'x', city: 'Kyiv' })).status, 400);
  const pv = await request(app).post('/admin/dovede/city/campaigns/preview').set('Authorization', AUTH).send(CUSTOM);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.estimate.places, 2);

  assert.equal((await request(app).post('/admin/dovede/city/campaigns').set('Authorization', AUTH).send({ ...CUSTOM, budget: 0 })).status, 400);
  const made = await request(app).post('/admin/dovede/city/campaigns').set('Authorization', AUTH).send(CUSTOM);
  assert.equal(made.status, 201);
  const list = await request(app).get('/admin/dovede/city/campaigns').set('Authorization', AUTH);
  assert.equal(list.body.campaigns[0].id, made.body.id);
  assert.deepEqual(list.body.google, { calls: 0, cap: 1000, reserve: 200 });
  assert.equal((await request(app).get(`/admin/dovede/city/campaigns/${made.body.id}`).set('Authorization', AUTH)).body.title, 'Свій список — Житомир');
  assert.equal((await request(app).get('/admin/dovede/city/campaigns/999').set('Authorization', AUTH)).status, 404);
  assert.equal((await request(app).post(`/admin/dovede/city/campaigns/${made.body.id}/action`).set('Authorization', AUTH).send({ action: 'boom' })).status, 400);
  assert.equal((await request(app).post(`/admin/dovede/city/campaigns/${made.body.id}/action`).set('Authorization', AUTH).send({ action: 'archive' })).status, 409);
  const paused = await request(app).post(`/admin/dovede/city/campaigns/${made.body.id}/action`).set('Authorization', AUTH).send({ action: 'pause' });
  assert.equal(paused.body.status, 'paused');
});

test('«Освіжити застаріле»: лише відповіді Google, старші за строк свіжості, — на їхній тип дня й годину; без нових місць', async () => {
  const t = make(() => ({ answer: ok([ride('Автовокзал', 'Житній ринок', 'Площа Перемоги')]), google: true }));
  const old = new Date('2026-10-01T00:00:00.000Z');
  const base = { cityCode: 'Zhytomyr', source: 'google', archivedAt: null, hits: 0, fromKey: 'zhytomyr.avtovokzal', fromLabel: 'автовокзал', toKey: 'житній ринок', toLabel: 'Житній ринок' };
  t.dovedeCityRoute.rows.push(
    { id: 1, ...base, dayType: 'weekday', hour: 9, fetchedAt: old },
    { id: 2, ...base, dayType: 'saturday', hour: 17, fetchedAt: old },
    // назад, від місця до точки
    { id: 3, ...base, fromKey: 'житній ринок', fromLabel: 'Житній ринок', toKey: 'zhytomyr.avtovokzal', toLabel: 'автовокзал', dayType: 'weekday', hour: 18, fetchedAt: old },
    // свіже, в архіві, свої дані — ні
    { id: 4, ...base, toKey: 'польова 12', toLabel: 'Польова 12', dayType: 'weekday', hour: 9, fetchedAt: new Date('2026-11-18T00:00:00.000Z') },
    { id: 5, ...base, toKey: 'музична школа', toLabel: 'Музична школа', dayType: 'weekday', hour: 9, fetchedAt: old, archivedAt: old },
    { id: 6, ...base, toKey: 'кінотеатр', toLabel: 'Кінотеатр', dayType: 'weekday', hour: 9, fetchedAt: old, source: 'own' },
  );
  const pv = await t.svc.preview({ preset: 'refresh', city: 'Zhytomyr' });
  assert.deepEqual([pv.estimate.places, pv.estimate.asks, pv.estimate.maxDepth, pv.estimate.extraSlots, pv.plan.ownSlots], [2, 3, 0, 0, true]);
  await t.svc.create({ preset: 'refresh', city: 'Zhytomyr', budget: 10, dailyBudget: 10 });
  await untilIdle(t.svc);
  assert.deepEqual(t.asks.map((q) => `${q.from}→${q.to}@${q.date}T${q.time}`).sort(), [
    'zhytomyr.avtovokzal→Житній ринок@2026-11-20T09:00',
    'zhytomyr.avtovokzal→Житній ринок@2026-11-21T17:00',
    'Житній ринок→zhytomyr.avtovokzal@2026-11-20T18:00',
  ].sort());
  assert.equal(t.dovedeCityCampaignPlace.rows.length, 2);
});

test('звіт після завершення: без дороги %, відкинуті як сміття назви, підозрілі; повідомлення в адмін-чат', async () => {
  const t = make(
    (q) =>
      q.to === 'Житній ринок'
        ? { answer: ok([ride('Автовокзал', 'Супермаркет', 'Площа Перемоги'), ride('Супермаркет', 'Житній ринок', 'Кінцева')]), google: true }
        : { answer: fail('no_route'), google: true },
    { suspicious: 3 },
  );
  const c = await t.svc.create({ ...CUSTOM, options: { ...CUSTOM.options, extra: '', maxDepth: 1 } });
  await untilIdle(t.svc);
  const v = (await t.svc.get(c.id))!;
  assert.equal(v.status, 'done');
  assert.deepEqual(v.report?.filtered, [
    { name: 'Кінцева', count: 1 },
    { name: 'Супермаркет', count: 1 },
  ]);
  assert.equal(v.report?.suspicious, 3);
  assert.equal(v.report?.noRoutePct, Math.round((v.noRoute / v.asked) * 100));
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0], /🎓 <b>Навчання «Свій список — Житомир» завершено<\/b>/);
  assert.match(t.sent[0], /Підозрілих доріг у місті: 3/);
  assert.match(t.sent[0], /https:\/\/malin\.kiev\.ua\/admin\/dovede\/learning/);
});

test('Google відмовив у доступі (403): власнику пишемо один раз з текстом Google; після вдалої відповіді — знову можна', async () => {
  let deny = true;
  const t = make(() => {
    if (deny) {
      t.budget.lastError = { status: 403, message: 'Requests to this API are blocked.' };
      return { answer: fail('denied'), google: false };
    }
    return { answer: fail('no_route'), google: true };
  });
  const c = await t.svc.create({ ...CUSTOM, options: { ...CUSTOM.options, places: 'А1 місце\nБ2 місце\nВ3 місце', extra: '', maxDepth: 0 } });
  await t.svc.tick();
  assert.equal((await t.svc.get(c.id))!.waitReason, 'denied');
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0], /Google відмовив у доступі/);
  assert.match(t.sent[0], /HTTP 403\): «Requests to this API are blocked\.»/);
  // через пів години — та сама відмова: не пишемо вдруге
  t.setNow(new Date(NOW.getTime() + 31 * 60_000));
  await t.svc.tick();
  assert.equal(t.sent.length, 1);
  // Google знову відповідає — позначку скинуто, наступна відмова — нове повідомлення
  deny = false;
  t.setNow(new Date(NOW.getTime() + 62 * 60_000));
  await t.svc.tick();
  assert.equal(t.dovedeCityCampaign.rows[0].alertedReason, null);
});
