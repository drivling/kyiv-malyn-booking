/**
 * HTTP: /admin/notification-settings (auth, маскування токена, PATCH, usage).
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';
import { setNotificationSettingsCacheForTests } from './notification-settings';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-x7';

afterEach(() => setNotificationSettingsCacheForTests(null));

const BASE_ROW = {
  id: 1,
  smsFallbackEnabled: false,
  smsMatchEnabled: false,
  smsAuthorConfirmationEnabled: false,
  smsBookingReminderEnabled: false,
  smsInactivityReminderEnabled: false,
  smsChannelPromoEnabled: false,
  smsMatchTypeThreshold: 'exact',
  smsDailyCap: 50,
  smsMonthlyCap: 1000,
  turboSmsToken: 'secret-turbo-token-1234',
  turboSmsSender: 'Malyn',
  updatedAt: new Date(),
};

function makeApp(initial: Partial<typeof BASE_ROW> = {}) {
  let row = { ...BASE_ROW, ...initial };
  const upsertArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    notificationSettings: {
      upsert: async (args: { update: Record<string, unknown> }) => {
        upsertArgs.push(args.update);
        row = { ...row, ...args.update };
        return { ...row };
      },
    },
    smsSendLog: {
      count: async () => 3,
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
  const app = createApp({ prisma, adminPassword: TEST_ADMIN_PASSWORD });
  return { app, upsertArgs, get row() { return row; } };
}

async function token(app: ReturnType<typeof createApp>) {
  const login = await request(app).post('/admin/login').send({ password: TEST_ADMIN_PASSWORD }).expect(200);
  return String(login.body.token);
}

test('GET /admin/notification-settings: 401 без токена', async () => {
  const { app } = makeApp();
  await request(app).get('/admin/notification-settings').expect(401);
});

test('GET /admin/notification-settings: маскує токен', async () => {
  const { app } = makeApp();
  const res = await request(app)
    .get('/admin/notification-settings')
    .set('Authorization', await token(app))
    .expect(200);
  assert.equal(res.body.turboSmsToken, undefined);
  assert.equal(res.body.hasToken, true);
  assert.equal(res.body.tokenHint, '••••1234');
  assert.equal(res.body.smsMatchTypeThreshold, 'exact');
});

test('PATCH: зберігає прапорці', async () => {
  const h = makeApp();
  const res = await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', await token(h.app))
    .send({ smsFallbackEnabled: true, smsMatchEnabled: true })
    .expect(200);
  assert.equal(res.body.smsFallbackEnabled, true);
  assert.equal(res.body.smsMatchEnabled, true);
  assert.equal(h.upsertArgs.at(-1)?.smsFallbackEnabled, true);
});

test('PATCH: прапорець реактивації (smsInactivityReminderEnabled)', async () => {
  const h = makeApp();
  const res = await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', await token(h.app))
    .send({ smsInactivityReminderEnabled: true })
    .expect(200);
  assert.equal(res.body.smsInactivityReminderEnabled, true);
  assert.equal(h.upsertArgs.at(-1)?.smsInactivityReminderEnabled, true);
});

test('PATCH: прапорець реклами каналу (smsChannelPromoEnabled)', async () => {
  const h = makeApp();
  const res = await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', await token(h.app))
    .send({ smsChannelPromoEnabled: true })
    .expect(200);
  assert.equal(res.body.smsChannelPromoEnabled, true);
  assert.equal(h.upsertArgs.at(-1)?.smsChannelPromoEnabled, true);
});

test('PATCH: порожній/маскований токен не перезаписує наявний', async () => {
  const h = makeApp();
  const tok = await token(h.app);

  await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', tok)
    .send({ turboSmsToken: '', smsMatchEnabled: true })
    .expect(200);
  assert.equal('turboSmsToken' in (h.upsertArgs.at(-1) ?? {}), false);
  assert.equal(h.row.turboSmsToken, 'secret-turbo-token-1234');

  await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', tok)
    .send({ turboSmsToken: '••••1234' })
    .expect(200);
  assert.equal(h.row.turboSmsToken, 'secret-turbo-token-1234');

  await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', tok)
    .send({ turboSmsToken: 'brand-new-token' })
    .expect(200);
  assert.equal(h.row.turboSmsToken, 'brand-new-token');
});

test('PATCH: невалідний поріг → 400', async () => {
  const h = makeApp();
  await request(h.app)
    .patch('/admin/notification-settings')
    .set('Authorization', await token(h.app))
    .send({ smsMatchTypeThreshold: 'whenever' })
    .expect(400);
});

test('GET /admin/notification-settings/usage: форма відповіді', async () => {
  const { app } = makeApp();
  const res = await request(app)
    .get('/admin/notification-settings/usage')
    .set('Authorization', await token(app))
    .expect(200);
  assert.equal(res.body.sentToday, 3);
  assert.equal(res.body.capToday, 50);
  assert.equal(res.body.sentThisMonth, 3);
  assert.equal(res.body.capThisMonth, 1000);
  assert.ok(Array.isArray(res.body.recent));
});
