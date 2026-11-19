/**
 * «Доведе» · дані сторінки з адмінки (page-data.ts, крок 11): перевірка значень, «змінено на null» ≠ «типове», лише
 * змінені ключі для сторінки, HTTP (сторінка — з доступом «Доведе», зміна — лише адмін).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createDovedePageData, serviceProblem, shuttleProblem } from './page-data';
import { createAdminDovedeRouter } from '../routes/admin-dovede';
import { adminAuthToken, setAdminPassword } from '../middleware/require-admin';
import type { CityRoutes } from './city-route';
import { createDovedeSettings } from './settings';
import { dovedeAccessToken } from './access';

function fakePrisma() {
  const rows = new Map<string, { key: string; value: unknown; updatedAt: Date }>();
  const prisma = {
    dovedeSetting: {
      findMany: async () => [...rows.values()],
      upsert: async ({ where, create, update }: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }) => {
        const prev = rows.get(where.key);
        const row = { key: where.key, value: (prev ? update : create).value, updatedAt: new Date('2026-11-19T08:00:00.000Z') };
        rows.set(where.key, row);
        return row;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows };
}

const SHUTTLE = { line: 'M3', after: 'kyiv.m.vydubychi', stations: ['kyiv.m.slavutych', 'kyiv.m.osokorky'], bus: ' 318 ', hopSeconds: 200, waitSeconds: 300, checkedAt: '2026-11-19' };

test('перевірка: замінник метро — станції тієї самої лінії, номер, секунди; години й тариф — у межах', () => {
  assert.equal(shuttleProblem(null), null);
  assert.equal(shuttleProblem(SHUTTLE), null);
  assert.match(shuttleProblem({ ...SHUTTLE, line: 'M4' })!, /^line/);
  assert.match(shuttleProblem({ ...SHUTTLE, after: 'kyiv.m.akademmistechko' })!, /^after/);
  assert.match(shuttleProblem({ ...SHUTTLE, stations: ['kyiv.m.vydubychi'] })!, /^stations/);
  assert.match(shuttleProblem({ ...SHUTTLE, stations: [] })!, /^stations/);
  assert.match(shuttleProblem({ ...SHUTTLE, bus: '' })!, /^bus/);
  assert.match(shuttleProblem({ ...SHUTTLE, hopSeconds: 5 })!, /^hopSeconds/);
  assert.match(shuttleProblem({ ...SHUTTLE, checkedAt: 'вчора' })!, /^checkedAt/);
  assert.equal(serviceProblem({ openMins: 330, closeMins: 1380, fareUah: 30 }), null);
  assert.match(serviceProblem({ openMins: 330, closeMins: 300, fareUah: 30 })!, /^closeMins/);
  assert.match(serviceProblem({ openMins: 330, closeMins: 1380, fareUah: -1 })!, /^fareUah/);
  assert.match(serviceProblem(null)!, /обʼєкт/);
});

test('змінене віддаємо сторінці; null — теж значення («метро їздить усюди»), reset — назад до коду', async () => {
  const db = fakePrisma();
  let at = new Date('2026-11-19T08:00:00.000Z');
  const pd = createDovedePageData({ prisma: db.prisma, now: () => at });
  assert.deepEqual(await pd.values(), {});
  const v = await pd.set('metro.shuttle', SHUTTLE);
  assert.equal(v.changed, true);
  assert.equal((v.value as { bus: string }).bus, '318');
  assert.deepEqual(db.rows.get('page.metro.shuttle')?.value, { v: { ...SHUTTLE, bus: '318' } });

  await pd.set('metro.shuttle', null);
  assert.deepEqual(await pd.values(), { 'metro.shuttle': null });

  await pd.set('metro.shuttle', null, true);
  assert.equal(db.rows.get('page.metro.shuttle')?.value, Prisma.DbNull);
  assert.deepEqual(await pd.values(), {});
  await assert.rejects(pd.set('metro.service', { openMins: 1 }), /metro\.service: closeMins/);
  await assert.rejects(pd.set('nope', 1), /невідомі дані/);

  // значення, яке вже не проходить перевірку, сторінці не віддаємо
  db.rows.set('page.metro.service', { key: 'page.metro.service', value: { v: { openMins: 'рано' } }, updatedAt: at });
  at = new Date(at.getTime() + 61_000);
  assert.deepEqual(await pd.values(), {});
  const list = await pd.list();
  assert.deepEqual(list.map((x) => [x.key, x.changed]), [['metro.shuttle', false], ['metro.service', false]]);
});

test('HTTP: сторінка читає з доступом «Доведе», міняє лише адмін', async () => {
  const PASSWORD = 'page-data-test';
  const AUTH = adminAuthToken(PASSWORD);
  const db = fakePrisma();
  const app = express();
  app.use(express.json());
  setAdminPassword(app, PASSWORD);
  app.use(
    createAdminDovedeRouter({
      prisma: db.prisma,
      understand: null,
      settings: createDovedeSettings({ prisma: db.prisma, env: {} }),
      cityRoutes: {} as CityRoutes,
      access: { isPublic: () => false, password: () => 'guest' },
      driveTime: async () => ({ minutes: 95, source: 'fixed' }),
    }),
  );
  assert.equal((await request(app).get('/dovede/page-data')).status, 401);
  assert.equal((await request(app).put('/admin/dovede/page-data').send({ key: 'metro.shuttle', value: null })).status, 401);
  assert.equal((await request(app).put('/admin/dovede/page-data').set('Authorization', AUTH).send({ key: 'metro.shuttle' })).status, 400);
  const bad = await request(app).put('/admin/dovede/page-data').set('Authorization', AUTH).send({ key: 'metro.shuttle', value: { ...SHUTTLE, line: 'M9' } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /line/);
  const ok = await request(app).put('/admin/dovede/page-data').set('Authorization', AUTH).send({ key: 'metro.service', value: { openMins: 330, closeMins: 1380, fareUah: 35 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.changed, true);
  // гість із паролем запрошених — як сторінка
  const page = await request(app).get('/dovede/page-data').set('X-Dovede-Token', dovedeAccessToken('guest'));
  assert.equal(page.status, 200);
  assert.deepEqual(page.body, { values: { 'metro.service': { openMins: 330, closeMins: 1380, fareUah: 35 } } });
  const admin = await request(app).get('/admin/dovede/page-data').set('Authorization', AUTH);
  assert.equal(admin.body.items.length, 2);
});
