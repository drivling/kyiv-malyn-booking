/**
 * Інтеграційні HTTP-тести: Prisma-mок для POST /viber-listings; poputky без БД;
 * опційно — реальна БД за RUN_INTEGRATION_TESTS=1 та DATABASE_URL (локальна Postgres).
 */
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { createNoDbPrismaStub } from './http-test-prisma-stub';
import { createListingFlowPrismaMock, EXAMPLE_PHONE_NORMALIZED } from './integration-prisma-mock';
import {
  resetTelegramPrismaForTests,
  setTelegramPrismaForTests,
  resetTelegramBotForTests,
  resetSpawnForTests,
} from './telegram';

const ADMIN_AUTH = { Authorization: 'admin-authenticated' };

/** Текст як у viber-parser.test (Tatiana / Київ-Малин) — стабільний парсинг */
const SAMPLE_VIBER_RAW = `[ 10 квітня 2026 р. 12:00 ] ⁨Tatiana⁩: Водій 10.04.2026.
Київ(Академ)-Малин 250 грн.
16:00
Двоє позаду
+380 (68) 721 14 77`;

afterEach(() => {
  resetTelegramPrismaForTests();
  resetTelegramBotForTests();
  resetSpawnForTests();
});

test('POST /poputky/announce-draft: 400 при невідомому маршруті', async () => {
  const app = createApp({ prisma: createNoDbPrismaStub() });
  await request(app)
    .post('/poputky/announce-draft')
    .send({
      role: 'driver',
      from: 'kyiv',
      to: 'kyiv',
      date: '2026-04-10',
    })
    .expect(400);
});

test('POST /poputky/announce-draft: 200, deepLink і token', async () => {
  const app = createApp({ prisma: createNoDbPrismaStub() });
  const res = await request(app)
    .post('/poputky/announce-draft')
    .send({
      role: 'driver',
      from: 'kyiv',
      to: 'malyn',
      date: '2026-04-10',
      time: '14:30',
      notes: 'тест',
      priceUah: 200,
    })
    .expect(200);
  assert.match(res.body.token, /^[a-f0-9]{16}$/);
  assert.match(res.body.deepLink, /^https:\/\/t\.me\//);
  assert.ok(res.body.deepLink.includes('driver_'));
});

test('POST /viber-listings: 401 без адмін-токена', async () => {
  const mock = createListingFlowPrismaMock();
  setTelegramPrismaForTests(mock);
  const app = createApp({ prisma: mock });
  await request(app).post('/viber-listings').send({ rawMessage: SAMPLE_VIBER_RAW }).expect(401);
});

test('POST /viber-listings: 201 з in-memory Prisma + tgPrisma', async () => {
  const mock = createListingFlowPrismaMock();
  setTelegramPrismaForTests(mock);
  const app = createApp({ prisma: mock });
  const res = await request(app)
    .post('/viber-listings')
    .set(ADMIN_AUTH)
    .send({ rawMessage: SAMPLE_VIBER_RAW })
    .expect(201);
  assert.equal(res.body.listingType, 'driver');
  assert.ok(res.body.id >= 800001);
  assert.equal(res.body.matchingRecheckTriggered, false);
  assert.equal(res.body.phone.replace(/\D/g, ''), EXAMPLE_PHONE_NORMALIZED);
});

test('POST /viber-listings: 400 якщо парсер не зміг розібрати', async () => {
  const mock = createListingFlowPrismaMock();
  setTelegramPrismaForTests(mock);
  const app = createApp({ prisma: mock });
  await request(app).post('/viber-listings').set(ADMIN_AUTH).send({ rawMessage: 'немає маршруту ні телефону' }).expect(400);
});

const runRealDb =
  process.env.RUN_INTEGRATION_TESTS === '1' &&
  Boolean(process.env.DATABASE_URL?.trim() || process.env.INTEGRATION_DATABASE_URL?.trim());

test(
  'POST /viber-listings: реальна БД (видаляємо лише створений ViberListing)',
  { skip: !runRealDb },
  async () => {
    const url = process.env.INTEGRATION_DATABASE_URL?.trim() || process.env.DATABASE_URL!.trim();
    const prisma = new PrismaClient({ datasources: { db: { url } } });
    setTelegramPrismaForTests(prisma);
    const app = createApp({ prisma });
    const y = new Date().getFullYear() + 1;
    const tail = String(Date.now() % 10_000_000).padStart(7, '0');
    const uniqueRaw = `[ 15 червня ${y} р. 12:00 ] ⁨DbInt⁩: Водій 15.06.${String(y).slice(2)}.
Київ(Академ)-Малин 100 грн.
11:30
+380 97 ${tail.slice(0, 3)} ${tail.slice(3, 5)} ${tail.slice(5)}`;
    try {
      const res = await request(app)
        .post('/viber-listings')
        .set(ADMIN_AUTH)
        .send({ rawMessage: uniqueRaw })
        .expect(201);
      const id = res.body.id as number;
      assert.ok(Number.isFinite(id));
      await prisma.viberListing.delete({ where: { id } });
    } finally {
      await prisma.$disconnect();
      resetTelegramPrismaForTests();
    }
  }
);
