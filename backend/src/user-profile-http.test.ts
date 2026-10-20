/**
 * HTTP `/user/*` (routes/user-profile.ts): підпис Telegram Login у заголовку, експорт файлом, видалення.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { TELEGRAM_LOGIN_HEADER, encodeTelegramLoginHeader, signTelegramLogin } from './telegram-login-auth';

const BOT_TOKEN = '123456:test-bot-token';
/** Фіксований «зараз» для роутера з власним `now`; createApp працює з реальним часом */
const NOW = new Date('2026-10-20T10:00:00.000Z');
const NOW_SEC = Math.floor(NOW.getTime() / 1000);
const REAL_SEC = () => Math.floor(Date.now() / 1000);

const PERSON = {
  id: 42,
  phoneNormalized: '380671234567',
  fullName: 'Іван Тест',
  telegramChatId: '555',
  telegramUserId: '123456789',
  telegramUsername: 'ivan_m',
  smsOptOut: false,
  phoneBlockedAt: null,
  referralCode: null,
  referredByPersonId: null,
  createdAt: NOW,
};

function loginHeader(overrides: Record<string, unknown> = {}, nowSec: number = REAL_SEC()): string {
  const base = { id: 123456789, first_name: 'Іван', auth_date: nowSec - 30, ...overrides };
  return encodeTelegramLoginHeader({ ...base, hash: signTelegramLogin(base, BOT_TOKEN) });
}

/** Усі моделі: findMany → [] (або rows), findFirst/findUnique → перший рядок, deleteMany/updateMany → count */
function makePrisma(rows: Partial<Record<string, unknown[]>> = {}) {
  const calls: Array<{ model: string; op: string }> = [];
  const model = (name: string) => {
    const rec = (op: string) => async () => {
      calls.push({ model: name, op });
      const r = rows[name] ?? [];
      if (op === 'findMany') return r;
      if (op === 'findFirst' || op === 'findUnique') return r[0] ?? null;
      if (op === 'deleteMany' || op === 'updateMany') return { count: r.length };
      return {};
    };
    return { findMany: rec('findMany'), findFirst: rec('findFirst'), findUnique: rec('findUnique'), deleteMany: rec('deleteMany'), updateMany: rec('updateMany'), update: rec('update') };
  };
  const tx = new Proxy({}, { get: (_t, prop: string) => (prop === 'then' ? undefined : model(prop)) });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === '$transaction') return async (fn: unknown) => (typeof fn === 'function' ? (fn as (t: unknown) => unknown)(tx) : Promise.all(fn as Promise<unknown>[]));
        if (prop === 'then') return undefined;
        return model(prop);
      },
    },
  ) as unknown as PrismaClient;
  return { prisma, calls };
}

function makeApp(rows: Partial<Record<string, unknown[]>> = {}, opts: { botToken?: string | null; notifyAdmin?: (html: string) => Promise<unknown> } = {}) {
  const { prisma, calls } = makePrisma(rows);
  const app = createApp({ prisma, adminPassword: 'x', telegramBotToken: opts.botToken === undefined ? BOT_TOKEN : opts.botToken });
  return { app, calls };
}

test('GET /user/profile без заголовка → 401 missing; старий спосіб ?telegramUserId= більше не працює', async () => {
  const { app } = makeApp({ person: [PERSON] });
  const res = await request(app).get('/user/profile?telegramUserId=123456789').expect(401);
  assert.equal(res.body.reason, 'missing');
});

test('GET /user/profile: підроблений підпис → 401 invalid; прострочений → 401 expired; вхід за телефоном (hash порожній) → 401', async () => {
  const { app } = makeApp({ person: [PERSON] });
  const tampered = encodeTelegramLoginHeader({ id: 987, first_name: 'Іван', auth_date: REAL_SEC(), hash: signTelegramLogin({ id: 1, first_name: 'Іван', auth_date: REAL_SEC() }, BOT_TOKEN) });
  assert.equal((await request(app).get('/user/profile').set(TELEGRAM_LOGIN_HEADER, tampered).expect(401)).body.reason, 'invalid');
  const old = loginHeader({ auth_date: REAL_SEC() - 3 * 24 * 3600 });
  assert.equal((await request(app).get('/user/profile').set(TELEGRAM_LOGIN_HEADER, old).expect(401)).body.reason, 'expired');
  const phoneOnly = encodeTelegramLoginHeader({ id: 0, first_name: 'User', auth_date: Date.now(), hash: '' });
  assert.equal((await request(app).get('/user/profile').set(TELEGRAM_LOGIN_HEADER, phoneOnly).expect(401)).body.reason, 'malformed');
});

test('без TELEGRAM_BOT_TOKEN на сервері → 503, а не пропуск без перевірки', async () => {
  const { app } = makeApp({ person: [PERSON] }, { botToken: null });
  const res = await request(app).get('/user/profile').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(503);
  assert.equal(res.body.reason, 'unavailable');
});

test('GET /user/profile з коректним підписом → профіль за id з підпису', async () => {
  const { app } = makeApp({ person: [PERSON] });
  const res = await request(app).get('/user/profile').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(200);
  assert.equal(res.body.person.id, 42);
  assert.equal(res.body.person.telegramUserId, '123456789');
  assert.deepEqual(res.body.bookings, []);
});

test('PUT /user/profile/name: ім\'я з тіла, людина — з підпису', async () => {
  const { app, calls } = makeApp({ person: [PERSON] });
  const res = await request(app).put('/user/profile/name').set(TELEGRAM_LOGIN_HEADER, loginHeader()).send({ fullName: '  Іванко ' }).expect(200);
  assert.deepEqual(res.body, { success: true, fullName: 'Іванко' });
  assert.ok(calls.some((c) => c.model === 'person' && c.op === 'update'));
  await request(app).put('/user/profile/name').send({ telegramUserId: '123456789', fullName: 'X' }).expect(401);
});

test('GET /user/export → JSON файлом з Content-Disposition; 404 коли нема жодного запису', async () => {
  const { app } = makeApp({ person: [PERSON] });
  const res = await request(app).get('/user/export').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(200);
  assert.match(res.headers['content-type'], /application\/json/);
  assert.match(res.headers['content-disposition'], /^attachment; filename="malin-kiev-ua-my-data-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(res.headers['cache-control'], 'no-store');
  const data = JSON.parse(res.text);
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.person.phone, '380671234567');
  assert.equal(data.telegramUserId, '123456789');
  assert.ok(!('telegramChatId' in data.person));

  const empty = makeApp({});
  const res404 = await request(empty.app).get('/user/export').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(404);
  assert.match(res404.body.error, /немає жодного запису/);
  await request(empty.app).get('/user/export').expect(401);
});

test('DELETE /user: без confirm → 400; з confirm → знеособлення, підсумок, повідомлення адміну', async () => {
  const admin: string[] = [];
  const { prisma, calls } = makePrisma({ person: [PERSON], booking: [{ id: 1 }] });
  const app = createApp({ prisma, adminPassword: 'x', telegramBotToken: BOT_TOKEN });
  // notifyAdmin з create-app — реальний sendAdminAlertHtml без бота лише логує; тут перевіряємо через власний роутер нижче
  await request(app).delete('/user').set(TELEGRAM_LOGIN_HEADER, loginHeader()).send({}).expect(400);
  await request(app).delete('/user').send({ confirm: true, telegramUserId: '123456789' }).expect(401);

  const res = await request(app).delete('/user').set(TELEGRAM_LOGIN_HEADER, loginHeader()).send({ confirm: true }).expect(200);
  assert.equal(res.body.success, true);
  assert.match(res.body.erasedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(res.body.counts.futureBookingsDeleted, 1);
  assert.match(res.body.summary, /скасовано майбутніх бронювань: 1/);
  assert.ok(calls.some((c) => c.model === 'person' && c.op === 'update'));
  assert.ok(calls.some((c) => c.model === 'booking' && c.op === 'deleteMany'));
  assert.equal(admin.length, 0);
});

test('DELETE /user: власний notifyAdmin отримує HTML-підсумок', async () => {
  const { createUserProfileRouter } = await import('./routes/user-profile');
  const express = (await import('express')).default;
  const admin: string[] = [];
  const { prisma } = makePrisma({ person: [PERSON] });
  const app = express();
  app.use(express.json());
  app.use(createUserProfileRouter({ prisma, telegramBotToken: BOT_TOKEN, notifyAdmin: async (h) => void admin.push(h), now: () => NOW }));
  const res = await request(app).delete('/user').set(TELEGRAM_LOGIN_HEADER, loginHeader({}, NOW_SEC)).send({ confirm: true }).expect(200);
  assert.equal(res.body.erasedAt, NOW.toISOString());
  assert.equal(admin.length, 1);
  assert.match(admin[0], /Person #42, tg 123456789/);

  const empty = makePrisma({});
  const app2 = express();
  app2.use(express.json());
  app2.use(createUserProfileRouter({ prisma: empty.prisma, telegramBotToken: BOT_TOKEN, now: () => NOW }));
  await request(app2).delete('/user').set(TELEGRAM_LOGIN_HEADER, loginHeader({}, NOW_SEC)).send({ confirm: true }).expect(404);
});
