/**
 * HTTP: заборона номера (PUT /admin/persons/:id) та архівація даних
 * (POST /admin/persons/:id/archive, GET /admin/person-archives).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './create-app';

const TEST_ADMIN_PASSWORD = 'http-test-admin-password-x7';
const AUTH = 'admin-authenticated';

const BASE_PERSON = {
  id: 42,
  phoneNormalized: '380679551952',
  fullName: 'Тест Тестович',
  telegramChatId: '123456789',
  telegramUserId: '123456789',
  telegramUsername: 'testuser',
  telegramPromoSentAt: null as Date | null,
  telegramReminderSentAt: null as Date | null,
  telegramBotBlockedAt: null as Date | null,
  smsOptOut: false,
  phoneBlockedAt: null as Date | null,
  phoneBlockReason: null as string | null,
  blockedAttemptAt: null as Date | null,
  blockedAttemptCount: 0,
  dataArchivedAt: null as Date | null,
  referralCode: 'REF42',
  referredByPersonId: null as number | null,
  referralRegistrationBonusEligible: null as boolean | null,
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
  updatedAt: new Date('2026-01-15T10:00:00.000Z'),
};

type Call = { model: string; op: string; args: unknown };

/**
 * Стаб, що записує кожен виклик у `calls` — так можна перевірити не лише результат,
 * а й ПОРЯДОК операцій (архів до видалень, Booking до ViberListing).
 */
function makeApp(overrides: Partial<typeof BASE_PERSON> = {}, seed: Record<string, unknown[]> = {}) {
  const person = { ...BASE_PERSON, ...overrides };
  const calls: Call[] = [];
  const rows: Record<string, unknown[]> = {
    booking: [],
    viberListing: [],
    viberRideEvent: [],
    rideCompletionProof: [],
    referralInvite: [],
    referralReward: [],
    rideShareRequest: [],
    viberMatchPairNotification: [],
    smsSendLog: [],
    telegramUserSendError: [],
    pendingReferralCode: [],
    ...seed,
  };

  const record = (model: string, op: string) => async (args: unknown) => {
    calls.push({ model, op, args });
    if (op === 'findMany') return rows[model] ?? [];
    if (op === 'deleteMany' || op === 'updateMany') return { count: (rows[model] ?? []).length };
    return {};
  };

  const model = (name: string) => ({
    findMany: record(name, 'findMany'),
    deleteMany: record(name, 'deleteMany'),
    updateMany: record(name, 'updateMany'),
  });

  const prisma = {
    person: {
      findUnique: async () => person,
      update: async (args: unknown) => {
        calls.push({ model: 'person', op: 'update', args });
        return { ...person, ...(args as { data: object }).data };
      },
      delete: async (args: unknown) => {
        calls.push({ model: 'person', op: 'delete', args });
        return person;
      },
      findMany: async () => [person],
    },
    personDataArchive: {
      create: async (args: unknown) => {
        calls.push({ model: 'personDataArchive', op: 'create', args });
        return { id: 5 };
      },
      findMany: record('personDataArchive', 'findMany'),
      findUnique: async () => (rows.personDataArchive ?? [])[0] ?? null,
    },
    booking: model('booking'),
    viberListing: model('viberListing'),
    viberRideEvent: model('viberRideEvent'),
    rideCompletionProof: model('rideCompletionProof'),
    referralInvite: model('referralInvite'),
    referralReward: model('referralReward'),
    rideShareRequest: model('rideShareRequest'),
    viberMatchPairNotification: model('viberMatchPairNotification'),
    smsSendLog: model('smsSendLog'),
    telegramUserSendError: model('telegramUserSendError'),
    pendingReferralCode: model('pendingReferralCode'),
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  } as unknown as PrismaClient;

  return { app: createApp({ prisma, adminPassword: TEST_ADMIN_PASSWORD }), calls, person };
}

const find = (calls: Call[], model: string, op: string) => calls.find((c) => c.model === model && c.op === op);
const indexOf = (calls: Call[], model: string, op: string) =>
  calls.findIndex((c) => c.model === model && c.op === op);
const dataOf = (c: Call | undefined) => (c?.args as { data: Record<string, unknown> } | undefined)?.data;

// ---------- auth ----------

test('нові ендпоінти вимагають адмін-токен', async () => {
  const { app } = makeApp();
  await request(app).post('/admin/persons/42/archive').send({ reason: 'скарга' }).expect(401);
  await request(app).get('/admin/person-archives').expect(401);
  await request(app).get('/admin/person-archives/5').expect(401);
});

// ---------- заборона номера ----------

test('PUT: увімкнення заборони ставить прапорець і глушить сповіщення', async () => {
  const { app, calls } = makeApp();
  await request(app)
    .put('/admin/persons/42')
    .set('Authorization', AUTH)
    .send({ phoneBlocked: true, phoneBlockReason: 'скарга пасажира' })
    .expect(200);

  const data = dataOf(find(calls, 'person', 'update'))!;
  assert.ok(data.phoneBlockedAt instanceof Date, 'phoneBlockedAt має бути виставлений');
  assert.equal(data.phoneBlockReason, 'скарга пасажира');
  assert.equal(data.smsOptOut, true);
  assert.equal(data.telegramChatId, null);
  assert.equal(data.telegramUserId, null);
});

test('PUT: увімкнення заборони ховає активні оголошення з сайту', async () => {
  const { app, calls } = makeApp();
  await request(app)
    .put('/admin/persons/42')
    .set('Authorization', AUTH)
    .send({ phoneBlocked: true, phoneBlockReason: 'скарга' })
    .expect(200);

  const hide = calls.find(
    (c) => c.model === 'viberListing' && c.op === 'updateMany' && dataOf(c)?.isActive === false,
  );
  assert.ok(hide, 'активні оголошення мають бути деактивовані');
  assert.deepEqual((hide!.args as { where: unknown }).where, { personId: 42, isActive: true });
});

test('PUT: повторне збереження вже заблокованої персони не перезапускає приховування', async () => {
  const { app, calls } = makeApp({ phoneBlockedAt: new Date('2026-09-01T00:00:00Z') });
  await request(app)
    .put('/admin/persons/42')
    .set('Authorization', AUTH)
    .send({ phoneBlocked: true, phoneBlockReason: 'та сама скарга' })
    .expect(200);

  const hide = calls.find(
    (c) => c.model === 'viberListing' && c.op === 'updateMany' && dataOf(c)?.isActive === false,
  );
  assert.equal(hide, undefined, 'на повторному збереженні оголошення не чіпаємо');
});

test('PUT: зняття заборони обнуляє прапорець і лічильник спроб, але не вмикає оголошення', async () => {
  const { app, calls } = makeApp({
    phoneBlockedAt: new Date('2026-09-01T00:00:00Z'),
    phoneBlockReason: 'стара скарга',
    blockedAttemptCount: 4,
  });
  await request(app)
    .put('/admin/persons/42')
    .set('Authorization', AUTH)
    .send({ phoneBlocked: false })
    .expect(200);

  const data = dataOf(find(calls, 'person', 'update'))!;
  assert.equal(data.phoneBlockedAt, null);
  assert.equal(data.phoneBlockReason, null);
  assert.equal(data.blockedAttemptCount, 0);

  const reactivate = calls.find(
    (c) => c.model === 'viberListing' && c.op === 'updateMany' && dataOf(c)?.isActive === true,
  );
  assert.equal(reactivate, undefined, 'оголошення назад на сайт не повертаємо');
});

// ---------- архівація ----------

test('POST /archive: потрібна причина', async () => {
  const { app } = makeApp();
  await request(app).post('/admin/persons/42/archive').set('Authorization', AUTH).send({}).expect(400);
  await request(app)
    .post('/admin/persons/42/archive')
    .set('Authorization', AUTH)
    .send({ reason: '  ' })
    .expect(400);
});

test('POST /archive: знімок пишеться ДО видалень, Booking — перед ViberListing', async () => {
  const { app, calls } = makeApp(
    {},
    {
      booking: [{ id: 1 }, { id: 2 }],
      viberListing: [{ id: 10 }],
      viberRideEvent: [{ id: 100 }],
    },
  );
  const res = await request(app)
    .post('/admin/persons/42/archive')
    .set('Authorization', AUTH)
    .send({ reason: 'скарга від 11.09' })
    .expect(200);

  assert.equal(res.body.archiveId, 5);
  assert.equal(res.body.counts.bookings, 2);
  assert.equal(res.body.counts.viberListings, 1);

  const archiveAt = indexOf(calls, 'personDataArchive', 'create');
  const bookingDel = indexOf(calls, 'booking', 'deleteMany');
  const listingDel = indexOf(calls, 'viberListing', 'deleteMany');

  assert.ok(archiveAt >= 0 && bookingDel >= 0 && listingDel >= 0);
  // Booking.viberListingId — onDelete: SetNull, тож оголошення не можна видаляти першими.
  assert.ok(bookingDel < listingDel, 'Booking має видалятися перед ViberListing');

  const payload = (find(calls, 'personDataArchive', 'create')!.args as { data: { payload: { bookings: unknown[] } } })
    .data.payload;
  assert.equal(payload.bookings.length, 2, 'знімок зроблено до видалення');
});

test('POST /archive: Person вичищається, але НЕ видаляється', async () => {
  const { app, calls } = makeApp();
  await request(app)
    .post('/admin/persons/42/archive')
    .set('Authorization', AUTH)
    .send({ reason: 'скарга' })
    .expect(200);

  assert.equal(find(calls, 'person', 'delete'), undefined, 'Person видаляти не можна — він носій заборони');

  const data = dataOf(find(calls, 'person', 'update'))!;
  assert.equal(data.fullName, null);
  assert.equal(data.telegramChatId, null);
  assert.equal(data.telegramUsername, null);
  assert.equal(data.referralCode, null);
  assert.ok(data.dataArchivedAt instanceof Date);
  // Архівація завжди означає заборону
  assert.ok(data.phoneBlockedAt instanceof Date);
  assert.equal(data.smsOptOut, true);
});

test('POST /archive: виплачені нарахування лишаються, але знеособлюються', async () => {
  const { app, calls } = makeApp(
    {},
    {
      referralReward: [
        { id: 1, referrerId: 42, referredPersonId: 7, status: 'paid', amountUah: 30, payoutNote: 'картка Приват' },
        { id: 2, referrerId: 42, referredPersonId: 8, status: 'hold', amountUah: 10, payoutNote: null },
        { id: 3, referrerId: 9, referredPersonId: 42, status: 'paid', amountUah: 30, payoutNote: 'картка іншого' },
        { id: 4, referrerId: 9, referredPersonId: 42, status: 'approved', amountUah: 10, payoutNote: null },
      ],
    },
  );
  const res = await request(app)
    .post('/admin/persons/42/archive')
    .set('Authorization', AUTH)
    .send({ reason: 'скарга' })
    .expect(200);

  // Власне виплачене — лишається, але без реквізитів
  const anonymize = calls.find(
    (c) => c.model === 'referralReward' && c.op === 'updateMany' && dataOf(c)?.payoutNote === null,
  );
  assert.ok(anonymize, 'виплачені нарахування мають знеособлюватися, а не зникати');
  assert.deepEqual((anonymize!.args as { where: { id: { in: number[] } } }).where.id.in, [1]);

  // Власне невиплачене — видаляється
  const del = find(calls, 'referralReward', 'deleteMany');
  assert.deepEqual((del!.args as { where: { id: { in: number[] } } }).where.id.in, [2]);

  // Чуже невиплачене — позначається, не видаляється
  const flag = calls.find(
    (c) => c.model === 'referralReward' && c.op === 'updateMany' && dataOf(c)?.status === 'flagged',
  );
  assert.ok(flag, 'нарахування іншої людини не видаляємо');
  assert.deepEqual((flag!.args as { where: { id: { in: number[] } } }).where.id.in, [4]);

  assert.equal(res.body.counts.referralRewardsKeptPaid, 1);
  assert.equal(res.body.counts.referralRewardsDeleted, 1);
});

test('GET /admin/person-archives: список без payload', async () => {
  const { app, calls } = makeApp({}, { personDataArchive: [{ id: 5, phoneNormalized: '380679551952' }] });
  await request(app).get('/admin/person-archives').set('Authorization', AUTH).expect(200);

  const select = (find(calls, 'personDataArchive', 'findMany')!.args as { select: Record<string, boolean> }).select;
  assert.equal(select.payload, undefined, 'payload у списку не віддаємо — він великий');
  assert.equal(select.phoneNormalized, true);
});
