/**
 * Повідомлення про збіг попутників (бот/Telethon + SMS-фолбек): іншу людину
 * називаємо лише за іменем, без прізвища.
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  notifyDriverAboutPassengerPair,
  notifyPassengerAboutDriverPair,
  resetTelegramPrismaForTests,
  setSendMatchMessageToPersonForTests,
  setTelegramPrismaForTests,
} from './telegram';

type Captured = { phone: string; html: string; options: Record<string, unknown> | undefined };

function installStub(): Captured[] {
  setTelegramPrismaForTests({
    viberMatchPairNotification: {
      findUnique: async () => null,
      upsert: async () => ({}),
    },
  } as unknown as PrismaClient);
  const captured: Captured[] = [];
  setSendMatchMessageToPersonForTests(async (phone, html, options) => {
    captured.push({ phone, html, options: options as Record<string, unknown> | undefined });
    return { sent: true, via: 'bot' };
  });
  return captured;
}

afterEach(() => {
  setSendMatchMessageToPersonForTests(null);
  resetTelegramPrismaForTests();
});

test('водію про пасажира: лише ім’я у тексті, кнопці та SMS', async () => {
  const captured = installStub();
  const out = await notifyDriverAboutPassengerPair(
    { id: 100, phone: '0679000000' },
    {
      id: 200,
      route: 'Malyn-Kyiv',
      date: new Date('2026-09-01T12:00:00.000Z'),
      departureTime: '05:10',
      phone: '0501111111',
      senderName: 'Іван Петренко',
      notes: null,
    },
    'exact'
  );
  assert.equal(out.kind, 'sent');
  assert.equal(captured.length, 1);
  const { html, options } = captured[0];
  assert.ok(html.includes('👤 Іван\n'), html);
  assert.equal(html.includes('Петренко'), false);
  const markup = options?.replyMarkup as { inline_keyboard: { text: string }[][] };
  assert.equal(markup.inline_keyboard[0][0].text, '🤝 Запропонувати Іван');
  const sms = String(options?.smsFallbackText);
  assert.match(sms, /є пасажир Іван, тел \+380501111111\./);
  assert.equal(sms.includes('Петренко'), false);
});

test('пасажиру про водія: лише ім’я у тексті, кнопці та SMS', async () => {
  const captured = installStub();
  const out = await notifyPassengerAboutDriverPair(
    {
      id: 100,
      route: 'Malyn-Kyiv',
      date: new Date('2026-09-01T12:00:00.000Z'),
      departureTime: '05:10',
      seats: 3,
      phone: '0679000000',
      senderName: 'Олена Коваль',
      notes: null,
    },
    { id: 200, phone: '0501111111' },
    'exact'
  );
  assert.equal(out.kind, 'sent');
  assert.equal(captured.length, 1);
  const { html, options } = captured[0];
  assert.ok(html.includes('👤 Олена\n'), html);
  assert.equal(html.includes('Коваль'), false);
  const markup = options?.replyMarkup as { inline_keyboard: { text: string }[][] };
  assert.equal(markup.inline_keyboard[0][0].text, '🎫 Забронювати у Олена');
  const sms = String(options?.smsFallbackText);
  assert.match(sms, /є водій Олена, тел \+380679000000\./);
  assert.equal(sms.includes('Коваль'), false);
});
