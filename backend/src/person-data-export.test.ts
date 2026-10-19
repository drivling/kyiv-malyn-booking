/**
 * collectPersonData (person-data-export.ts): що входить у файл «мої дані», а що ні.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { collectPersonData, personDataExportFileName } from './person-data-export';

const NOW = new Date('2026-10-20T10:00:00.000Z');

type Rows = Partial<Record<string, unknown[]>>;

/** findMany/findFirst/findUnique повертають рядки з `rows[model]`; усе інше — помилка (лише читання). */
function stub(rows: Rows, person: Record<string, unknown> | null) {
  const calls: string[] = [];
  const model = (name: string) => ({
    findMany: async (args: { where?: Record<string, unknown> }) => {
      calls.push(`${name}.findMany`);
      const all = (rows[name] ?? []) as Array<Record<string, unknown>>;
      // мінімальна фільтрація за where.personId / telegramUserId / senderPersonId / participantId
      const w = args.where ?? {};
      return all.filter((row) => {
        for (const key of ['personId', 'telegramUserId', 'senderPersonId', 'participantId', 'referrerId', 'phoneNormalized']) {
          if (key in w && typeof w[key] !== 'object' && row[key] !== w[key]) return false;
        }
        return true;
      });
    },
    findFirst: async () => {
      calls.push(`${name}.findFirst`);
      return (rows[name] ?? [])[0] ?? null;
    },
    findUnique: async () => {
      calls.push(`${name}.findUnique`);
      return (rows[name] ?? [])[0] ?? null;
    },
  });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === 'person') return { findFirst: async () => person };
        if (prop === 'then') return undefined;
        return model(prop);
      },
    },
  ) as unknown as PrismaClient;
  return { prisma, calls };
}

const PERSON = {
  id: 42,
  phoneNormalized: '380671234567',
  fullName: 'Іван Тест',
  telegramChatId: '555',
  telegramUserId: '123456789',
  telegramUsername: 'ivan_m',
  smsOptOut: false,
  phoneBlockedAt: null,
  referralCode: 'REF42',
  referredByPersonId: 7,
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
};

test('ім\'я файла з датою експорту', () => {
  assert.equal(personDataExportFileName(NOW), 'malin-kiev-ua-my-data-2026-10-20.json');
});

test('нема ні Person, ні рядків → null', async () => {
  const { prisma } = stub({}, null);
  assert.equal(await collectPersonData(prisma, { telegramUserId: '1', now: NOW }), null);
});

test('повний файл: Person без chatId, бронювання з ім\'ям водія без його телефону, оголошення, рефералка, Джура, обіди, SMS', async () => {
  const { prisma, calls } = stub(
    {
      booking: [
        {
          id: 1, route: 'Kyiv-Malyn', date: new Date('2026-10-25T00:00:00.000Z'), departureTime: '18:00', seats: 2, name: 'Іван', phone: '0671234567',
          source: 'viber_match', createdAt: NOW, personId: 42, telegramUserId: '123456789',
          reminders: [{ kind: 'evening', delivered: 'bot', sentAt: NOW }],
          viberListing: { senderName: 'Петро', phone: '380999999999' },
        },
      ],
      viberListing: [
        {
          id: 10, listingType: 'driver', route: 'Malyn-Kyiv', date: new Date('2026-10-26T00:00:00.000Z'), departureTime: '07:00', seats: 3, priceUah: 200,
          notes: null, senderName: 'Іван', phone: '380671234567', rawMessage: 'Малин-Київ 07:00, 3 місця 0671234567', source: 'telegram1', isActive: true,
          createdAt: NOW, personId: 42, sourceChat: 'PoDoroguem', sourceMessageId: 77,
          rideShareRequestsAsPassenger: [], rideShareRequestsAsDriver: [{ id: 5, status: 'pending', createdAt: NOW }],
        },
      ],
      viberRideEvent: [{ id: 100, personId: 42, route: 'Kyiv-Malyn', departureDate: NOW, departureTime: '18:00', availableSeats: 1, priceUah: null, isParsed: true, createdAt: NOW, contactPhone: '0671234567' }],
      referralInvite: [{ id: 3, referrerId: 42, inviteType: 'phone', inviteContact: '0501112233', status: 'pending', registeredAt: null, createdAt: NOW }],
      referralReward: [
        { id: 8, referrerId: 42, referredPersonId: 9, rewardType: 'registration', amountUah: 10, status: 'paid', createdAt: NOW, paidAt: NOW, payoutNote: 'картка 04.08' },
        { id: 9, referrerId: 7, referredPersonId: 42, rewardType: 'registration', amountUah: 10, status: 'hold', createdAt: NOW, paidAt: null },
      ],
      rideCompletionProof: [{ id: 2, personId: 42, route: 'Kyiv-Malyn', rideDate: NOW, departureTime: '18:00', status: 'approved', createdAt: NOW, photoStartFileId: 'f1' }],
      dzhuraPerson: [{ id: 500, tgUserId: 123456789n, accessHash: 1n }],
      dzhuraMessage: [{ senderPersonId: 500, sentAt: NOW, editedAt: null, text: 'Їду в Київ завтра', mediaKind: null, chat: { title: 'PoDoroguem' } }],
      lunchParticipant: [{ id: 70, telegramUserId: '123456789', displayName: 'Іван' }],
      lunchOrder: [{ participantId: 70, rawText: 'борщ', totalUah: 120, status: 'active', day: { date: new Date('2026-10-19T00:00:00.000Z') } }],
      lunchPayment: [{ participantId: 70, amountUah: 120, day: { date: new Date('2026-10-19T00:00:00.000Z') } }],
      smsSendLog: [{ phoneNormalized: '380671234567', useCase: 'match', status: 'sent', createdAt: NOW }],
    },
    PERSON,
  );
  const data = await collectPersonData(prisma, { telegramUserId: '123456789', now: NOW });
  assert.ok(data);
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.exportedAt, NOW.toISOString());
  assert.deepEqual(data.person, {
    id: 42, fullName: 'Іван Тест', phone: '380671234567', telegramUsername: 'ivan_m', createdAt: '2026-01-15T10:00:00.000Z',
    smsOptOut: false, phoneBlocked: false, referralCode: 'REF42', invitedByFriend: true,
  });
  assert.equal(data.bookings.length, 1);
  assert.equal(data.bookings[0].driverName, 'Петро');
  assert.deepEqual(data.bookings[0].reminders, [{ kind: 'evening', delivered: 'bot', sentAt: NOW.toISOString() }]);
  assert.equal(data.listings[0].message, 'Малин-Київ 07:00, 3 місця 0671234567');
  assert.deepEqual(data.listings[0].rideShareRequests, [{ id: 5, role: 'driver', status: 'pending', createdAt: NOW.toISOString() }]);
  assert.equal(data.rideEvents[0].seats, 1);
  assert.equal(data.referral.invitesSent[0].inviteType, 'phone');
  assert.equal(data.referral.rewardsAsReferrer.length, 1);
  assert.equal(data.referral.rewardsForFriendsCount, 1);
  assert.equal(data.referral.rideProofs[0].status, 'approved');
  assert.deepEqual(data.capturedMessages, [{ chat: 'PoDoroguem', sentAt: NOW.toISOString(), editedAt: null, text: 'Їду в Київ завтра', mediaKind: null }]);
  assert.equal(data.lunch?.orders[0].text, 'борщ');
  assert.equal(data.lunch?.payments[0].amountUah, 120);
  assert.deepEqual(data.smsSent, [{ useCase: 'match', status: 'sent', createdAt: NOW.toISOString() }]);

  // Чужого й службового у файлі нема
  const json = JSON.stringify(data);
  assert.doesNotMatch(json, /380999999999/, 'телефон водія');
  assert.doesNotMatch(json, /0501112233/, 'контакт запрошеного друга');
  assert.doesNotMatch(json, /"telegramChatId"|"555"/, 'chat id');
  assert.doesNotMatch(json, /accessHash|payoutNote|картка|photoStartFileId|sourceChat|sourceMessageId/, 'службові поля');
  assert.ok(calls.includes('dzhuraMessage.findMany'));
});

test('без Person, але з бронюванням за telegramUserId — файл лише з бронювань', async () => {
  const { prisma } = stub(
    { booking: [{ id: 2, route: 'Kyiv-Malyn', date: NOW, departureTime: '10:00', seats: 1, name: 'Оля', phone: '0931112233', source: 'schedule', createdAt: NOW, telegramUserId: '5', reminders: [], viberListing: null }] },
    null,
  );
  const data = await collectPersonData(prisma, { telegramUserId: '5', now: NOW });
  assert.ok(data);
  assert.equal(data.person, null);
  assert.equal(data.bookings.length, 1);
  assert.equal(data.bookings[0].driverName, null);
  assert.deepEqual(data.listings, []);
  assert.equal(data.lunch, null);
});
