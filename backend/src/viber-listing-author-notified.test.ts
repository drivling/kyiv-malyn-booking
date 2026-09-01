/**
 * Одне сповіщення автору на оголошення: sendViberListingConfirmationToUser не спамить,
 * якщо ViberListing.authorNotifiedAt уже стоїть, і ставить його після реальної доставки.
 */
import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  sendViberListingConfirmationToUser,
  setTelegramPrismaForTests,
  resetTelegramPrismaForTests,
  resetTelegramBotForTests,
  resetSpawnForTests,
} from './telegram';
import { setNotificationSettingsCacheForTests } from './notification-settings';
import { setSmsFetchForTests } from './sms-turbosms';

afterEach(() => {
  resetTelegramPrismaForTests();
  resetTelegramBotForTests();
  resetSpawnForTests();
  setNotificationSettingsCacheForTests(null);
  setSmsFetchForTests(null);
});

const LISTING = {
  id: 77,
  route: 'Kyiv-Malyn',
  date: new Date('2026-09-05T00:00:00.000Z'),
  departureTime: '08:00',
  seats: null,
  listingType: 'driver' as const,
};

function baseSettings(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    smsFallbackEnabled: false,
    smsMatchEnabled: false,
    smsAuthorConfirmationEnabled: false,
    smsBookingReminderEnabled: false,
    smsMatchTypeThreshold: 'exact',
    smsDailyCap: 50,
    smsMonthlyCap: 1000,
    turboSmsToken: null,
    turboSmsSender: null,
    updatedAt: new Date(),
    ...over,
  } as never;
}

test('пропускає відправку, якщо authorNotifiedAt уже стоїть', async () => {
  const listingFindUnique = vi.fn(async () => ({ authorNotifiedAt: new Date('2026-09-01T10:00:00Z') }));
  const listingUpdate = vi.fn(async () => ({}));
  const personFindUnique = vi.fn(async () => null);
  setTelegramPrismaForTests({
    viberListing: { findUnique: listingFindUnique, update: listingUpdate },
    person: { findUnique: personFindUnique },
    booking: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient);
  setNotificationSettingsCacheForTests(baseSettings());

  await sendViberListingConfirmationToUser('0501112233', LISTING);

  assert.equal(listingFindUnique.mock.calls.length, 1);
  assert.equal(personFindUnique.mock.calls.length, 0); // до каналів навіть не дійшли
  assert.equal(listingUpdate.mock.calls.length, 0);
});

test('автор недосяжний — authorNotifiedAt НЕ ставиться', async () => {
  const listingUpdate = vi.fn(async () => ({}));
  setTelegramPrismaForTests({
    viberListing: { findUnique: vi.fn(async () => ({ authorNotifiedAt: null })), update: listingUpdate },
    person: { findUnique: vi.fn(async () => null) },
    booking: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaClient);
  setNotificationSettingsCacheForTests(baseSettings()); // платний фолбек вимкнено

  await sendViberListingConfirmationToUser('0501112233', LISTING);

  assert.equal(listingUpdate.mock.calls.length, 0);
});

test('доставлено платним SMS — authorNotifiedAt ставиться', async () => {
  const listingUpdate = vi.fn(async () => ({}));
  setTelegramPrismaForTests({
    viberListing: { findUnique: vi.fn(async () => ({ authorNotifiedAt: null })), update: listingUpdate },
    person: { findUnique: vi.fn(async () => null) },
    booking: { findMany: vi.fn(async () => []) },
    smsSendLog: {
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 1 })),
      update: vi.fn(async () => ({})),
    },
  } as unknown as PrismaClient);
  setNotificationSettingsCacheForTests(
    baseSettings({
      smsFallbackEnabled: true,
      smsAuthorConfirmationEnabled: true,
      turboSmsToken: 'TKN',
      turboSmsSender: 'Malyn',
    }),
  );
  setSmsFetchForTests(async () =>
    new Response(
      JSON.stringify({ response_code: 0, response_result: [{ response_code: 0, message_id: 'm1' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );

  await sendViberListingConfirmationToUser('0501112233', LISTING);

  assert.equal(listingUpdate.mock.calls.length, 1);
  const arg = listingUpdate.mock.calls[0]![0] as { where: { id: number }; data: { authorNotifiedAt: Date } };
  assert.equal(arg.where.id, 77);
  assert.ok(arg.data.authorNotifiedAt instanceof Date);
});
