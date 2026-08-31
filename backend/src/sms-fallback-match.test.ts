/**
 * Інтеграція: платний SMS-фолбек у match-сповіщеннях.
 * Обидва безкоштовні канали недоступні (немає бота, Telethon вимкнено) — перевіряємо,
 * що SMS шлеться лише коли всі запобіжники дозволяють.
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type { NotificationSettings, PrismaClient } from '@prisma/client';
import {
  notifyDriverAboutPassengerPair,
  resetTelegramPrismaForTests,
  setSendMatchMessageToPersonForTests,
  setTelegramPrismaForTests,
} from './telegram';
import { setNotificationSettingsCacheForTests } from './notification-settings';
import { setSmsFetchForTests } from './sms-turbosms';

const PASSENGER = {
  id: 200,
  route: 'Malyn-Kyiv',
  date: new Date('2026-09-01T00:00:00.000Z'),
  departureTime: '05:10',
  phone: '0501111111',
  senderName: 'Пас',
  notes: null,
};
const DRIVER = { id: 100, phone: '0679000000' };

function settings(overrides: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    id: 1,
    smsFallbackEnabled: true,
    smsMatchEnabled: true,
    smsAuthorConfirmationEnabled: true,
    smsBookingReminderEnabled: true,
    smsMatchTypeThreshold: 'exact',
    smsDailyCap: 50,
    smsMonthlyCap: 1000,
    turboSmsToken: 'TKN',
    turboSmsSender: 'Malyn',
    updatedAt: new Date(),
    ...overrides,
  } as NotificationSettings;
}

type StubOpts = { smsOptOut?: boolean; sendsToday?: number };

function installStub(opts: StubOpts = {}) {
  const calls = { pairUpsert: 0, logCreate: 0, logUpdate: 0 };
  setTelegramPrismaForTests({
    person: { findUnique: async () => (opts.smsOptOut ? { smsOptOut: true } : null) },
    booking: { findMany: async () => [] },
    viberMatchPairNotification: {
      findUnique: async () => null,
      upsert: async () => {
        calls.pairUpsert += 1;
        return {};
      },
    },
    smsSendLog: {
      count: async () => opts.sendsToday ?? 0,
      findFirst: async () => null,
      create: async () => {
        calls.logCreate += 1;
        return { id: 1 };
      },
      update: async () => {
        calls.logUpdate += 1;
        return {};
      },
    },
  } as unknown as PrismaClient);
  return calls;
}

let fetchCalls = 0;
function armFetch(ok = true) {
  fetchCalls = 0;
  setSmsFetchForTests(async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify(
        ok
          ? { response_code: 0, response_result: [{ response_code: 0, message_id: 'm1' }] }
          : { response_code: 0, response_result: [{ response_code: 800, response_status: 'err' }] }
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });
}

afterEach(() => {
  setSendMatchMessageToPersonForTests(null);
  setNotificationSettingsCacheForTests(null);
  setSmsFetchForTests(null);
  resetTelegramPrismaForTests();
});

test('master вимкнено → SMS не шлеться, outcome failed', async () => {
  installStub();
  setNotificationSettingsCacheForTests(settings({ smsFallbackEnabled: false }));
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'exact');
  assert.equal(fetchCalls, 0);
  assert.equal(out.kind, 'failed');
});

test('сценарій match вимкнено → SMS не шлеться', async () => {
  installStub();
  setNotificationSettingsCacheForTests(settings({ smsMatchEnabled: false }));
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'exact');
  assert.equal(fetchCalls, 0);
  assert.equal(out.kind, 'failed');
});

test('approximate під порогом exact → SMS не шлеться', async () => {
  installStub();
  setNotificationSettingsCacheForTests(settings({ smsMatchTypeThreshold: 'exact' }));
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'approximate');
  assert.equal(fetchCalls, 0);
  assert.equal(out.kind, 'failed');
});

test('approximate при порозі exact_approximate → SMS шлеться', async () => {
  const calls = installStub();
  setNotificationSettingsCacheForTests(settings({ smsMatchTypeThreshold: 'exact_approximate' }));
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'approximate');
  assert.equal(fetchCalls, 1);
  assert.equal(out.kind, 'sent');
  assert.equal(out.kind === 'sent' && out.via, 'sms');
  assert.equal(calls.pairUpsert, 1);
});

test('денний ліміт вичерпано → SMS не шлеться', async () => {
  installStub({ sendsToday: 50 });
  setNotificationSettingsCacheForTests(settings({ smsDailyCap: 50 }));
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'exact');
  assert.equal(fetchCalls, 0);
  assert.equal(out.kind, 'failed');
});

test('людина відписалась (smsOptOut) → SMS не шлеться', async () => {
  installStub({ smsOptOut: true });
  setNotificationSettingsCacheForTests(settings());
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'exact');
  assert.equal(fetchCalls, 0);
  assert.equal(out.kind, 'failed');
});

test('усі умови ОК, exact → SMS шлеться, лог і дедуп пари записані', async () => {
  const calls = installStub();
  setNotificationSettingsCacheForTests(settings());
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'exact');
  assert.equal(fetchCalls, 1);
  assert.equal(out.kind, 'sent');
  assert.equal(out.kind === 'sent' && out.via, 'sms');
  assert.equal(calls.logCreate, 1);
  assert.equal(calls.logUpdate, 1);
  assert.equal(calls.pairUpsert, 1);
});

test('same_day (forceBotOnly) → платний SMS ніколи не пробується', async () => {
  const calls = installStub();
  setNotificationSettingsCacheForTests(settings({ smsMatchTypeThreshold: 'all' }));
  armFetch();
  const out = await notifyDriverAboutPassengerPair(DRIVER, PASSENGER, 'same_day');
  assert.equal(fetchCalls, 0);
  assert.equal(out.kind, 'failed');
  assert.equal(calls.logCreate, 0);
});
