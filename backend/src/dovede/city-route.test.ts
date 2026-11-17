/**
 * «Доведе» · дорога містом: з бази без Google, від Google із записом, ліміт, архів і відновлення, фонове навчання.
 * База — у памʼяті; Google — підмінений `fetchImpl`.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { createCityRoutes, dayTypeOf, nextWeekdayMorning, normalizeKey, parseGoogleRoute, resolveCityPoint, type CityRouteQuery } from './city-route';

type Row = Record<string, unknown>;

/** Мінімальна таблиця: рівність, { in }, { gte }, { not: null }, OR; унікальний ключ — перелік полів */
function table(unique: string[]) {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const c = v as { in?: unknown[]; gte?: Date; not?: unknown };
        if (c.in) return c.in.includes(row[k]);
        if (c.gte) return (row[k] as Date) >= c.gte;
        if ('not' in c) return row[k] !== c.not && !(c.not === null && row[k] == null);
      }
      return (row[k] ?? null) === (v ?? null);
    });
  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as Row)) row[k] = ((row[k] as number) ?? 0) + ((v as { increment: number }).increment);
      else row[k] = v;
    }
    return row;
  };
  return {
    rows,
    count: async ({ where }: { where?: Row } = {}) => rows.filter((r) => match(r, where)).length,
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) => rows.filter((r) => match(r, where)).slice(0, take ?? rows.length),
    findFirst: async ({ where }: { where?: Row } = {}) => rows.find((r) => match(r, where)) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => apply(rows.find((r) => r.id === where.id)!, data),
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const key = Object.values(where)[0] as Row;
      const hit = rows.find((r) => unique.every((f) => r[f] === key[f]));
      if (hit) return apply(hit, update);
      const row: Row = { id: ++seq, hits: 0, asked: 1, seenCount: 1, answered: false, archivedAt: null, ...create };
      rows.push(row);
      return row;
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
  const dovedeCityRoute = table(['cityCode', 'fromKey', 'toKey', 'dayType', 'hour', 'source']);
  const dovedeCityLine = table(['cityCode', 'mode', 'name', 'agency']);
  const dovedeCityStop = table(['cityCode', 'name']);
  const dovedeCityDemand = table(['cityCode', 'fromKey', 'toKey']);
  const prisma = { dovedeCityRoute, dovedeCityLine, dovedeCityStop, dovedeCityDemand, $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops) } as unknown as PrismaClient;
  return { prisma, dovedeCityRoute, dovedeCityLine, dovedeCityStop, dovedeCityDemand };
}

const GOOGLE = {
  routes: [
    {
      duration: '1301s',
      legs: [
        {
          steps: [
            { travelMode: 'WALK', staticDuration: '120s', distanceMeters: 150 },
            { travelMode: 'WALK', staticDuration: '60s', distanceMeters: 80 },
            {
              travelMode: 'TRANSIT',
              staticDuration: '900s',
              transitDetails: {
                stopCount: 9,
                headway: '600s',
                headsign: 'Польова',
                stopDetails: { departureStop: { name: 'Автовокзал', location: { latLng: { latitude: 50.26, longitude: 28.69 } } }, arrivalStop: { name: 'Польова' } },
                transitLine: { nameShort: '121', color: '#00aa00', vehicle: { type: 'BUS' }, agencies: [{ name: 'ФОП Тест' }] },
              },
            },
            { travelMode: 'WALK', staticDuration: '20s', distanceMeters: 20 },
          ],
        },
      ],
    },
  ],
};

function fakeFetch(body: unknown = GOOGLE, ok = true) {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    return { ok, status: ok ? 200 : 500, json: async () => body };
  };
  return { fetchImpl, calls };
}

const NOW = new Date('2026-11-17T08:00:00.000Z');
const Q: CityRouteQuery = { city: 'Zhytomyr', from: 'zhytomyr.avtovokzal', to: 'Польова 12', date: '2026-11-18', time: '09:20', departAt: new Date('2026-11-18T07:20:00.000Z') };

function make(over: Partial<Parameters<typeof createCityRoutes>[0]> = {}, fetchBody?: unknown, ok = true) {
  const db = fakeDb();
  const net = fakeFetch(fetchBody, ok);
  let now = NOW;
  const svc = createCityRoutes({ prisma: db.prisma, key: () => 'k', fetchImpl: net.fetchImpl, now: () => now, enabled: () => true, store: () => true, dailyCap: () => 10, ownRoute: () => null, ...over });
  return { ...db, ...net, svc, setNow: (d: Date) => (now = d) };
}

test('точки: відомі id, станції метро й слова людини; чужі id і порожнє — ні', () => {
  assert.deepEqual(resolveCityPoint('Zhytomyr', 'zhytomyr.avtovokzal'), { key: 'zhytomyr.avtovokzal', label: 'автовокзал Житомир-1', address: 'Автовокзал Житомир-1, вул. Київська 93, Житомир, Україна' });
  assert.equal(resolveCityPoint('Kyiv', 'kyiv.akadem')?.address, 'станція метро Академмістечко, Київ, Україна');
  assert.deepEqual(resolveCityPoint('Zhytomyr', '  Польова  12 '), { key: 'польова 12', label: 'Польова 12', address: 'Польова  12, Житомир, Україна' });
  assert.equal(resolveCityPoint('Kyiv', 'zhytomyr.avtovokzal'), null);
  assert.equal(resolveCityPoint('Zhytomyr', 'malyn.vokzal'), null);
  assert.equal(resolveCityPoint('Zhytomyr', 'st_0004'), null);
  assert.equal(resolveCityPoint('Zhytomyr', ' '), null);
  assert.equal(normalizeKey('«Охматдит», вул.  Чорновола'), 'охматдит вул чорновола');
  assert.deepEqual([dayTypeOf('2026-11-18'), dayTypeOf('2026-11-21'), dayTypeOf('2026-11-22')], ['weekday', 'saturday', 'sunday']);
});

test('розбір відповіді Google: сусідня піша зливається, дрібна відкидається, транспорт — з номером і зупинками', () => {
  const p = parseGoogleRoute(GOOGLE)!;
  assert.equal(p.minutes, 22);
  assert.deepEqual(p.steps, [
    { kind: 'walk', minutes: 3, meters: 230 },
    { kind: 'transit', minutes: 15, mode: 'BUS', line: '121', agency: 'ФОП Тест', color: '#00aa00', headsign: 'Польова', fromStop: 'Автовокзал', toStop: 'Польова', stops: 9, headwayMin: 10 },
  ]);
  assert.deepEqual(p.stops.map((s) => s.name), ['Автовокзал', 'Польова']);
  assert.equal(parseGoogleRoute({ routes: [] }), null);
  assert.equal(parseGoogleRoute({ routes: [{ duration: '90000s', legs: [{ steps: [{ travelMode: 'WALK', staticDuration: '90000s', distanceMeters: 9 }] }] }] }), null);
});

test('перший запит — від Google і в базу: маршрут, лінія, зупинки, попит; другий — з бази без Google', async () => {
  const t = make();
  const first = await t.svc.find(Q);
  assert.equal(first.ok && first.source, 'google');
  assert.equal(t.calls.length, 1);
  assert.deepEqual([t.calls[0].travelMode, (t.calls[0].destination as { address: string }).address, t.calls[0].departureTime], ['TRANSIT', 'Польова 12, Житомир, Україна', '2026-11-18T07:20:00.000Z']);
  assert.equal(t.dovedeCityRoute.rows.length, 1);
  assert.deepEqual([t.dovedeCityRoute.rows[0].fromKey, t.dovedeCityRoute.rows[0].toKey, t.dovedeCityRoute.rows[0].dayType, t.dovedeCityRoute.rows[0].hour, t.dovedeCityRoute.rows[0].source], ['zhytomyr.avtovokzal', 'польова 12', 'weekday', 9, 'google']);
  assert.deepEqual(t.dovedeCityLine.rows.map((r) => [r.mode, r.name, r.agency]), [['BUS', '121', 'ФОП Тест']]);
  assert.deepEqual(t.dovedeCityStop.rows.map((r) => [r.name, r.lat]), [['Автовокзал', 50.26], ['Польова', null]]);

  // та сама пара, інший будень, сусідня година — вже наші дані
  const second = await t.svc.find({ ...Q, date: '2026-11-19', time: '10:05' });
  assert.equal(second.ok && second.source, 'stored');
  assert.equal(t.calls.length, 1);
  assert.equal(t.dovedeCityRoute.rows[0].hits, 1);
  assert.deepEqual([t.dovedeCityDemand.rows[0].asked, t.dovedeCityDemand.rows[0].answered], [2, true]);

  // субота й далека година — це інше питання
  assert.equal((await t.svc.find({ ...Q, date: '2026-11-21' })).ok, true);
  assert.equal((await t.svc.find({ ...Q, time: '18:00' })).ok, true);
  assert.equal(t.calls.length, 3);
});

test('відповідь старша 30 днів — питаємо Google знову й оновлюємо той самий рядок', async () => {
  const t = make();
  await t.svc.find(Q);
  t.setNow(new Date(NOW.getTime() + 31 * 24 * 3600_000));
  const again = await t.svc.find({ ...Q, date: '2026-12-18', departAt: new Date('2026-12-18T07:20:00.000Z') });
  assert.equal(again.ok && again.source, 'google');
  assert.equal(t.calls.length, 2);
  assert.equal(t.dovedeCityRoute.rows.length, 1);
});

test('запис вимкнено — відповідаємо, але в базу не пишемо', async () => {
  const t = make({ store: () => false });
  assert.equal((await t.svc.find(Q)).ok, true);
  assert.equal(t.dovedeCityRoute.rows.length + t.dovedeCityLine.rows.length + t.dovedeCityStop.rows.length, 0);
});

test('будь-яка невдача — fallback maps з причиною; попит записано як «без відповіді»', async () => {
  assert.deepEqual(await make({ enabled: () => false }).svc.find(Q), { ok: false, fallback: 'maps', reason: 'disabled' });
  assert.deepEqual(await make({ key: () => null }).svc.find(Q), { ok: false, fallback: 'maps', reason: 'no_key' });
  assert.deepEqual(await make({ dailyCap: () => 0 }).svc.find(Q), { ok: false, fallback: 'maps', reason: 'cap' });
  assert.deepEqual(await make({}, GOOGLE, false).svc.find(Q), { ok: false, fallback: 'maps', reason: 'error' });
  const empty = make({}, { routes: [] });
  assert.deepEqual(await empty.svc.find(Q), { ok: false, fallback: 'maps', reason: 'no_route' });
  assert.deepEqual([empty.dovedeCityDemand.rows[0].asked, empty.dovedeCityDemand.rows[0].answered], [1, false]);
  assert.deepEqual(await make().svc.find({ ...Q, to: 'zhytomyr.avtovokzal' }), { ok: false, fallback: 'maps', reason: 'no_route' });
});

test('денний ліміт рахується за записаними сьогодні відповідями', async () => {
  const t = make({ dailyCap: () => 2 });
  assert.equal((await t.svc.find(Q)).ok, true);
  assert.equal((await t.svc.find({ ...Q, to: 'Житній ринок' })).ok, true);
  assert.deepEqual(await t.svc.find({ ...Q, to: 'Корбутівка' }), { ok: false, fallback: 'maps', reason: 'cap' });
});

test('архів: нічого не видаляється; заархівоване не віддається; відновлення повертає; власні дані не зачеплено', async () => {
  const t = make();
  await t.svc.find(Q);
  await t.dovedeCityRoute.upsert({
    where: { k: { cityCode: 'Zhytomyr', fromKey: 'a', toKey: 'b', dayType: 'weekday', hour: 9, source: 'own' } },
    create: { cityCode: 'Zhytomyr', fromKey: 'a', toKey: 'b', fromLabel: 'А', toLabel: 'Б', dayType: 'weekday', hour: 9, steps: [], minutes: 5, source: 'own', fetchedAt: NOW },
    update: {},
  });
  assert.deepEqual(await t.svc.archiveGoogle(), { routes: 1, lines: 1, stops: 2 });
  assert.equal(t.dovedeCityRoute.rows.length, 2);
  assert.equal(t.dovedeCityRoute.rows.find((r) => r.source === 'own')!.archivedAt, null);

  // заархівоване не віддається: людина питає → Google → той самий рядок оживає
  const stats = await t.svc.stats();
  assert.equal(stats.archivedRoutes, 1);
  assert.deepEqual(stats.routes, [{ city: 'Zhytomyr', source: 'own', count: 1 }]);

  assert.deepEqual(await t.svc.restoreGoogle(), { routes: 1, lines: 1, stops: 2 });
  const back = await t.svc.find(Q);
  assert.equal(back.ok && back.source, 'stored');
  assert.equal(t.calls.length, 1);
});

test('навчання у фоні: стартові пари, не більше batch, лише до половини денного ліміту; попит людей не накручує', async () => {
  const t = make({ dailyCap: () => 4 });
  assert.deepEqual(await t.svc.learnTick(3), { asked: 2, learned: 2 });
  assert.equal(t.calls.length, 2);
  assert.equal(t.dovedeCityDemand.rows.length, 0);
  // те, що вже вивчено чи заархівовано, навчання не чіпає
  await t.svc.archiveGoogle();
  const again = make({ dailyCap: () => 100 });
  await again.svc.learnTick(2);
  await again.svc.archiveGoogle();
  const before = again.calls.length;
  await again.svc.learnTick(2);
  assert.equal(again.dovedeCityRoute.rows.filter((r) => r.archivedAt != null).length, 2);
  assert.equal(again.calls.length, before + 2);
  assert.equal(new Set(again.dovedeCityRoute.rows.map((r) => r.toKey)).size, 4);
});

test('навчання вимкнено без ключа чи без запису; найближчий будень о 09:00', async () => {
  assert.deepEqual(await make({ key: () => null }).svc.learnTick(), { asked: 0, learned: 0 });
  assert.deepEqual(await make({ store: () => false }).svc.learnTick(), { asked: 0, learned: 0 });
  // пʼятниця → понеділок
  assert.equal(nextWeekdayMorning(new Date('2026-11-20T10:00:00.000Z')).date, '2026-11-23');
});

test('Житомир: власна пряма поїздка — перед базою й Google, без запитів назовні; Київ її не питає; вимикач', async () => {
  const own = { ok: true as const, source: 'own' as const, city: 'Zhytomyr' as const, fromLabel: 'a', toLabel: 'b', steps: [{ kind: 'transit' as const, minutes: 9, line: '58', departs: '09:25' }], minutes: 14, fetchedAt: '2026-11-17T00:00:00.000Z' };
  const asked: unknown[] = [];
  const t = make({ ownRoute: (q, labels) => (asked.push([q, labels]), own), ownEnabled: () => true });
  const got = await t.svc.find(Q);
  assert.deepEqual(got, own);
  assert.deepEqual(asked, [[{ from: 'zhytomyr.avtovokzal', to: 'Польова 12', date: Q.date, time: Q.time }, { from: 'автовокзал Житомир-1', to: 'Польова 12' }]]);
  assert.equal(t.calls.length, 0);
  assert.equal(t.dovedeCityRoute.rows.length, 0);
  // попит усе одно рахуємо: людина спитала й отримала відповідь
  assert.deepEqual(t.dovedeCityDemand.rows.map((r) => [r.asked, r.answered]), [[1, true]]);

  await t.svc.find({ ...Q, city: 'Kyiv', from: 'kyiv.akadem', to: 'Охматдит' });
  assert.equal(asked.length, 1);
  assert.equal(t.calls.length, 1);

  // типово вимкнено: розклад сайту давній, відповідає Google
  const off = make({ ownRoute: () => own });
  assert.equal(((await off.svc.find(Q)) as { source?: string }).source, 'google');
});
