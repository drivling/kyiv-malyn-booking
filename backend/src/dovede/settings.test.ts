/**
 * «Доведе» · налаштування з адмінки: типове зі змінної середовища чи коду, значення власника сильніше, null повертає
 * типове, вмикач, вимкнений на сервері, адмінка не вмикає; памʼять на хвилину, запис її скидає. І HTTP: лише адмін,
 * межі з переліку.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { listenLocal } from '../http-test-server';
import type { PrismaClient } from '@prisma/client';
import { DOVEDE_SETTINGS, createDovedeSettings } from './settings';
import { createAdminDovedeRouter } from '../routes/admin-dovede';
import { adminAuthToken, setAdminPassword } from '../middleware/require-admin';
import type { CityRoutes } from './city-route';

/** Таблиця `DovedeSetting` у памʼяті; `reads` — скільки разів читали базу */
function fakePrisma() {
  const rows = new Map<string, { key: string; value: unknown; updatedAt: Date }>();
  let reads = 0;
  const prisma = {
    dovedeSetting: {
      findMany: async () => {
        reads++;
        return [...rows.values()];
      },
      upsert: async ({ where, create, update }: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }) => {
        const prev = rows.get(where.key);
        const row = { key: where.key, value: (prev ? update : create).value, updatedAt: new Date('2026-11-19T08:00:00.000Z') };
        rows.set(where.key, row);
        return row;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows, reads: () => reads };
}

const NOW = new Date('2026-11-19T08:00:00.000Z');

test('перелік: 12 налаштувань у трьох групах, ключі унікальні, у кожного числа є межі', () => {
  assert.equal(DOVEDE_SETTINGS.length, 12);
  assert.equal(new Set(DOVEDE_SETTINGS.map((d) => d.key)).size, 12);
  assert.deepEqual([...new Set(DOVEDE_SETTINGS.map((d) => d.group))], ['ai', 'google', 'learning']);
  for (const d of DOVEDE_SETTINGS) if (d.kind === 'int') assert.ok(d.min != null && d.max != null && d.min <= d.max, d.key);
});

test('типове: змінна середовища, інакше код; значення власника сильніше; null повертає типове', async () => {
  const db = fakePrisma();
  const s = createDovedeSettings({ prisma: db.prisma, env: { DOVEDE_DAILY_CAP: '120' }, now: () => NOW });
  assert.equal(await s.int('ai.dailyCap'), 120);
  assert.equal(await s.int('city.dailyCap'), 150);
  assert.deepEqual((await s.view('ai.dailyCap')).defaultSource, 'env');
  assert.deepEqual((await s.view('city.dailyCap')).defaultSource, 'code');

  const v = await s.set('ai.dailyCap', 40);
  assert.deepEqual([v.value, v.default, v.stored, v.updatedAt], [40, 120, 40, NOW.toISOString()]);
  assert.equal(await s.int('ai.dailyCap'), 40);
  const back = await s.set('ai.dailyCap', null);
  assert.deepEqual([back.value, back.stored], [120, null]);

  await assert.rejects(() => s.set('ai.dailyCap', 5001), RangeError);
  await assert.rejects(() => s.set('ai.dailyCap', 2.5), RangeError);
  await assert.rejects(() => s.set('ai.enabled', 1 as unknown as boolean), RangeError);
  await assert.rejects(() => s.set('no.such', 1), RangeError);
});

test('вмикач: типово увімкнено; власник вимикає й вмикає; вимкнений на сервері адмінка не вмикає', async () => {
  const db = fakePrisma();
  const s = createDovedeSettings({ prisma: db.prisma, env: {}, now: () => NOW });
  assert.equal(await s.bool('ai.enabled'), true);
  await s.set('ai.enabled', false);
  assert.equal(await s.bool('ai.enabled'), false);

  const off = createDovedeSettings({ prisma: db.prisma, env: { DOVEDE_ENABLED: '0', DOVEDE_CITY_ROUTES: 'off' }, now: () => NOW });
  await off.set('ai.enabled', true);
  const v = await off.view('ai.enabled');
  assert.deepEqual([v.value, v.stored, v.lockedBy], [false, true, 'DOVEDE_ENABLED=0']);
  assert.equal((await off.view('city.enabled')).lockedBy, 'DOVEDE_CITY_ROUTES=off');
  assert.equal(await off.bool('city.enabled'), false);
});

test('памʼять на хвилину: база читається раз; запис скидає памʼять, інший екземпляр бачить нове за хвилину', async () => {
  const db = fakePrisma();
  let at = NOW;
  const a = createDovedeSettings({ prisma: db.prisma, env: {}, now: () => at });
  const b = createDovedeSettings({ prisma: db.prisma, env: {}, now: () => at });
  await a.int('learn.batch');
  await a.int('learn.sharePct');
  assert.equal(db.reads(), 1);
  assert.equal(await b.int('learn.batch'), 3);
  await a.set('learn.batch', 7);
  assert.equal(await a.int('learn.batch'), 7);
  // b ще памʼятає старе — до хвилини
  assert.equal(await b.int('learn.batch'), 3);
  at = new Date(NOW.getTime() + 61_000);
  assert.equal(await b.int('learn.batch'), 7);
});

test('HTTP: лише адмін; список із групами; одне значення за раз; межі з переліку; null — типове', async () => {
  const PASSWORD = 'settings-test';
  const AUTH = adminAuthToken(PASSWORD);
  const db = fakePrisma();
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  const settings = createDovedeSettings({ prisma: db.prisma, env: {}, now: () => NOW });
  app.use(createAdminDovedeRouter({ prisma: db.prisma, understand: null, settings, cityRoutes: {} as CityRoutes, driveTime: async () => ({ minutes: 95, source: 'fixed' }) }));
  const server = await listenLocal(app);

  assert.equal((await request(server).get('/admin/dovede/settings')).status, 401);
  assert.equal((await request(server).put('/admin/dovede/settings').send({ key: 'ai.dailyCap', value: 10 })).status, 401);

  const list = await request(server).get('/admin/dovede/settings').set('Authorization', AUTH);
  assert.equal(list.headers['cache-control'], 'private, no-store');
  assert.equal(list.body.items.length, 12);
  assert.deepEqual(list.body.groups, { ai: 'ШІ (Claude)', google: 'Google', learning: 'Фонове навчання' });
  assert.deepEqual(list.body.items.find((x: { key: string }) => x.key === 'learn.sharePct'), {
    key: 'learn.sharePct',
    group: 'learning',
    kind: 'int',
    label: 'Навчанню — частка денного ліміту Google, %',
    help: 'Фонове навчання зупиняється, коли за день витрачено стільки відсотків ліміту; решта — людям.',
    unit: '%',
    min: 0,
    max: 100,
    value: 50,
    default: 50,
    defaultSource: 'code',
    stored: null,
    updatedAt: null,
    lockedBy: null,
  });

  const put = (body: object) => request(server).put('/admin/dovede/settings').set('Authorization', AUTH).send(body);
  assert.deepEqual([(await put({ key: 'learn.sharePct', value: 30 })).body.value, await settings.int('learn.sharePct')], [30, 30]);
  assert.equal((await put({ key: 'learn.sharePct', value: null })).body.value, 50);
  assert.equal((await put({ key: 'ai.enabled', value: false })).body.value, false);
  for (const bad of [{ key: 'learn.sharePct', value: 101 }, { key: 'learn.sharePct', value: '30' }, { key: 'ai.enabled', value: 'no' }, { key: 'nope', value: 1 }, { key: 'learn.batch' }]) {
    assert.equal((await put(bad)).status, 400, JSON.stringify(bad));
  }

  // запити до Google на день: до 20 000 — без питань, більше — лише з confirm: true (адмінка попереджає), мільйон — стеля
  const cap = list.body.items.find((x: { key: string }) => x.key === 'city.dailyCap');
  assert.deepEqual([cap.max, cap.warnAbove], [1_000_000, 20_000]);
  assert.match(cap.warn, /квоту проєкту в Google Cloud/);
  assert.equal(list.body.items.find((x: { key: string }) => x.key === 'learn.sharePct').warnAbove, undefined);
  assert.equal((await put({ key: 'city.dailyCap', value: 20_000 })).body.value, 20_000);
  const unconfirmed = await put({ key: 'city.dailyCap', value: 20_001 });
  assert.deepEqual([unconfirmed.status, unconfirmed.body.confirm, unconfirmed.body.warnAbove], [409, 'required', 20_000]);
  assert.equal(await settings.int('city.dailyCap'), 20_000, 'без підтвердження нічого не записано');
  assert.equal((await put({ key: 'city.dailyCap', value: 50_000, confirm: true })).body.value, 50_000);
  assert.equal(await settings.int('city.dailyCap'), 50_000);
  assert.equal((await put({ key: 'city.dailyCap', value: 1_000_001, confirm: true })).status, 400);
  assert.equal((await put({ key: 'drive.dailyCap', value: 30_000 })).status, 409);
  assert.equal((await put({ key: 'drive.dailyCap', value: 30_000, confirm: true })).body.value, 30_000);

  // ШІ вимкнено в налаштуваннях — розбір відповідає «словником» без виклику Claude
  const off = await request(server).post('/dovede/understand').set('Authorization', AUTH).send({ text: 'з Малина до Києва завтра' });
  assert.deepEqual([off.status, off.body.reason], [503, 'disabled']);
});
