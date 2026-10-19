/**
 * erasePerson (person-erase.ts): що видаляється, що знеособлюється, що лишається — на стабі, який записує
 * кожен виклик.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ERASED_PERSON_NAME, describeEraseResult, erasePerson, technicalPhoneForErased } from './person-erase';
import { isTechnicalPlaceholderPhone } from './telegram-contact';

const NOW = new Date('2026-10-20T10:00:00.000Z');

type Call = { model: string; op: string; args: unknown };

function makeStub(opts: { person: Record<string, unknown> | null; rows?: Partial<Record<string, unknown[]>> }) {
  const calls: Call[] = [];
  const rows: Record<string, unknown[]> = { ...(opts.rows ?? {}) };
  const record = (model: string, op: string) => async (args: unknown) => {
    calls.push({ model, op, args });
    if (op === 'findMany') return rows[model] ?? [];
    if (op === 'findUnique' || op === 'findFirst') return (rows[model] ?? [])[0] ?? null;
    if (op === 'deleteMany' || op === 'updateMany') return { count: (rows[model] ?? []).length };
    return {};
  };
  const model = (name: string) =>
    name === 'person'
      ? {
          findFirst: async () => opts.person,
          update: record('person', 'update'),
        }
      : {
          findMany: record(name, 'findMany'),
          findUnique: record(name, 'findUnique'),
          deleteMany: record(name, 'deleteMany'),
          updateMany: record(name, 'updateMany'),
          update: record(name, 'update'),
        };
  const tx = new Proxy({}, { get: (_t, prop: string) => (prop === 'then' ? undefined : model(prop)) });
  const prisma = {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  return { prisma, calls };
}

const PERSON = {
  id: 42,
  phoneNormalized: '380671234567',
  fullName: 'Іван Тест',
  telegramChatId: '555',
  telegramUserId: '123456789',
  telegramUsername: '@ivan_m',
};

const find = (calls: Call[], model: string, op: string) => calls.filter((c) => c.model === model && c.op === op);
const data = (c: Call) => (c.args as { data: Record<string, unknown> }).data;
const where = (c: Call) => (c.args as { where: Record<string, unknown> }).where;

test('технічний телефон: 12 цифр, 380000…, не впізнається як справжній', () => {
  assert.equal(technicalPhoneForErased(42), '380000000042');
  assert.equal(technicalPhoneForErased(123456), '380000123456');
  assert.ok(isTechnicalPlaceholderPhone(technicalPhoneForErased(42)));
  assert.ok(isTechnicalPlaceholderPhone('380010000003'));
  assert.ok(!isTechnicalPlaceholderPhone('380671234567'));
});

test('нема ані Person, ані рядків → null і жодного запису', async () => {
  const { prisma, calls } = makeStub({ person: null });
  assert.equal(await erasePerson(prisma, { telegramUserId: '7', now: NOW }), null);
  assert.equal(find(calls, 'person', 'update').length, 0);
  assert.equal(find(calls, 'booking', 'deleteMany').length, 0);
});

test('повне знеособлення Person і всього навколо', async () => {
  const { prisma, calls } = makeStub({
    person: PERSON,
    rows: {
      booking: [{ id: 1 }, { id: 2 }],
      viberListing: [{ id: 10 }, { id: 11 }],
      rideShareRequest: [{ id: 5 }],
      viberRideEvent: [{ id: 100 }],
      referralInvite: [{ id: 3 }],
      referralReward: [
        { id: 8, referrerId: 42, status: 'paid' },
        { id: 9, referrerId: 7, status: 'hold' },
        { id: 12, referrerId: 7, status: 'paid' },
      ],
      rideCompletionProof: [{ id: 2 }],
      dzhuraPerson: [{ id: 500, tgUserId: 123456789n }],
      dzhuraMessage: [{ id: 1 }, { id: 2 }, { id: 3 }],
      lunchParticipant: [{ id: 70 }],
    },
  });
  const r = await erasePerson(prisma, { telegramUserId: '123456789', now: NOW });
  assert.ok(r);
  assert.equal(r.personId, 42);
  assert.deepEqual(r.counts, {
    futureBookingsDeleted: 2,
    pastBookingsAnonymized: 2,
    listingsDeactivated: 2,
    rideShareRequestsExpired: 1,
    rideEventsAnonymized: 1,
    referralInvitesDeleted: 1,
    referralRewardsKept: 3,
    rideProofsDeleted: 1,
    capturedMessagesErased: 3,
    lunchParticipantAnonymized: true,
  });

  // Бронювання: майбутні за id — видалити; усі (personId або telegramUserId) — знеособити
  const futureFind = find(calls, 'booking', 'findMany')[0];
  assert.deepEqual(where(futureFind).OR, [{ personId: 42 }, { telegramUserId: '123456789' }]);
  assert.ok((where(futureFind).date as { gte: Date }).gte instanceof Date);
  assert.deepEqual(where(find(calls, 'booking', 'deleteMany')[0]), { id: { in: [1, 2] } });
  const anon = find(calls, 'booking', 'updateMany')[0];
  assert.deepEqual(data(anon), { name: ERASED_PERSON_NAME, phone: '380000000042', telegramChatId: null, telegramUserId: null });

  // Оголошення: зняті й без імені/телефону/тексту; відкриті запити → expired
  const listingUpd = find(calls, 'viberListing', 'updateMany')[0];
  assert.deepEqual(where(listingUpd), { id: { in: [10, 11] } });
  assert.equal(data(listingUpd).isActive, false);
  assert.equal(data(listingUpd).phone, '380000000042');
  assert.equal(data(listingUpd).rawMessage, '');
  assert.equal(data(find(calls, 'rideShareRequest', 'updateMany')[0]).status, 'expired');

  // Аналітика без прив'язки
  assert.deepEqual(data(find(calls, 'viberRideEvent', 'updateMany')[0]), { contactPhone: '380000000042', phoneNormalized: '380000000042', personId: null });

  // Рефералка: свої запрошення геть, чужі на мене — знеособити; гроші лишаються, другові — flagged
  assert.deepEqual(where(find(calls, 'referralInvite', 'deleteMany')[0]), { referrerId: 42 });
  assert.equal(data(find(calls, 'referralInvite', 'updateMany')[0]).referredPersonId, null);
  const rewardUpdates = find(calls, 'referralReward', 'updateMany');
  assert.deepEqual(where(rewardUpdates[0]), { id: { in: [8] } });
  assert.deepEqual(data(rewardUpdates[0]), { payoutNote: null });
  assert.deepEqual(where(rewardUpdates[1]), { id: { in: [9] } });
  assert.equal(data(rewardUpdates[1]).status, 'flagged');
  assert.equal(find(calls, 'referralReward', 'deleteMany').length, 0, 'нарахування не видаляються');
  assert.deepEqual(where(find(calls, 'rideCompletionProof', 'deleteMany')[0]), { personId: 42 });

  // Рядки без FK
  const pending = find(calls, 'pendingReferralCode', 'deleteMany');
  assert.deepEqual(where(pending[0]), { telegramChatId: '555' });
  assert.deepEqual(where(pending[1]), { referrerPersonId: 42 });
  assert.deepEqual(where(find(calls, 'telegramUserSendError', 'deleteMany')[0]), { contact: { in: ['380671234567', 'ivan_m', '@ivan_m'] } });
  assert.deepEqual(where(find(calls, 'smsSendLog', 'deleteMany')[0]), { phoneNormalized: '380671234567' });

  // Person: вичищений, не видалений, не заблокований
  const personUpd = find(calls, 'person', 'update')[0];
  assert.deepEqual((personUpd.args as { where: unknown }).where, { id: 42 });
  const pd = data(personUpd);
  assert.equal(pd.phoneNormalized, '380000000042');
  assert.equal(pd.fullName, null);
  assert.equal(pd.telegramUserId, null);
  assert.equal(pd.telegramChatId, null);
  assert.equal(pd.telegramUsername, null);
  assert.equal(pd.referralCode, null);
  assert.equal(pd.smsOptOut, true);
  assert.equal(pd.telegramBotBlockedAt, NOW);
  assert.equal(pd.dataArchivedAt, NOW);
  assert.ok(!('phoneBlockedAt' in pd), 'номер не забороняється');
  assert.equal(find(calls, 'person', 'delete').length, 0);

  // Джура: текст стерто, факт лишився; людина без імені
  const dz = find(calls, 'dzhuraMessage', 'updateMany')[0];
  assert.deepEqual(where(dz), { senderPersonId: 500 });
  assert.equal(data(dz).text, '');
  assert.equal(data(dz).rawJson, Prisma.DbNull);
  assert.equal(data(dz).deletedAt, NOW);
  assert.deepEqual(data(find(calls, 'dzhuraPerson', 'update')[0]), { firstName: null, lastName: null, username: null, phone: null });
  assert.equal(find(calls, 'dzhuraMessage', 'deleteMany').length, 0);

  // Обіди: замовлення лишаються, ім'я — ні
  assert.deepEqual(data(find(calls, 'lunchParticipant', 'update')[0]), { displayName: ERASED_PERSON_NAME, username: null });
  assert.equal(find(calls, 'lunchOrder', 'deleteMany').length, 0);

  assert.match(describeEraseResult(r), /скасовано майбутніх бронювань: 2; знято оголошень попуток: 2/);
  assert.match(describeEraseResult(r), /нарахування «Приведи друга» \(3\) лишаються/);
});

test('без Person: лише бронювання за telegramUserId і Джура', async () => {
  const { prisma, calls } = makeStub({
    person: null,
    rows: { booking: [{ id: 9 }], dzhuraPerson: [{ id: 501 }], dzhuraMessage: [{ id: 1 }] },
  });
  const r = await erasePerson(prisma, { telegramUserId: '777', now: NOW });
  assert.ok(r);
  assert.equal(r.personId, null);
  assert.equal(r.counts.futureBookingsDeleted, 1);
  assert.equal(r.counts.capturedMessagesErased, 1);
  assert.deepEqual(where(find(calls, 'booking', 'findMany')[0]).telegramUserId, '777');
  assert.equal(find(calls, 'viberListing', 'findMany').length, 0);
  assert.equal(find(calls, 'person', 'update').length, 0);
  assert.equal(describeEraseResult({ ...r, counts: { ...r.counts, futureBookingsDeleted: 0, pastBookingsAnonymized: 0, capturedMessagesErased: 0 } }), 'записів про вас не лишилося');
});
