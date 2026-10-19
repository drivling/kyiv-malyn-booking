/**
 * HTTP: особисті маршрути поза `/user/*` теж вірять лише підпису Telegram Login у заголовку
 * `X-Telegram-Login` (telegram-login-auth.ts), а не `telegramUserId` з тіла запиту:
 * `DELETE /bookings/:id/by-user`, `PATCH /viber-listings/:id/by-user`, `PATCH /viber-listings/:id/deactivate/by-user`,
 * `POST /rideshare/request` (Docs/transport-open-data-2026-10.md, фаза 4, «Знахідки»).
 */
import { afterEach, test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { resetTelegramPrismaForTests, setTelegramPrismaForTests } from './telegram';
import { TELEGRAM_LOGIN_HEADER, encodeTelegramLoginHeader, signTelegramLogin } from './telegram-login-auth';

const BOT_TOKEN = '123456:test-bot-token';
const REAL_SEC = () => Math.floor(Date.now() / 1000);
/** Той, хто увійшов через віджет */
const ME = '123456789';
/** Чужий Telegram id, який зловмисник підставляє в тіло */
const OTHER = '987654321';

function loginHeader(id: string = ME): string {
  const base = { id: Number(id), first_name: 'Іван', auth_date: REAL_SEC() - 30 };
  return encodeTelegramLoginHeader({ ...base, hash: signTelegramLogin(base, BOT_TOKEN) });
}

const PERSON = { id: 42, phoneNormalized: '380671234567', fullName: 'Іван Тест', telegramUserId: ME, telegramChatId: '555' };
const BOOKING = { id: 7, route: 'Kyiv-Malyn', date: new Date('2026-11-01T00:00:00Z'), departureTime: '08:00', telegramUserId: ME };
const LISTING = {
  id: 11,
  personId: PERSON.id,
  listingType: 'driver',
  route: 'Kyiv-Malyn',
  date: new Date('2026-11-01T00:00:00Z'),
  departureTime: '09:00',
  seats: 3,
  notes: null,
  priceUah: null,
  phone: PERSON.phoneNormalized,
  senderName: 'Іван',
  isActive: true,
  endsAt: new Date('2026-11-01T07:00:00Z'),
  createdAt: new Date('2026-10-20T00:00:00Z'),
  updatedAt: new Date('2026-10-20T00:00:00Z'),
};

type Call = { model: string; op: string; args: unknown };

/** Мінімальний Prisma-стаб: записує виклики, віддає заздалегідь задані рядки */
function makePrisma(opts: { person?: typeof PERSON | null; booking?: typeof BOOKING | null; listing?: typeof LISTING | null }) {
  const calls: Call[] = [];
  const rec = (model: string, op: string, result: unknown) => async (args: unknown) => {
    calls.push({ model, op, args });
    return typeof result === 'function' ? (result as (a: unknown) => unknown)(args) : result;
  };
  // Одне оголошення «в базі»: update змінює його, findUnique після дедуплікації читає вже оновлене
  const state = { listing: opts.listing === undefined ? LISTING : opts.listing };
  const prisma = {
    person: { findFirst: rec('person', 'findFirst', opts.person === undefined ? PERSON : opts.person) },
    booking: {
      findUnique: rec('booking', 'findUnique', opts.booking === undefined ? BOOKING : opts.booking),
      delete: rec('booking', 'delete', BOOKING),
    },
    viberListing: {
      findFirst: rec('viberListing', 'findFirst', () => state.listing),
      findUnique: rec('viberListing', 'findUnique', () => state.listing),
      findMany: rec('viberListing', 'findMany', []),
      update: rec('viberListing', 'update', (args: unknown) => {
        state.listing = { ...(state.listing ?? LISTING), ...(args as { data: object }).data };
        return state.listing;
      }),
    },
    rideShareRequest: { findFirst: rec('rideShareRequest', 'findFirst', null), create: rec('rideShareRequest', 'create', { id: 1 }) },
  } as unknown as PrismaClient;
  return { prisma, calls };
}

function makeApp(opts: Parameters<typeof makePrisma>[0] = {}, botToken: string | null = BOT_TOKEN) {
  const { prisma, calls } = makePrisma(opts);
  // getPersonByTelegram шукає персону через власний клієнт telegram.ts
  setTelegramPrismaForTests(prisma);
  return { app: createApp({ prisma, adminPassword: 'x', telegramBotToken: botToken }), calls };
}

afterEach(() => resetTelegramPrismaForTests());

// ---------- DELETE /bookings/:id/by-user ----------

test('DELETE /bookings/:id/by-user без заголовка → 401, навіть з telegramUserId власника в тілі; нічого не видалено', async () => {
  const { app, calls } = makeApp();
  const res = await request(app).delete('/bookings/7/by-user').send({ telegramUserId: ME }).expect(401);
  assert.equal(res.body.reason, 'missing');
  assert.deepEqual(calls, []);
});

test('DELETE /bookings/:id/by-user з підписом власника → 200, бронювання видалено', async () => {
  const { app, calls } = makeApp();
  const res = await request(app).delete('/bookings/7/by-user').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(200);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.booking.id, 7);
  assert.ok(calls.some((c) => c.model === 'booking' && c.op === 'delete'));
});

test('DELETE /bookings/:id/by-user: чужий підпис → 403, telegramUserId власника в тілі не допомагає', async () => {
  const { app, calls } = makeApp();
  await request(app)
    .delete('/bookings/7/by-user')
    .set(TELEGRAM_LOGIN_HEADER, loginHeader(OTHER))
    .send({ telegramUserId: ME })
    .expect(403);
  assert.ok(!calls.some((c) => c.op === 'delete'));
});

// ---------- PATCH /viber-listings/:id/by-user ----------

test('PATCH /viber-listings/:id/by-user без заголовка → 401, оголошення не чіпали', async () => {
  const { app, calls } = makeApp();
  const res = await request(app).patch('/viber-listings/11/by-user').send({ telegramUserId: ME, seats: 2 }).expect(401);
  assert.equal(res.body.reason, 'missing');
  assert.deepEqual(calls, []);
});

test('PATCH /viber-listings/:id/by-user з підписом → 200; власника шукають за id з підпису, а не з тіла', async () => {
  const { app, calls } = makeApp();
  const res = await request(app)
    .patch('/viber-listings/11/by-user')
    .set(TELEGRAM_LOGIN_HEADER, loginHeader())
    .send({ telegramUserId: OTHER, seats: 2 })
    .expect(200);
  assert.equal(res.body.seats, 2);
  const personLookup = calls.find((c) => c.model === 'person' && c.op === 'findFirst');
  assert.deepEqual((personLookup?.args as { where: { OR: unknown[] } }).where.OR, [{ telegramUserId: ME }]);
  const update = calls.find((c) => c.model === 'viberListing' && c.op === 'update');
  assert.deepEqual((update?.args as { data: object }).data, { seats: 2 });
});

test('PATCH /viber-listings/:id/by-user: підпис людини без цього оголошення → 404', async () => {
  const { app, calls } = makeApp({ listing: null });
  await request(app).patch('/viber-listings/11/by-user').set(TELEGRAM_LOGIN_HEADER, loginHeader(OTHER)).send({ seats: 2 }).expect(404);
  assert.ok(!calls.some((c) => c.op === 'update'));
});

// ---------- PATCH /viber-listings/:id/deactivate/by-user ----------

test('PATCH /viber-listings/:id/deactivate/by-user: без заголовка 401, з підписом 200 (isActive: false)', async () => {
  const { app, calls } = makeApp();
  await request(app).patch('/viber-listings/11/deactivate/by-user').send({ telegramUserId: ME }).expect(401);
  assert.deepEqual(calls, []);
  const res = await request(app).patch('/viber-listings/11/deactivate/by-user').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(200);
  assert.equal(res.body.isActive, false);
  const update = calls.find((c) => c.model === 'viberListing' && c.op === 'update');
  assert.deepEqual((update?.args as { data: object }).data, { isActive: false });
});

// ---------- POST /rideshare/request ----------

test('POST /rideshare/request без заголовка → 401, запит не створено', async () => {
  const { app, calls } = makeApp();
  const res = await request(app).post('/rideshare/request').send({ driverListingId: 11, telegramUserId: ME }).expect(401);
  assert.equal(res.body.reason, 'missing');
  assert.deepEqual(calls, []);
});

test('POST /rideshare/request: пасажир — з підпису, telegramUserId у тілі ігнорується; без driverListingId → 400', async () => {
  const { app, calls } = makeApp({ person: { ...PERSON, phoneNormalized: '' } });
  await request(app).post('/rideshare/request').set(TELEGRAM_LOGIN_HEADER, loginHeader()).send({}).expect(400);
  assert.deepEqual(calls, []);
  // Персона без телефону → 400 «підключіть номер», але шукали її за id з підпису
  const res = await request(app)
    .post('/rideshare/request')
    .set(TELEGRAM_LOGIN_HEADER, loginHeader())
    .send({ driverListingId: 11, telegramUserId: OTHER })
    .expect(400);
  assert.match(res.body.error, /номер телефону/);
  const personLookup = calls.find((c) => c.model === 'person' && c.op === 'findFirst');
  assert.deepEqual((personLookup?.args as { where: { OR: unknown[] } }).where.OR, [{ telegramUserId: ME }]);
  assert.ok(!calls.some((c) => c.model === 'rideShareRequest'));
});

test('без TELEGRAM_BOT_TOKEN на сервері особисті маршрути відповідають 503, а не пропускають', async () => {
  const { app } = makeApp({}, null);
  assert.equal((await request(app).delete('/bookings/7/by-user').set(TELEGRAM_LOGIN_HEADER, loginHeader()).expect(503)).body.reason, 'unavailable');
  assert.equal((await request(app).post('/rideshare/request').set(TELEGRAM_LOGIN_HEADER, loginHeader()).send({ driverListingId: 11 }).expect(503)).body.reason, 'unavailable');
});
