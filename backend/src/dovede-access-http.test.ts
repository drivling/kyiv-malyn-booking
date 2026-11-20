/**
 * HTTP: доступ до «Доведе» (dovede/access.ts) — пароль запрошених DOVEDE_PASSWORD, свій токен, токен адміна,
 * DOVEDE_PUBLIC=ON і лічилка невдалих паролів. Claude підмінено заглушкою.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import { listenLocal } from './http-test-server';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { adminAuthToken } from './middleware/require-admin';
import {
  DOVEDE_LOGIN_MAX_FAILURES,
  DOVEDE_LOGIN_WINDOW_MS,
  dovedeAccessToken,
  dovedePassword,
  isDovedePublic,
  type DovedeAccessConfig,
} from './dovede/access';
import type { UnderstandFn } from './dovede/understand';

const ADMIN_PASSWORD = 'http-test-admin-password-dovede-access';
const ADMIN = adminAuthToken(ADMIN_PASSWORD);
const GUEST_PASSWORD = 'гостьовий пароль';
const QUESTION = { text: 'з Києва в Малин' };

const understand: UnderstandFn = async () => ({
  ok: true,
  intent: {
    intent: 'trip',
    from: { id: 'city.Kyiv', text: 'Києва' },
    to: { id: 'city.Malyn', text: 'Малин' },
    when: { day: 'today', kind: 'depart' },
    modes: [],
    unknown: [],
    confidence: 'high',
  },
  model: 'claude-opus-5-5',
  latencyMs: 900,
  promptVersion: 'dovede-understand-v1',
});

const prisma = {
  dovedeQuery: { create: async () => ({}), count: async () => 0, findMany: async () => [] },
  transportStop: { findMany: async () => [] },
  transportRoute: { findMany: async () => [] },
} as unknown as PrismaClient;

async function appWith(access: Partial<DovedeAccessConfig>) {
  return listenLocal(createApp({
    prisma,
    adminPassword: ADMIN_PASSWORD,
    dovedeUnderstand: understand,
    dovedeAccess: { isPublic: () => false, password: () => null, ...access },
  }));
}

test('без пароля в середовищі: сторінка закрита, вхід за паролем вимкнено, Claude — 401', async () => {
  const app = await appWith({});
  assert.deepEqual((await request(app).get('/dovede/access')).body, { open: false, allowed: false });
  const login = await request(app).post('/dovede/login').send({ password: 'будь-що' });
  assert.equal(login.status, 503);
  assert.equal((await request(app).post('/dovede/understand').send(QUESTION)).status, 401);
});

test('пароль запрошених: невірний — 401, вірний — токен, з ним відкриваються сторінка й Claude', async () => {
  const app = await appWith({ password: () => GUEST_PASSWORD });
  const wrong = await request(app).post('/dovede/login').send({ password: 'не той' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, 'Невірний пароль');
  assert.equal((await request(app).post('/dovede/login').send({})).status, 401);

  const ok = await request(app).post('/dovede/login').send({ password: GUEST_PASSWORD });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.token, dovedeAccessToken(GUEST_PASSWORD));
  assert.notEqual(ok.body.token, ADMIN, 'токен гостя — не адмінський');

  const access = await request(app).get('/dovede/access').set('X-Dovede-Token', ok.body.token);
  assert.deepEqual(access.body, { open: false, allowed: true });
  assert.equal(access.headers['cache-control'], 'no-store');
  const res = await request(app).post('/dovede/understand').set('X-Dovede-Token', ok.body.token).send(QUESTION);
  assert.equal(res.status, 200);
  assert.equal(res.body.intent.to.id, 'city.Malyn');
});

test('токен гостя не відкриває адмінку, а токен від іншого пароля — «Доведе»', async () => {
  const app = await appWith({ password: () => GUEST_PASSWORD });
  const guest = dovedeAccessToken(GUEST_PASSWORD);
  assert.equal((await request(app).get('/admin/dovede/queries').set('Authorization', guest)).status, 401);
  assert.equal((await request(app).get('/admin/check').set('Authorization', guest)).status, 401);
  const stale = dovedeAccessToken('старий пароль');
  assert.deepEqual((await request(app).get('/dovede/access').set('X-Dovede-Token', stale)).body, { open: false, allowed: false });
  assert.equal((await request(app).post('/dovede/understand').set('X-Dovede-Token', stale).send(QUESTION)).status, 401);
  // і адмінський токен у заголовку гостя не годиться: інша сіль
  assert.equal((await request(app).post('/dovede/understand').set('X-Dovede-Token', ADMIN).send(QUESTION)).status, 401);
});

test('токен адміна відкриває «Доведе» без пароля запрошених', async () => {
  const app = await appWith({});
  assert.deepEqual((await request(app).get('/dovede/access').set('Authorization', ADMIN)).body, { open: false, allowed: true });
  assert.equal((await request(app).post('/dovede/understand').set('Authorization', ADMIN).send(QUESTION)).status, 200);
});

test('DOVEDE_PUBLIC=ON: відкрито всім, без пароля й токена', async () => {
  const app = await appWith({ isPublic: () => true, password: () => GUEST_PASSWORD });
  assert.deepEqual((await request(app).get('/dovede/access')).body, { open: true, allowed: true });
  assert.equal((await request(app).post('/dovede/understand').send(QUESTION)).status, 200);
  // журнал лишається адмінським
  assert.equal((await request(app).get('/admin/dovede/queries')).status, 401);
});

test(`після ${DOVEDE_LOGIN_MAX_FAILURES} невдалих паролів — 429 навіть для вірного, нове вікно знову пускає`, async () => {
  const { createAdminDovedeRouter } = await import('./routes/admin-dovede');
  const express = (await import('express')).default;
  let now = new Date('2026-11-14T10:00:00.000Z').getTime();
  const app = express();
  app.use(express.json());
  app.use(
    createAdminDovedeRouter({
      prisma,
      understand,
      now: () => new Date(now),
      access: { isPublic: () => false, password: () => GUEST_PASSWORD },
    }),
  );
  const server = await listenLocal(app);
  for (let i = 0; i < DOVEDE_LOGIN_MAX_FAILURES; i++) {
    assert.equal((await request(server).post('/dovede/login').send({ password: `спроба ${i}` })).status, 401);
  }
  const blocked = await request(server).post('/dovede/login').send({ password: GUEST_PASSWORD });
  assert.equal(blocked.status, 429);
  now += DOVEDE_LOGIN_WINDOW_MS;
  assert.equal((await request(server).post('/dovede/login').send({ password: GUEST_PASSWORD })).status, 200);
});

test('змінні середовища: DOVEDE_PUBLIC лише ON / 1 / true / yes, порожній DOVEDE_PASSWORD — вимкнено', () => {
  for (const v of ['ON', 'on', ' On ', '1', 'true', 'yes']) assert.equal(isDovedePublic({ DOVEDE_PUBLIC: v }), true, v);
  for (const v of [undefined, '', 'off', '0', 'false', 'ONN']) assert.equal(isDovedePublic({ DOVEDE_PUBLIC: v }), false, String(v));
  assert.equal(dovedePassword({}), null);
  assert.equal(dovedePassword({ DOVEDE_PASSWORD: '   ' }), null);
  assert.equal(dovedePassword({ DOVEDE_PASSWORD: ' пароль з пробілом ' }), ' пароль з пробілом ');
});
