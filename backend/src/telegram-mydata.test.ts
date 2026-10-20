/**
 * Бот: /mydata (документ у чат) і /deleteme (підтвердження → знеособлення) без реального Telegram / БД.
 */
import { test, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import type TelegramBot from 'node-telegram-bot-api';
import type { PrismaClient } from '@prisma/client';
import {
  DELETE_ME_CANCEL_CALLBACK,
  DELETE_ME_CONFIRM_CALLBACK,
  handleDeleteMeCallback,
  handleDeleteMeCommand,
  handleMyDataCommand,
  resetTelegramBotForTests,
  resetTelegramPrismaForTests,
  setTelegramBotForTests,
  setTelegramPrismaForTests,
} from './telegram';

const PERSON = {
  id: 42,
  phoneNormalized: '380671234567',
  fullName: 'Іван Тест',
  telegramChatId: '555',
  telegramUserId: '123456789',
  telegramUsername: null,
  smsOptOut: false,
  phoneBlockedAt: null,
  referralCode: null,
  referredByPersonId: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function makePrisma(rows: Partial<Record<string, unknown[]>> = {}) {
  const calls: string[] = [];
  const model = (name: string) => {
    const rec = (op: string) => async () => {
      calls.push(`${name}.${op}`);
      const r = rows[name] ?? [];
      if (op === 'findMany') return r;
      if (op === 'findFirst' || op === 'findUnique') return r[0] ?? null;
      if (op === 'deleteMany' || op === 'updateMany') return { count: r.length };
      return {};
    };
    return { findMany: rec('findMany'), findFirst: rec('findFirst'), findUnique: rec('findUnique'), deleteMany: rec('deleteMany'), updateMany: rec('updateMany'), update: rec('update') };
  };
  const tx = new Proxy({}, { get: (_t, prop: string) => (prop === 'then' ? undefined : model(prop)) });
  const prisma = new Proxy(
    {},
    {
      get: (_t, prop: string) => {
        if (prop === '$transaction') return async (fn: (t: unknown) => unknown) => fn(tx);
        if (prop === 'then') return undefined;
        return model(prop);
      },
    },
  ) as unknown as PrismaClient;
  return { prisma, calls };
}

function makeBot() {
  const sent: Array<{ chatId: string; text: string; opts?: unknown }> = [];
  const docs: Array<{ chatId: string; body: string; opts?: unknown; file?: unknown }> = [];
  const bot = {
    sendMessage: async (chatId: string, text: string, opts?: unknown) => {
      sent.push({ chatId, text, opts });
      return { message_id: 1 };
    },
    sendDocument: async (chatId: string, doc: Buffer, opts?: unknown, file?: unknown) => {
      docs.push({ chatId, body: doc.toString('utf8'), opts, file });
      return { message_id: 2 };
    },
  } as unknown as TelegramBot;
  return { bot, sent, docs };
}

afterEach(() => {
  resetTelegramBotForTests();
  resetTelegramPrismaForTests();
});

test('/mydata: документ JSON з ім\'ям файла і підписом; нема записів → текст', async () => {
  const { bot, sent, docs } = makeBot();
  setTelegramBotForTests(bot);
  setTelegramPrismaForTests(makePrisma({ person: [PERSON] }).prisma);

  await handleMyDataCommand('555', '123456789');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].chatId, '555');
  assert.match((docs[0].file as { filename: string }).filename, /^malin-kiev-ua-my-data-\d{4}-\d{2}-\d{2}\.json$/);
  assert.equal((docs[0].file as { contentType: string }).contentType, 'application/json');
  const data = JSON.parse(docs[0].body);
  assert.equal(data.person.phone, '380671234567');
  assert.match(String((docs[0].opts as { caption: string }).caption), /deleteme/);

  setTelegramPrismaForTests(makePrisma({}).prisma);
  await handleMyDataCommand('555', '123456789');
  assert.equal(docs.length, 1);
  assert.match(sent.at(-1)!.text, /немає жодного запису/);
});

test('/mydata без user id — тиша', async () => {
  const { bot, sent, docs } = makeBot();
  setTelegramBotForTests(bot);
  setTelegramPrismaForTests(makePrisma({ person: [PERSON] }).prisma);
  await handleMyDataCommand('555', '');
  await handleMyDataCommand('555', '0');
  assert.equal(sent.length + docs.length, 0);
});

test('/deleteme: питання з двома кнопками; «ні» → нічого; «так» → знеособлення і підсумок', async () => {
  const { bot, sent } = makeBot();
  setTelegramBotForTests(bot);
  const { prisma, calls } = makePrisma({ person: [PERSON], booking: [{ id: 1 }] });
  setTelegramPrismaForTests(prisma);

  await handleDeleteMeCommand('555', '123456789');
  const kb = (sent[0].opts as { reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> } }).reply_markup.inline_keyboard[0];
  assert.deepEqual(kb.map((b) => b.callback_data), [DELETE_ME_CONFIRM_CALLBACK, DELETE_ME_CANCEL_CALLBACK]);
  assert.match(sent[0].text, /mydata/);

  assert.equal(await handleDeleteMeCallback('555', '123456789', 'referral_x'), false);
  assert.equal(await handleDeleteMeCallback('555', '123456789', DELETE_ME_CANCEL_CALLBACK), true);
  assert.match(sent.at(-1)!.text, /нічого не видаляємо/);
  assert.ok(!calls.includes('person.update'));

  assert.equal(await handleDeleteMeCallback('555', '123456789', DELETE_ME_CONFIRM_CALLBACK), true);
  assert.ok(calls.includes('person.update'));
  assert.ok(calls.includes('booking.deleteMany'));
  const done = sent.find((m) => /Акаунт видалено/.test(m.text));
  assert.ok(done);
  assert.match(done.text, /скасовано майбутніх бронювань: 1/);
  assert.deepEqual((done.opts as { reply_markup: unknown }).reply_markup, { remove_keyboard: true });
  // адмін-чат отримав підсумок (той самий sendMessage у стабі)
  assert.ok(sent.some((m) => m.chatId !== '555' && /Людина видалила акаунт/.test(m.text)));
});
