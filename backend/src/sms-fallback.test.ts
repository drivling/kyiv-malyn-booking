/**
 * sendPaidFallbackSms: запобіжники для use-case 'inactivityReminder' (кнопка «Нагадати їм»).
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type { NotificationSettings, PrismaClient } from '@prisma/client';
import { sendPaidFallbackSms } from './sms-fallback';
import { setNotificationSettingsCacheForTests } from './notification-settings';
import { setSmsFetchForTests } from './sms-turbosms';

afterEach(() => {
  setNotificationSettingsCacheForTests(null);
  setSmsFetchForTests(null);
});

function settings(over: Partial<NotificationSettings> = {}): NotificationSettings {
  return {
    id: 1,
    smsFallbackEnabled: true,
    smsMatchEnabled: false,
    smsAuthorConfirmationEnabled: false,
    smsBookingReminderEnabled: false,
    smsInactivityReminderEnabled: true,
    smsMatchTypeThreshold: 'exact',
    smsDailyCap: 50,
    smsMonthlyCap: 1000,
    turboSmsToken: 'TKN',
    turboSmsSender: 'Malyn',
    updatedAt: new Date(),
    ...over,
  } as NotificationSettings;
}

let fetchCalls = 0;
function stubPrisma(): PrismaClient {
  return {
    person: { findUnique: async () => null },
    smsSendLog: {
      count: async () => 0,
      findFirst: async () => null,
      create: async () => ({ id: 1 }),
      update: async () => ({}),
    },
  } as unknown as PrismaClient;
}
function armFetch() {
  fetchCalls = 0;
  setSmsFetchForTests(async () => {
    fetchCalls += 1;
    return new Response(
      JSON.stringify({ response_code: 0, response_result: [{ response_code: 0, message_id: 'm1' }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
}

const ARGS = { phone: '0991383172', text: 'Давно не бачилися!', useCase: 'inactivityReminder' as const };

test('master вимкнено → не шлемо', async () => {
  setNotificationSettingsCacheForTests(settings({ smsFallbackEnabled: false }));
  armFetch();
  const r = await sendPaidFallbackSms(stubPrisma(), ARGS);
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'master_off');
  assert.equal(fetchCalls, 0);
});

test('прапорець реактивації вимкнено → не шлемо', async () => {
  setNotificationSettingsCacheForTests(settings({ smsInactivityReminderEnabled: false }));
  armFetch();
  const r = await sendPaidFallbackSms(stubPrisma(), ARGS);
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'usecase_off');
  assert.equal(fetchCalls, 0);
});

test('усе увімкнено → SMS відправляється', async () => {
  setNotificationSettingsCacheForTests(settings());
  armFetch();
  const r = await sendPaidFallbackSms(stubPrisma(), ARGS);
  assert.equal(r.sent, true);
  assert.equal(r.via, 'sms');
  assert.equal(fetchCalls, 1);
});
