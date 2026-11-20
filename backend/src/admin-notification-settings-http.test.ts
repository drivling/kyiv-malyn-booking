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
      groupBy: async () => [
        { useCase: 'match', status: 'sent', _count: { _all: 4 } },
        { useCase: 'match', status: 'failed', _count: { _all: 1 } },
        { useCase: 'bookingReminder', status: 'skipped', _count: { _all: 2 } },
      ],
    },
    telegramUserSendLog: {
      groupBy: async () => [
        { purpose: 'match', ok: true, _count: { _all: 5 } },
        { purpose: 'match', ok: false, _count: { _all: 2 } },
        { purpose: 'authorConfirmation', ok: true, _count: { _all: 3 } },
      ],
    },
    telegramUserSendError: {
      findMany: async () => [
        { id: 1, contactType: 'user_id', errorCode: 2, errorText: 'Traceback…\nPeerFloodError: PEER_FLOOD', createdAt: new Date('2026-11-20T10:00:00Z') },
      ],
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
  // SMS за місяць по сценаріях: skipped не рахується ні туди, ні туди
  assert.deepEqual(res.body.smsByUseCase, { match: { sent: 4, failed: 1 }, bookingReminder: { sent: 0, failed: 0 } });
  const tg = res.body.telegramUser;
  assert.deepEqual(tg.month, { sent: 8, failed: 2 });
  assert.deepEqual(tg.byPurpose.match, { sent: 5, failed: 2 });
  assert.equal(tg.byId.enabled, true);
  assert.equal(tg.byId.cap, 20);
  assert.equal(tg.byId.lockedBy, null);
  // лише останній рядок помилки, без контакту
  assert.equal(tg.recentErrors[0].errorText, 'PeerFloodError: PEER_FLOOD');
  assert.equal(tg.recentErrors[0].contact, undefined);
});

test('PATCH /admin/notification-settings: вимикачі особистого акаунта й ліміт за id', async () => {
  const ctx = makeApp();
  const auth = await token(ctx.app);
  await request(ctx.app)
    .patch('/admin/notification-settings')
    .set('Authorization', auth)
    .send({ tgUserMatchEnabled: false, tgUserByIdDailyCap: 7 })
    .expect(200);
  assert.equal(ctx.row.tgUserMatchEnabled, false);
  assert.equal(ctx.row.tgUserByIdDailyCap, 7);
  await request(ctx.app).patch('/admin/notification-settings').set('Authorization', auth).send({ tgUserByIdDailyCap: null }).expect(200);
  assert.equal(ctx.row.tgUserByIdDailyCap, null);
  await request(ctx.app).patch('/admin/notification-settings').set('Authorization', auth).send({ tgUserByIdDailyCap: 5000 }).expect(400);
});
