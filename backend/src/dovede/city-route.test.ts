/**
 * «Доведе» · дорога містом: з бази без Google, від Google із записом, ліміт, архів і відновлення, фонове навчання.
 * База — у памʼяті; Google — підмінений `fetchImpl`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { MODE_PAIRS, SEED_PAIRS, createCityRoutes, dayTypeOf, nextSlot, nextWeekdayMorning, normalizeKey, parseGoogleRoute, refreshLeadDays, resolveCityPoint, storedPoint, type CityRouteQuery } from './city-route';

type Row = Record<string, unknown>;

/** Мінімальна таблиця: рівність, { in }, { gte }, { gt }, { lt }, { not: null }, OR; унікальний ключ — перелік полів */
function table(unique: string[]) {
  const rows: Row[] = [];
  let seq = 0;
  const match = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k === 'OR') return (v as Row[]).some((w) => match(row, w));
      if (v && typeof v === 'object' && !(v instanceof Date)) {
        const c = v as { in?: unknown[]; gte?: Date; gt?: number; lt?: Date; not?: unknown };
        if (c.lt) return row[k] != null && (row[k] as Date) < c.lt;
        if (c.in) return c.in.includes(row[k]);
        if (c.gt !== undefined) return (row[k] as number) > c.gt;
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
    findUnique: async ({ where }: { where: Row }) => rows.find((r) => match(r, where)) ?? null,
    update: async ({ where, data }: { where: Row; data: Row }) => apply(rows.find((r) => r.id === where.id)!, data),
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      const hit = rows.filter((r) => match(r, where));
      hit.forEach((r) => apply(r, data));
      return { count: hit.length };
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      // складений ключ — { назва: { поля } }; простий — { id: 1 }
      const first = Object.values(where)[0];
      const key = (first && typeof first === 'object' ? first : where) as Row;
      const hit = rows.find((r) => unique.every((f) => r[f] === key[f]));
      if (hit) return apply(hit, update);
      const row: Row = { id: ++seq, hits: 0, asked: 1, seenCount: 1, answered: false, archivedAt: null, refreshFailedAt: null, ...create };
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
  const dovedeCitySettings = table(['id']);
  const dovedeCityPlace = table(['cityCode', 'key']);
  const dovedeCityGoogleDay = table(['day']);
  const prisma = { dovedeCityRoute, dovedeCityLine, dovedeCityStop, dovedeCityDemand, dovedeCitySettings, dovedeCityPlace, dovedeCityGoogleDay, $transaction: async (ops: Array<Promise<unknown>>) => Promise.all(ops) } as unknown as PrismaClient;
  return { prisma, dovedeCityRoute, dovedeCityLine, dovedeCityStop, dovedeCityDemand, dovedeCitySettings, dovedeCityPlace, dovedeCityGoogleDay };
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

function fakeFetch(body: unknown = GOOGLE, ok = true, status = ok ? 200 : 500) {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body));
    return { ok, status, json: async () => body };
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

test('строк свіжості з адмінки: 7 днів — на восьмий питаємо Google знову; 90 — на тридцять перший ще з бази; межі 1–365', async () => {
  const short = make();
  assert.equal((await short.svc.stats()).freshDays, 30);
  assert.equal(await short.svc.setFreshDays(7), 7);
  assert.deepEqual([(await short.svc.stats()).freshDays, (await short.svc.stats()).freshDaysDefault], [7, 30]);
  await short.svc.find(Q);
  short.setNow(new Date(NOW.getTime() + 8 * 24 * 3600_000));
  const again = await short.svc.find({ ...Q, date: '2026-11-25', departAt: new Date('2026-11-25T07:20:00.000Z') });
  assert.equal(again.ok && again.source, 'google');

  const long = make();
  await long.svc.setFreshDays(90);
  await long.svc.find(Q);
  long.setNow(new Date(NOW.getTime() + 31 * 24 * 3600_000));
  const kept = await long.svc.find({ ...Q, date: '2026-12-18', departAt: new Date('2026-12-18T07:20:00.000Z') });
  assert.equal(kept.ok && kept.source, 'stored');
  assert.equal(long.calls.length, 1);
  // значення лежить у базі одним рядком — інший екземпляр сервера його бачить
  assert.deepEqual(long.dovedeCitySettings.rows.map((r) => [r.id, r.freshDays]), [[1, 90]]);
  assert.equal((await createCityRoutes({ prisma: long.prisma, key: () => 'k', now: () => NOW }).stats()).freshDays, 90);

  for (const bad of [0, 366, 2.5, Number.NaN]) await assert.rejects(long.svc.setFreshDays(bad), RangeError);
  // сміття в базі не ламає відповіді: діє типове
  long.dovedeCitySettings.rows[0].freshDays = 0;
  assert.equal((await createCityRoutes({ prisma: long.prisma, key: () => 'k', now: () => NOW }).stats()).freshDays, 30);
});

test('скидання лічильника попиту: рядки лишаються з asked = 0, їх немає в списку й у навчанні; нове питання людини рахується з 1', async () => {
  const t = make({ dailyCap: () => 100 });
  await t.svc.find(Q);
  await t.svc.find(Q);
  assert.deepEqual((await t.svc.stats()).demand.map((d) => d.asked), [2]);
  assert.deepEqual(await t.svc.resetDemand(), { reset: 1 });
  assert.deepEqual(t.dovedeCityDemand.rows.map((r) => r.asked), [0]);
  assert.deepEqual((await t.svc.stats()).demand, []);
  assert.deepEqual(await t.svc.resetDemand(), { reset: 0 });
  // збережена дорога на місці: людина й далі отримує її з бази
  assert.equal(t.dovedeCityRoute.rows.length, 1);
  const again = await t.svc.find(Q);
  assert.equal(again.ok && again.source, 'stored');
  assert.deepEqual((await t.svc.stats()).demand.map((d) => d.asked), [1]);

  // навчання (`learn=1`): попит не росте, але пара людини, на яку знайшлась дорога, більше не «без відповіді»
  const u = make({ dailyCap: () => 100 }, GOOGLE, false);
  await u.svc.find(Q);
  assert.deepEqual((await u.svc.stats()).unanswered, [{ city: 'Zhytomyr', fromKey: 'zhytomyr.avtovokzal', toKey: 'польова 12', from: 'автовокзал Житомир-1', to: 'Польова 12', asked: 1 }]);
  const fixed = createCityRoutes({ prisma: u.prisma, key: () => 'k', fetchImpl: fakeFetch().fetchImpl, now: () => NOW, enabled: () => true, store: () => true, dailyCap: () => 100, ownRoute: () => null });
  const learned = await fixed.find(Q, true);
  assert.equal(learned.ok && learned.source, 'google');
  assert.deepEqual(u.dovedeCityDemand.rows.map((r) => [r.asked, r.answered]), [[1, true]]);
  assert.deepEqual((await fixed.stats()).unanswered, []);
  assert.equal(u.dovedeCityRoute.rows[0].hits, 0);
  // пари, якої люди не питали, навчання в попит не додає
  await fixed.find({ ...Q, to: 'Богунія' }, true);
  assert.equal(u.dovedeCityDemand.rows.length, 1);

  // навчання: обнулена пара без свіжої відповіді в чергу не йде — лише стартовий набір
  const l = make({ dailyCap: () => 100 });
  await l.svc.find({ ...Q, to: 'Корбутівка' });
  await l.svc.resetDemand();
  l.dovedeCityRoute.rows.length = 0;
  await l.svc.learnTick(1);
  assert.notEqual(l.dovedeCityRoute.rows[0]?.toKey, 'корбутівка');
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

test('архів одного місця: його дороги в архіві, Google про нього не питаємо; інші місця й повернення працюють', async () => {
  const t = make();
  await t.svc.find(Q);
  await t.svc.find({ ...Q, time: '17:10' });
  await t.svc.find({ ...Q, from: 'Польова 12', to: 'zhytomyr.avtovokzal' });
  await t.svc.find({ ...Q, to: 'Житній ринок' });
  assert.equal(t.calls.length, 4);

  // список місць: слова людини, без наших точок; хвилини — щоб побачити підозріло коротку дорогу
  assert.deepEqual(await t.svc.places(), [
    { city: 'Zhytomyr', key: 'житній ринок', label: 'Житній ринок', routes: 1, archivedRoutes: 0, minMinutes: 22, maxMinutes: 22, archivedAt: null },
    { city: 'Zhytomyr', key: 'польова 12', label: 'Польова 12', routes: 3, archivedRoutes: 0, minMinutes: 22, maxMinutes: 22, archivedAt: null },
  ]);

  // точку посадки й порожнє архівувати не можна
  assert.equal(await t.svc.archivePlace('Zhytomyr', 'zhytomyr.avtovokzal'), null);
  assert.equal(await t.svc.archivePlace('Zhytomyr', ' '), null);
  assert.deepEqual(await t.svc.archivePlace('Zhytomyr', ' «Польова  12» '), { city: 'Zhytomyr', key: 'польова 12', label: 'Польова 12', routes: 3 });
  assert.equal(t.dovedeCityRoute.rows.length, 4);
  assert.equal(t.dovedeCityRoute.rows.filter((r) => r.archivedAt != null).length, 3);

  // людина питає про це місце (в обидва боки, будь-якими літерами) — ні збереженого, ні Google, ні рядка попиту
  const demand = t.dovedeCityDemand.rows.map((r) => r.asked).join();
  assert.deepEqual(await t.svc.find(Q), { ok: false, fallback: 'maps', reason: 'archived' });
  assert.deepEqual(await t.svc.find({ ...Q, to: 'ПОЛЬОВА 12', time: '13:00' }), { ok: false, fallback: 'maps', reason: 'archived' });
  assert.deepEqual(await t.svc.find({ ...Q, from: 'Польова 12', to: 'zhytomyr.avtovokzal' }), { ok: false, fallback: 'maps', reason: 'archived' });
  assert.equal(t.calls.length, 4);
  assert.equal(t.dovedeCityDemand.rows.map((r) => r.asked).join(), demand);
  // сусіднє місце відповідає з бази, як і раніше
  const other = await t.svc.find({ ...Q, to: 'Житній ринок' });
  assert.equal(other.ok && other.source, 'stored');

  const listed = await t.svc.places();
  assert.deepEqual(listed.map((p) => [p.key, p.routes, p.archivedRoutes, p.archivedAt]), [['житній ринок', 1, 0, null], ['польова 12', 0, 3, NOW.toISOString()]]);
  // загальне зведення цих доріг уже не рахує
  assert.deepEqual((await t.svc.stats()).routes, [{ city: 'Zhytomyr', source: 'google', count: 1 }]);

  // повернення: рядок місця лишається (без позначки), дороги знову віддаються з бази
  assert.deepEqual(await t.svc.restorePlace('Zhytomyr', 'польова 12'), { city: 'Zhytomyr', key: 'польова 12', routes: 3 });
  assert.deepEqual(t.dovedeCityPlace.rows.map((r) => [r.key, r.archivedAt]), [['польова 12', null]]);
  const back = await t.svc.find(Q);
  assert.equal(back.ok && back.source, 'stored');
  assert.equal(t.calls.length, 4);
});

test('загальне «відновити з архіву» не повертає місце, яке власник прибрав окремо', async () => {
  const t = make();
  await t.svc.find(Q);
  await t.svc.find({ ...Q, to: 'Житній ринок' });
  await t.svc.archivePlace('Zhytomyr', 'Польова 12');
  assert.equal((await t.svc.archiveGoogle()).routes, 1);
  // з двох рядків в архіві повертається один: дорога до прибраного місця лишається там
  assert.equal((await t.svc.restoreGoogle()).routes, 1);
  assert.deepEqual(t.dovedeCityRoute.rows.map((r) => [r.toKey, r.archivedAt != null]), [['польова 12', true], ['житній ринок', false]]);
  assert.deepEqual(await t.svc.find(Q), { ok: false, fallback: 'maps', reason: 'archived' });
});

test('архів місця й навчання: пару з таким місцем навчання пропускає, Google не питає й решту кроку не зупиняє', async () => {
  const t = make({ dailyCap: () => 100 });
  // місця ще ніхто не питав — архівувати наперед теж можна
  assert.deepEqual(await t.svc.archivePlace('Zhytomyr', 'Залізничний вокзал'), { city: 'Zhytomyr', key: 'залізничний вокзал', label: 'Залізничний вокзал', routes: 0 });
  const tick = await t.svc.learnTick(2);
  assert.deepEqual(tick, { asked: 2, learned: 2 });
  assert.equal(t.dovedeCityRoute.rows.some((r) => r.toKey === 'залізничний вокзал'), false);
  assert.equal(t.calls.length, 2);
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

test('навчання оновлює відповіді, що ось-ось застаріють: той самий тип дня й година, слова людини; свіжих не чіпає', async () => {
  const DAY = 24 * 3600_000;
  const t = make({ dailyCap: () => 1000 });
  // людина спитала на суботу, 14:20
  await t.svc.find({ ...Q, date: '2026-11-21', time: '14:20', departAt: new Date('2026-11-21T12:20:00.000Z') });
  const row = t.dovedeCityRoute.rows[0];
  assert.deepEqual([row.dayType, row.hour, row.toLabel, row.hits], ['saturday', 14, 'Польова 12', 0]);
  // стартовий набір вивчено — далі навчанню лишається тільки оновлення
  await t.svc.learnTick(500);
  const rows = t.dovedeCityRoute.rows.length;
  const before = t.calls.length;

  // 27 днів: до кінця строку (30) ще три дні — рано
  t.setNow(new Date(NOW.getTime() + 27 * DAY));
  assert.deepEqual(await t.svc.learnTick(1), { asked: 0, learned: 0 });
  // 29 днів: лишилося менше двох — оновлюємо, не чекаючи, поки людина натрапить на застарілу
  t.setNow(new Date(NOW.getTime() + 29 * DAY));
  assert.deepEqual(await t.svc.learnTick(1), { asked: 1, learned: 1 });
  assert.equal(t.calls.length, before + 1);
  const call = t.calls[t.calls.length - 1] as { destination: { address: string }; departureTime: string };
  // 16 грудня — середа; найближча субота 19-го, 14:00 за Києвом = 12:00 UTC
  assert.deepEqual([call.destination.address, call.departureTime], ['Польова 12, Житомир, Україна', '2026-12-19T12:00:00.000Z']);
  assert.equal(t.dovedeCityRoute.rows.length, rows);
  assert.deepEqual([row.dayType, row.hour, row.toLabel, row.hits, (row.fetchedAt as Date).getTime()], ['saturday', 14, 'Польова 12', 0, NOW.getTime() + 29 * DAY]);
  // попит людей оновлення не накручує
  assert.deepEqual(t.dovedeCityDemand.rows.map((r) => r.asked), [1]);

  // вимикач, архів і половина денного ліміту
  assert.deepEqual(await createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: t.fetchImpl, now: () => new Date(NOW.getTime() + 29 * DAY), ownRoute: () => null, refresh: () => false }).learnTick(3), { asked: 0, learned: 0 });
  const capped = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: t.fetchImpl, now: () => new Date(NOW.getTime() + 29 * DAY), ownRoute: () => null, dailyCap: () => 4 });
  // сьогодні вже є одна відповідь; половина від 4 — це 2, тож ще одна
  assert.deepEqual(await capped.learnTick(5), { asked: 1, learned: 1 });
  const stale = (await t.svc.stats()).staleRoutes;
  assert.equal(stale, 0); // застарілих за 30 днів ще немає: оновлення йде на випередження
  await t.svc.archiveGoogle();
  assert.deepEqual(await t.svc.learnTick(3), { asked: 0, learned: 0 });
});

test('невдале оновлення: рядок позначено й тиждень не чіпаємо; далі — наступний; власні дані Google не питають', async () => {
  const DAY = 24 * 3600_000;
  const t = make({ dailyCap: () => 1000 });
  await t.svc.find(Q);
  await t.svc.find({ ...Q, to: 'Корбутівка' });
  // без попиту людей: інакше навчання спершу бралося б за ці пари як за найзапитуваніші
  await t.svc.resetDemand();
  const later = new Date(NOW.getTime() + 31 * DAY);
  // стартові пари на цей момент свіжі — щоб навчання їх не питало
  for (const r of t.dovedeCityRoute.rows) r.fetchedAt = NOW;
  const seeded = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: t.fetchImpl, now: () => later, ownRoute: () => null, dailyCap: () => 1000 });
  await seeded.learnTick(500);
  const [first, second] = t.dovedeCityRoute.rows;
  first.fetchedAt = NOW;
  second.fetchedAt = NOW;
  assert.deepEqual([(await seeded.stats()).staleRoutes, (await seeded.stats()).refresh], [2, true]);

  const down = fakeFetch({ routes: [] });
  const failing = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: down.fetchImpl, now: () => later, ownRoute: () => null, dailyCap: () => 1000 });
  assert.deepEqual(await failing.learnTick(1), { asked: 1, learned: 0 });
  assert.deepEqual([first.refreshFailedAt, second.refreshFailedAt], [later, null]);
  assert.equal((first.fetchedAt as Date).getTime(), NOW.getTime()); // застаріле свіжим не стало
  // наступний крок бере інший рядок, а не той самий
  assert.deepEqual(await failing.learnTick(1), { asked: 1, learned: 0 });
  assert.deepEqual((down.calls as Array<{ destination: { address: string } }>).map((c) => c.destination.address), ['Польова 12, Житомир, Україна', 'Корбутівка, Житомир, Україна']);
  assert.deepEqual(await failing.learnTick(1), { asked: 0, learned: 0 });
  // за тиждень — ще одна спроба; вдала знімає позначку
  first.refreshFailedAt = new Date(later.getTime() - 8 * DAY);
  assert.deepEqual(await seeded.learnTick(1), { asked: 1, learned: 1 });
  assert.deepEqual([first.refreshFailedAt, (first.fetchedAt as Date).getTime()], [null, later.getTime()]);

  // пару тепер закривають власні дані: Google не питаємо, рядок відкладаємо
  second.refreshFailedAt = null;
  const callsBefore = t.calls.length;
  const own = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: t.fetchImpl, now: () => later, dailyCap: () => 1000, ownRoute: () => ({ ok: true, source: 'own', city: 'Zhytomyr', fromLabel: 'a', toLabel: 'b', steps: [], minutes: 9, fetchedAt: later.toISOString() }) });
  assert.deepEqual(await own.learnTick(1), { asked: 0, learned: 0 });
  assert.equal(t.calls.length, callsBefore);
  assert.deepEqual(second.refreshFailedAt, later);
});

test('навчання не довбає те саме: пару людей без відповіді й стартову пару, де Google не знайшов дороги, — раз на тиждень', async () => {
  const DAY = 24 * 3600_000;
  const t = make({ dailyCap: () => 1000 }, { routes: [] });
  await t.svc.find(Q); // людина спитала, Google дороги не знайшов
  assert.deepEqual(t.dovedeCityDemand.rows.map((r) => [r.answered, r.learnFailedAt ?? null]), [[false, null]]);
  // крок навчання: спершу пара людини, потім дві стартові — усі три без успіху
  assert.deepEqual(await t.svc.learnTick(3), { asked: 3, learned: 0 });
  const tried = (t.calls as Array<{ destination: { address: string } }>).map((c) => c.destination.address);
  assert.equal(tried[1], 'Польова 12, Житомир, Україна');
  assert.deepEqual(t.dovedeCityDemand.rows[0].learnFailedAt, NOW);
  // наступний крок бере інші пари, а не ті самі три
  await t.svc.learnTick(3);
  const next = (t.calls as Array<{ destination: { address: string } }>).map((c) => c.destination.address).slice(4);
  assert.equal(next.length, 3);
  assert.equal(next.filter((a) => tried.includes(a)).length, 0);
  // за тиждень — знову з пари людини
  t.setNow(new Date(NOW.getTime() + 8 * DAY));
  const before = t.calls.length;
  await t.svc.learnTick(1);
  assert.equal((t.calls[before] as { destination: { address: string } }).destination.address, 'Польова 12, Житомир, Україна');
  // ліміт — не «невдача пари»: позначок не ставимо
  const capped = make({ dailyCap: () => 0 });
  await capped.svc.find(Q);
  assert.deepEqual(await capped.svc.learnTick(3), { asked: 0, learned: 0 });
  assert.equal(capped.dovedeCityDemand.rows[0].learnFailedAt ?? null, null);
});

test('квота Google (429) і збій — не вина пари: «ліміт» без позначок, крок навчання спиняється, 10 хв Google не чіпаємо', async () => {
  const DAY = 24 * 3600_000;
  const quota = fakeFetch({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'ComputeRoutes requests' and limit\n 'ComputeRoutes requests per day'" } }, false, 429);
  const db = fakeDb();
  let at = NOW;
  const svc = createCityRoutes({ prisma: db.prisma, key: () => 'k', fetchImpl: quota.fetchImpl, now: () => at, enabled: () => true, store: () => true, dailyCap: () => 100, ownRoute: () => null });
  assert.equal((await svc.stats()).googleError, null);
  // людині — «ліміт», як і при нашому денному: сторінка покаже кнопку Google Maps
  assert.deepEqual(await svc.find(Q), { ok: false, fallback: 'maps', reason: 'cap' });
  assert.equal(quota.calls.length, 1);
  assert.deepEqual((await svc.stats()).googleError, { at: NOW.toISOString(), status: 429, message: "Quota exceeded for quota metric 'ComputeRoutes requests' and limit 'ComputeRoutes requests per day'" });
  // десять хвилин не питаємо взагалі — ні для людей, ні в навчанні; наш лічильник ці спроби не їдять
  assert.deepEqual(await svc.find({ ...Q, to: 'Богунія' }), { ok: false, fallback: 'maps', reason: 'cap' });
  assert.deepEqual(await svc.learnTick(3), { asked: 0, learned: 0 });
  assert.equal(quota.calls.length, 1);
  assert.equal((await svc.stats()).callsToday, 0);
  // далі пробуємо знову: один запит, знову 429 — і жодної позначки «не чіпати тиждень»
  at = new Date(NOW.getTime() + 11 * 60_000);
  assert.deepEqual(await svc.learnTick(3), { asked: 0, learned: 0 });
  assert.equal(quota.calls.length, 2);
  assert.deepEqual(db.dovedeCityDemand.rows.map((r) => r.learnFailedAt ?? null), [null, null]);

  // збій Google (500): одна спроба за крок, позначок немає, наступного кроку — та сама пара
  const down = fakeFetch({}, false, 500);
  const t = make({ dailyCap: () => 100 });
  await t.svc.find(Q);
  t.dovedeCityRoute.rows.length = 0;
  const broken = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: down.fetchImpl, now: () => NOW, ownRoute: () => null, dailyCap: () => 100 });
  assert.deepEqual(await broken.learnTick(3), { asked: 1, learned: 0 });
  assert.deepEqual(await broken.learnTick(3), { asked: 1, learned: 0 });
  assert.deepEqual((down.calls as Array<{ destination: { address: string } }>).map((c) => c.destination.address), ['Польова 12, Житомир, Україна', 'Польова 12, Житомир, Україна']);
  assert.equal(t.dovedeCityDemand.rows[0].learnFailedAt ?? null, null);
  // те саме для оновлення застарілого рядка
  await t.svc.find({ ...Q, to: 'Корбутівка' });
  await t.svc.resetDemand();
  const later = new Date(NOW.getTime() + 29 * DAY);
  const seeded = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: t.fetchImpl, now: () => later, ownRoute: () => null, dailyCap: () => 1000 });
  await seeded.learnTick(500);
  const stale = t.dovedeCityRoute.rows.find((r) => r.toKey === 'корбутівка')!;
  stale.fetchedAt = NOW;
  const limited = createCityRoutes({ prisma: t.prisma, key: () => 'k', fetchImpl: fakeFetch({}, false, 429).fetchImpl, now: () => later, ownRoute: () => null, dailyCap: () => 1000 });
  assert.deepEqual(await limited.learnTick(3), { asked: 0, learned: 0 });
  assert.equal(stale.refreshFailedAt ?? null, null);

  // 403 — Google відмовив у доступі (ключ, вимкнений API, білінг): «відмовлено», текст Google — в адмінку, 10 хв тиші
  const denied = fakeFetch({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Requests to this API routes.googleapis.com method google.maps.routing.v2.Routes.ComputeRoutes are blocked.' } }, false, 403);
  const dn = make({ dailyCap: () => 100 });
  await dn.svc.find(Q);
  dn.dovedeCityRoute.rows.length = 0;
  const closed = createCityRoutes({ prisma: dn.prisma, key: () => 'k', fetchImpl: denied.fetchImpl, now: () => NOW, ownRoute: () => null, dailyCap: () => 100 });
  assert.deepEqual(await closed.find({ ...Q, to: 'Крошня' }), { ok: false, fallback: 'maps', reason: 'denied' });
  assert.deepEqual(await closed.find({ ...Q, to: 'Малеванка' }), { ok: false, fallback: 'maps', reason: 'denied' });
  assert.deepEqual(await closed.learnTick(3), { asked: 0, learned: 0 });
  assert.equal(denied.calls.length, 1);
  // лічильник спільний (у базі): перший запит іншого екземпляра врахований, відмови 403 — ні
  assert.deepEqual([(await closed.stats()).googleError?.status, (await closed.stats()).googleError?.message, (await closed.stats()).callsToday], [403, 'Requests to this API routes.googleapis.com method google.maps.routing.v2.Routes.ComputeRoutes are blocked.', 1]);
  assert.equal(dn.dovedeCityDemand.rows.every((r) => (r.learnFailedAt ?? null) === null), true);

  // 400 — Google не прийняв саме цю адресу: «дороги немає», і це вже вина пари
  const bad = make({}, {}, false);
  const rejecting = createCityRoutes({ prisma: bad.prisma, key: () => 'k', fetchImpl: fakeFetch({}, false, 400).fetchImpl, now: () => NOW, ownRoute: () => null });
  assert.deepEqual(await rejecting.find(Q), { ok: false, fallback: 'maps', reason: 'no_route' });
});

test('оновлення: коли питати й що саме', () => {
  assert.deepEqual([1, 3, 4, 8, 30, 365].map(refreshLeadDays), [0, 0, 1, 2, 2, 2]);
  assert.deepEqual(nextSlot(new Date('2026-11-17T08:00:00.000Z'), 'weekday', 9), { date: '2026-11-18', time: '09:00', utc: new Date('2026-11-18T07:00:00.000Z') });
  // пʼятниця влітку → понеділок, UTC+3
  assert.deepEqual(nextSlot(new Date('2026-06-12T08:00:00.000Z'), 'weekday', 9), { date: '2026-06-15', time: '09:00', utc: new Date('2026-06-15T06:00:00.000Z') });
  // у Києві вже 18-те (00:30) — «завтра» це 19-те
  assert.equal(nextSlot(new Date('2026-11-17T22:30:00.000Z'), 'weekday', 7).date, '2026-11-19');
  assert.equal(nextSlot(new Date('2026-11-17T08:00:00.000Z'), 'sunday', 22).date, '2026-11-22');
  // id точки лишається id; слова — як їх написала людина, а не ключ малими літерами
  assert.equal(storedPoint('kyiv.akadem', 'метро «Академмістечко»'), 'kyiv.akadem');
  assert.equal(storedPoint('zhytomyr.avtovokzal', 'автовокзал Житомир-1'), 'zhytomyr.avtovokzal');
  assert.equal(storedPoint('польова 12', 'Польова 12'), 'Польова 12');
  assert.equal(storedPoint('польова 12', 'щось інше'), 'польова 12');
});

test('навчання вимкнено без ключа чи без запису; найближчий будень о 09:00', async () => {
  assert.deepEqual(await make({ key: () => null }).svc.learnTick(), { asked: 0, learned: 0 });
  assert.deepEqual(await make({ store: () => false }).svc.learnTick(), { asked: 0, learned: 0 });
  // пʼятниця → понеділок
  assert.equal(nextWeekdayMorning(new Date('2026-11-20T10:00:00.000Z')).date, '2026-11-23');
});

test('Житомир: власна пряма поїздка — перед базою й Google, без запитів назовні; Київ її не питає; вимикач', async () => {
  const own = { ok: true as const, source: 'own' as const, city: 'Zhytomyr' as const, fromLabel: 'a', toLabel: 'b', steps: [{ kind: 'transit' as const, minutes: 9, line: '58', headwayMin: 20 }], minutes: 14, fetchedAt: '2026-11-17T00:00:00.000Z' };
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

  const off = make({ ownRoute: () => own, ownEnabled: () => false });
  assert.equal(((await off.svc.find(Q)) as { source?: string }).source, 'google');
});

test('пари видів транспорту: ті самі, що в фікстурах сторінки, і навчання тримає їх свіжими', () => {
  const file = path.resolve(__dirname, '../../../frontend/src/pages/DovedePage/compose/fixtures/kyiv-city-modes.json');
  const asks = Object.values((JSON.parse(readFileSync(file, 'utf8')) as { answers: Record<string, { ask: { city: string; from: string; to: string } }> }).answers).map((a) => a.ask);
  assert.deepEqual(MODE_PAIRS.map((p) => [p.city, p.from, p.to]).sort(), asks.map((a) => [a.city, a.from, a.to]).sort());
  for (const p of MODE_PAIRS) {
    assert.ok(SEED_PAIRS.includes(p));
    assert.ok(resolveCityPoint(p.city, p.from) && resolveCityPoint(p.city, p.to), `${p.from} → ${p.to}`);
  }
});

test('денний ліміт Google з адмінки: сильніший за змінну середовища; null повертає її; межі 0–5000', async () => {
  const t = make({ dailyCap: () => 2 });
  let stats = await t.svc.stats();
  assert.deepEqual([stats.dailyCap, stats.dailyCapDefault, stats.dailyCapFromAdmin], [2, 2, false]);
  assert.equal((await t.svc.find(Q)).ok, true);
  assert.equal((await t.svc.find({ ...Q, to: 'Житній ринок' })).ok, true);
  assert.deepEqual(await t.svc.find({ ...Q, to: 'Корбутівка' }), { ok: false, fallback: 'maps', reason: 'cap' });
  // власник піднімає ліміт в адмінці — одразу питаємо знову, без перезапуску
  assert.equal(await t.svc.setDailyCap(3), 3);
  assert.equal((await t.svc.find({ ...Q, to: 'Корбутівка' })).ok, true);
  stats = await t.svc.stats();
  assert.deepEqual([stats.dailyCap, stats.dailyCapDefault, stats.dailyCapFromAdmin], [3, 2, true]);
  // строк свіжості й ліміт — один рядок налаштувань, не затирають один одного
  await t.svc.setFreshDays(14);
  assert.deepEqual(t.dovedeCitySettings.rows.map((r) => [r.freshDays, r.dailyCap]), [[14, 3]]);
  // 0 — Google не питати зовсім
  await t.svc.setDailyCap(0);
  assert.deepEqual(await t.svc.find({ ...Q, to: 'Богунія' }), { ok: false, fallback: 'maps', reason: 'cap' });
  // null — знову як у змінній
  assert.equal(await t.svc.setDailyCap(null), 2);
  assert.equal((await t.svc.stats()).dailyCapFromAdmin, false);
  await assert.rejects(() => t.svc.setDailyCap(5001));
  await assert.rejects(() => t.svc.setDailyCap(-1));
  await assert.rejects(() => t.svc.setDailyCap(1.5));
});

test('облік Google — у базі й спільний: другий екземпляр бачить ліміт, паузу після відмови й текст; люди / навчання / відмовлено', async () => {
  const db = fakeDb();
  const net = fakeFetch();
  const opts = { prisma: db.prisma, key: () => 'k', fetchImpl: net.fetchImpl, now: () => NOW, enabled: () => true, store: () => true, dailyCap: () => 3, ownRoute: () => null };
  // два контейнери під час деплою — два обʼєкти над однією базою
  const a = createCityRoutes(opts);
  const b = createCityRoutes(opts);
  assert.equal((await a.find(Q)).ok, true);
  assert.equal((await b.find({ ...Q, to: 'Житній ринок' })).ok, true);
  assert.equal((await b.find({ ...Q, to: 'Богунія' }, true)).ok, true);
  // ліміт 3 вичерпано разом: четвертий запит не йде в Google ні з а, ні з b
  assert.deepEqual(await a.find({ ...Q, to: 'Корбутівка' }), { ok: false, fallback: 'maps', reason: 'cap' });
  assert.equal(net.calls.length, 3);
  assert.deepEqual(db.dovedeCityGoogleDay.rows.map((r) => [r.day, r.calls, r.people, r.learn, r.refused]), [['2026-11-17', 3, 2, 1, 1]]);
  const st = await b.stats();
  assert.deepEqual([st.callsToday, st.today, st.blocked], [3, { people: 2, learn: 1, refused: 1 }, null]);

  // відмова Google в одному екземплярі — пауза й текст видно в іншому (і після перезапуску)
  const db2 = fakeDb();
  const quota = fakeFetch({ error: { message: 'Quota exceeded' } }, false, 429);
  const one = createCityRoutes({ ...opts, prisma: db2.prisma, fetchImpl: quota.fetchImpl, dailyCap: () => 100 });
  assert.deepEqual(await one.find(Q), { ok: false, fallback: 'maps', reason: 'cap' });
  const ok = fakeFetch();
  const fresh = createCityRoutes({ ...opts, prisma: db2.prisma, fetchImpl: ok.fetchImpl, dailyCap: () => 100 });
  assert.deepEqual(await fresh.find({ ...Q, to: 'Житній ринок' }), { ok: false, fallback: 'maps', reason: 'cap' });
  assert.equal(ok.calls.length, 0);
  const st2 = await fresh.stats();
  assert.deepEqual([st2.googleError?.status, st2.googleError?.message, st2.blocked?.reason, st2.callsToday, st2.today.refused], [429, 'Quota exceeded', 'quota', 0, 2]);
  assert.equal(st2.blocked?.until, new Date(NOW.getTime() + 10 * 60_000).toISOString());
});
