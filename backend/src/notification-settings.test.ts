/**
 * Юніт-тести notification-settings: лінива ініціалізація, кеш, валідація, фільтр токена.
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  getNotificationSettings,
  updateNotificationSettings,
  setNotificationSettingsCacheForTests,
} from './notification-settings';

afterEach(() => setNotificationSettingsCacheForTests(null));

const DEFAULT_ROW = {
  id: 1,
  smsFallbackEnabled: false,
  smsMatchEnabled: false,
  smsAuthorConfirmationEnabled: false,
  smsBookingReminderEnabled: false,
  smsMatchTypeThreshold: 'exact',
  smsDailyCap: 50,
  smsMonthlyCap: 1000,
  turboSmsToken: null as string | null,
  turboSmsSender: null as string | null,
  updatedAt: new Date(),
};

function makeStub() {
  const calls = { upsert: 0 };
  let row = { ...DEFAULT_ROW };
  const prisma = {
    notificationSettings: {
      upsert: async ({ update }: { update: Record<string, unknown> }) => {
        calls.upsert += 1;
        row = { ...row, ...update };
        return { ...row };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, calls, get row() { return row; } };
}

test('getNotificationSettings: лінива ініціалізація з дефолтами', async () => {
  const s = makeStub();
  const v = await getNotificationSettings(s.prisma);
  assert.equal(v.smsFallbackEnabled, false);
  assert.equal(v.smsMatchTypeThreshold, 'exact');
  assert.equal(v.smsDailyCap, 50);
  assert.equal(s.calls.upsert, 1);
});

test('getNotificationSettings: кеш у межах TTL — один upsert', async () => {
  const s = makeStub();
  await getNotificationSettings(s.prisma);
  await getNotificationSettings(s.prisma);
  assert.equal(s.calls.upsert, 1);
});

test('updateNotificationSettings: скидає кеш → наступний read б’є в БД', async () => {
  const s = makeStub();
  await getNotificationSettings(s.prisma);
  await updateNotificationSettings(s.prisma, { smsFallbackEnabled: true });
  const v = await getNotificationSettings(s.prisma);
  assert.equal(v.smsFallbackEnabled, true);
  // 1 (перший get) + 1 (update) + 1 (get після скидання кешу)
  assert.equal(s.calls.upsert, 3);
});

test('updateNotificationSettings: валідація порогу і лімітів', async () => {
  const s = makeStub();
  await assert.rejects(() => updateNotificationSettings(s.prisma, { smsMatchTypeThreshold: 'nope' }));
  await assert.rejects(() => updateNotificationSettings(s.prisma, { smsDailyCap: -1 }));
  await assert.rejects(() => updateNotificationSettings(s.prisma, { smsMonthlyCap: 10_000_000 }));
  await assert.rejects(() => updateNotificationSettings(s.prisma, { turboSmsSender: 'TooLongSender' }));
});

test('updateNotificationSettings: токен пишеться лише коли переданий', async () => {
  const s = makeStub();
  await updateNotificationSettings(s.prisma, { smsMatchEnabled: true });
  assert.equal(s.row.turboSmsToken, null); // патч без токена не чіпає його

  await updateNotificationSettings(s.prisma, { turboSmsToken: 'REAL-TOKEN' });
  assert.equal(s.row.turboSmsToken, 'REAL-TOKEN');

  // null = явне очищення
  await updateNotificationSettings(s.prisma, { turboSmsToken: null });
  assert.equal(s.row.turboSmsToken, null);
});
