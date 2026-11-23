/**
 * «Доведе» · звіт якості навчання (city-quality.ts): правила підозрілих доріг, «Нормально», HTTP.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { listenLocal } from '../http-test-server';
import type { PrismaClient } from '@prisma/client';
import { createCityQuality, findSuspicious, type QualityRouteRow } from './city-quality';
import { createAdminDovedeRouter } from '../routes/admin-dovede';
import { adminAuthToken, setAdminPassword } from '../middleware/require-admin';
import type { CityRoutes } from './city-route';
import { createDovedeSettings } from './settings';
import { CHECK_DATASET } from './city-check.fixture';
import { ownTimetable } from './own-timetable';

const bus = { kind: 'transit', minutes: 10, mode: 'BUS', line: '5' };
const walk = { kind: 'walk', minutes: 30 };

const row = (over: Partial<QualityRouteRow>): QualityRouteRow => ({
  cityCode: 'Kyiv',
  fromKey: 'kyiv.akadem',
  toKey: 'охматдит',
  fromLabel: 'метро «Академмістечко»',
  toLabel: 'Охматдит',
  dayType: 'weekday',
  hour: 9,
  minutes: 40,
  steps: [bus],
  ...over,
});

test('нормальні дороги — не підозрілі; пари двох місць словами й двох точок — не дивимось', () => {
  assert.deepEqual(
    findSuspicious([
      row({}),
      row({ fromKey: 'охматдит', toKey: 'kyiv.akadem', fromLabel: 'Охматдит', toLabel: 'метро «Академмістечко»', minutes: 45 }),
      row({ fromKey: 'kyiv.pas', fromLabel: 'вокзал', minutes: 25 }),
      row({ fromKey: 'михайлівська площа', toKey: 'контрактова площа', fromLabel: 'Михайлівська площа', toLabel: 'Контрактова площа', minutes: 3 }),
      row({ fromKey: 'kyiv.akadem', toKey: 'kyiv.pas', toLabel: 'вокзал', minutes: 2 }),
    ]),
    [],
  );
});

test('одразу поруч з точкою; близько до заходу й вокзалу разом; туди й назад дуже різні; лише пішки довго', () => {
  const items = findSuspicious([
    // «Торговельно-економічний університет»: 5–8 хв від будь-якої точки
    row({ toKey: 'теу', toLabel: 'Торговельно-економічний університет', minutes: 5 }),
    row({ fromKey: 'kyiv.pas', fromLabel: 'вокзал', toKey: 'теу', toLabel: 'Торговельно-економічний університет', minutes: 8 }),
    // туди 20, назад 50
    row({ toKey: 'феофанія', toLabel: 'Феофанія', minutes: 20 }),
    row({ fromKey: 'феофанія', toKey: 'kyiv.akadem', fromLabel: 'Феофанія', toLabel: 'метро «Академмістечко»', minutes: 50 }),
    // назад в інший тип дня — не порівнюємо
    row({ fromKey: 'феофанія', toKey: 'kyiv.akadem', fromLabel: 'Феофанія', toLabel: 'метро «Академмістечко»', minutes: 90, dayType: 'sunday' }),
    // лише пішки 30 хв
    row({ cityCode: 'Zhytomyr', fromKey: 'zhytomyr.avtovokzal', fromLabel: 'автовокзал', toKey: 'польова 12', toLabel: 'Польова 12', minutes: 30, steps: [walk] }),
  ]);
  assert.deepEqual(
    items.map((i) => [i.label, i.reasons.map((r) => r.code)]),
    [
      ['Торговельно-економічний університет', ['next_to_point', 'near_far_points']],
      ['Польова 12', ['walk_only']],
      ['Феофанія', ['asymmetric']],
    ],
  );
  assert.equal(items[0].reasons[0].text, '5 хв від метро «Академмістечко» — можливо, Google знайшов саму точку або щось поруч');
  assert.equal(items[0].reasons[1].text, '5 хв від метро «Академмістечко» і 8 хв від вокзалу — так близько до обох не буває');
  assert.equal(items[2].reasons[0].text, 'туди 20 хв, назад 50 хв (від: метро «Академмістечко»)');
  assert.deepEqual(items[1].routes, [{ origin: 'zhytomyr.avtovokzal', originLabel: 'автовокзал Житомир-1', dir: 'to', dayType: 'weekday', hour: 9, minutes: 30, rides: 0 }]);
  // «Нормально» — більше не показуємо
  assert.equal(findSuspicious([row({ toKey: 'теу', toLabel: 'ТЕУ', minutes: 5 })], new Set(['Kyiv|теу'])).length, 0);
});

/** Мінімальні таблиці для `report` і `markOk` */
function fakePrisma(routes: Array<QualityRouteRow & { source?: string; archivedAt?: Date | null }>) {
  const places: Array<{ cityCode: string; key: string; label: string; okAt: Date | null; archivedAt: Date | null }> = [];
  const match = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'OR') return (v as Array<Record<string, unknown>>).some((w) => match(r, w));
      if (v && typeof v === 'object' && 'not' in (v as object)) return r[k] != null;
      return (r[k] ?? null) === (v ?? null);
    });
  const prisma = {
    dovedeCityRoute: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => routes.map((r) => ({ source: 'google', archivedAt: null, ...r })).filter((r) => match(r, where)),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => routes.find((r) => match(r as unknown as Record<string, unknown>, where)) ?? null,
    },
    dovedeCityPlace: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => places.filter((p) => match(p, where)),
      upsert: async ({ where, create, update }: { where: { cityCode_key: { cityCode: string; key: string } }; create: (typeof places)[number]; update: Partial<(typeof places)[number]> }) => {
        const hit = places.find((p) => p.cityCode === where.cityCode_key.cityCode && p.key === where.cityCode_key.key);
        if (hit) return Object.assign(hit, update);
        places.push({ archivedAt: null, ...create });
        return create;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, places };
}

test('свій датасет (Коростень): лінія не в ту годину, електричка містом; пішки й «туди-назад» — лише в години руху; наші зупинки не перевіряємо', () => {
  const own = { Korosten: ownTimetable(CHECK_DATASET) };
  const k = (over: Partial<QualityRouteRow>) => row({ cityCode: 'Korosten', fromKey: 'korosten.vokzal', fromLabel: 'вокзал', toKey: 'агромаш', toLabel: 'Агромаш', minutes: 17, ...over });
  const ride = (line: string, mode = 'SHARE_TAXI') => [{ kind: 'transit', minutes: 12, mode, line }];
  const reasons = (rows: QualityRouteRow[]) => findSuspicious(rows, new Set(), own).flatMap((i) => i.reasons.map((r) => `${i.label}: ${r.code}: ${r.text}`));
  // «1-А» у будні — 06:30 і 09:55: о 9-й є, о 13-й нема; «2» щодня о 12:00; «7» у нас нема зовсім
  assert.deepEqual(reasons([k({ steps: ride('1-А') }), k({ hour: 12, steps: ride('2') })]), []);
  assert.deepEqual(reasons([k({ hour: 13, steps: ride('1-А') })]), ['Агромаш: line_not_running: будні, 13:00: №1-А — у нашому розкладі цієї години рейсу нема']);
  assert.deepEqual(reasons([k({ steps: ride('7') })]), ['Агромаш: line_not_running: будні, 09:00: лінії №7 у нашому розкладі нема']);
  assert.deepEqual(reasons([k({ steps: ride('6461/6462', 'HEAVY_RAIL') })]), ['Агромаш: rail_in_city: будні, 09:00: Google везе електричкою 6461/6462 містом']);
  // лише пішки 30 хв: у будні автобуси ходять 6–12 — о 22-й це правда, о 10-й — підозріло
  assert.deepEqual(reasons([k({ hour: 22, minutes: 30, steps: [walk] })]), []);
  assert.deepEqual(reasons([k({ hour: 10, minutes: 30, steps: [walk] })]).map((x) => x.split(': ')[1]), ['walk_only']);
  // туди 10 хв о 9-й, назад 45 хв о 22-й — та сама пара, але вночі; удень — підозріло
  const back = (hour: number) => k({ fromKey: 'агромаш', fromLabel: 'Агромаш', toKey: 'korosten.vokzal', toLabel: 'вокзал', hour, minutes: 45, steps: ride('2') });
  assert.deepEqual(reasons([k({ minutes: 10, hour: 12, steps: ride('2') }), back(22)]).filter((x) => x.includes('asymmetric')), []);
  assert.deepEqual(reasons([k({ minutes: 10, hour: 12, steps: ride('2') }), back(12)]).map((x) => x.split(': ')[1]), ['asymmetric']);
  // наша зупинка («Школа» в назві) — сторінка Google про неї не питає, звіт не перевіряє
  assert.deepEqual(reasons([k({ toKey: 'загальноосвітня школа №1', toLabel: 'Загальноосвітня школа №1', minutes: 3, steps: ride('7') })]), []);
  // Київ — як і було: свого розкладу нема, лінію не перевіряємо
  assert.deepEqual(findSuspicious([row({ steps: [{ kind: 'transit', minutes: 10, mode: 'HEAVY_RAIL', line: 'E1' }] })], new Set(), own), []);
});

test('звіт: лише Google не в архіві; «Нормально» прибирає й повертає; HTTP лише адміну', async () => {
  const db = fakePrisma([
    row({ toKey: 'теу', toLabel: 'ТЕУ', minutes: 4 }),
    row({ toKey: 'архів', toLabel: 'Архів', minutes: 3, archivedAt: new Date() }),
    row({ toKey: 'свої', toLabel: 'Свої', minutes: 3, source: 'own' }),
    row({ cityCode: 'Zhytomyr', fromKey: 'zhytomyr.avtovokzal', toKey: 'ринок', toLabel: 'Ринок', minutes: 2 }),
  ]);
  const q = createCityQuality(db.prisma, { dataset: async () => CHECK_DATASET });
  const all = await q.report();
  assert.deepEqual(
    all.items.map((i) => `${i.city}:${i.label}`),
    ['Zhytomyr:Ринок', 'Kyiv:ТЕУ'],
  );
  assert.equal(all.places, 2);
  assert.deepEqual((await q.report('Kyiv')).items.map((i) => i.key), ['теу']);

  const PASSWORD = 'quality-test';
  const AUTH = adminAuthToken(PASSWORD);
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  const settings = createDovedeSettings({ prisma: db.prisma, env: {} });
  app.use(createAdminDovedeRouter({ prisma: db.prisma, understand: null, settings, cityRoutes: {} as CityRoutes, quality: q, driveTime: async () => ({ minutes: 95, source: 'fixed' }) }));
  const server = await listenLocal(app);

  assert.equal((await request(server).get('/admin/dovede/city/quality')).status, 401);
  assert.equal((await request(server).get('/admin/dovede/city/quality?city=Lviv').set('Authorization', AUTH)).status, 400);
  const kyiv = await request(server).get('/admin/dovede/city/quality?city=Kyiv').set('Authorization', AUTH);
  assert.equal(kyiv.status, 200);
  assert.equal(kyiv.body.items[0].label, 'ТЕУ');

  assert.equal((await request(server).post('/admin/dovede/city/place/ok').set('Authorization', AUTH).send({ city: 'Kyiv', key: 'теу' })).status, 400);
  assert.equal((await request(server).post('/admin/dovede/city/place/ok').set('Authorization', AUTH).send({ city: 'Kyiv', key: 'немає', ok: true })).status, 404);
  const ok = await request(server).post('/admin/dovede/city/place/ok').set('Authorization', AUTH).send({ city: 'Kyiv', key: 'теу', ok: true });
  assert.deepEqual(ok.body, { city: 'Kyiv', key: 'теу', ok: true });
  assert.equal(db.places[0].label, 'ТЕУ');
  assert.equal(db.places[0].archivedAt, null);
  const after = await q.report('Kyiv');
  assert.deepEqual([after.items.length, after.okPlaces], [0, 1]);
  await request(server).post('/admin/dovede/city/place/ok').set('Authorization', AUTH).send({ city: 'Kyiv', key: 'теу', ok: false });
  assert.equal((await q.report('Kyiv')).items.length, 1);
});
