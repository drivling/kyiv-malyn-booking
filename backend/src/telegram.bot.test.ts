/**
 * Тести TelegramBot.sendMessage та spawn-обгорток без реального API / Python.
 */
import { EventEmitter } from 'events';
import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import type { spawn as nodeSpawnType } from 'child_process';
import type TelegramBot from 'node-telegram-bot-api';
import {
  setTelegramBotForTests,
  resetTelegramBotForTests,
  setSpawnForTests,
  resetSpawnForTests,
  setTelegramPrismaForTests,
  resetTelegramPrismaForTests,
  sendBehaviorPromoMessage,
  sendMessageViaUserAccount,
  fetchTelegramGroupMessages,
} from './telegram';
import type { PrismaClient } from '@prisma/client';

function asPrisma(p: unknown): PrismaClient {
  return p as PrismaClient;
}

function mockChildProcess(hooks: {
  onSpawn?: (child: EventEmitter, stdout: EventEmitter, stderr: EventEmitter) => void;
}): ChildProcess {
  const child = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  hooks.onSpawn?.(child, stdout, stderr);
  return Object.assign(child, {
    stdout,
    stderr,
    stdin: {
      end: (...args: unknown[]) => {
        const last = args[args.length - 1];
        const cb = typeof last === 'function' ? (last as () => void) : undefined;
        queueMicrotask(() => {
          // spawnSendMessage чекає stderr.once('end'|'close') перед resolve
          stderr.emit('end');
          stderr.emit('close');
          child.emit('close', 0);
          cb?.();
        });
      },
    },
  }) as unknown as ChildProcess;
}

function mockSpawnSendMessageSuccess(): typeof nodeSpawnType {
  return ((_cmd, _args, _opts) => mockChildProcess({})) as typeof nodeSpawnType;
}

function mockSpawnFetch(stdoutBody: string, exitCode: number): typeof nodeSpawnType {
  return ((_cmd, _args, _opts) =>
    mockChildProcess({
      onSpawn: (child, stdout, stderr) => {
        queueMicrotask(() => {
          stdout.emit('data', Buffer.from(stdoutBody));
          stderr.emit('end');
          stderr.emit('close');
          child.emit('close', exitCode);
        });
      },
    })) as typeof nodeSpawnType;
}

const savedSessionEnv: Record<string, string | undefined> = {};

function saveUserTelegramEnv(): void {
  savedSessionEnv.TELEGRAM_USER_SESSION_PATH = process.env.TELEGRAM_USER_SESSION_PATH;
  savedSessionEnv.TELEGRAM_API_ID = process.env.TELEGRAM_API_ID;
  savedSessionEnv.TELEGRAM_API_HASH = process.env.TELEGRAM_API_HASH;
}

function restoreUserTelegramEnv(): void {
  for (const k of Object.keys(savedSessionEnv) as (keyof typeof savedSessionEnv)[]) {
    const v = savedSessionEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    savedSessionEnv[k] = undefined;
  }
}

afterEach(() => {
  resetTelegramBotForTests();
  resetSpawnForTests();
  resetTelegramPrismaForTests();
  restoreUserTelegramEnv();
});

test('sendBehaviorPromoMessage: sendMessage з parse_mode HTML та текстом', async () => {
  const sendMessage = mock.fn(async () => ({}));
  setTelegramBotForTests({ sendMessage } as unknown as TelegramBot);
  await sendBehaviorPromoMessage('chat99', 'driver_passengers', { fullName: 'Оля' });
  assert.equal(sendMessage.mock.calls.length, 1);
  const c = sendMessage.mock.calls[0] as unknown as {
    arguments: [string, string, { parse_mode: string }];
  };
  assert.equal(c.arguments[0], 'chat99');
  assert.equal(c.arguments[2].parse_mode, 'HTML');
  assert.ok(c.arguments[1].includes('Оля'));
  assert.ok(c.arguments[1].includes('<b>'));
});

test('sendBehaviorPromoMessage: без бота — помилка', async () => {
  setTelegramBotForTests(null);
  await assert.rejects(
    () => sendBehaviorPromoMessage('1', 'mixed_both'),
    /не налаштовано/
  );
});

test('sendMessageViaUserAccount: true при успішному spawn (по телефону)', async () => {
  saveUserTelegramEnv();
  process.env.TELEGRAM_USER_SESSION_PATH = '/tmp/mock-tg-session-path';
  process.env.TELEGRAM_API_ID = '11111';
  process.env.TELEGRAM_API_HASH = 'mockhash';
  setSpawnForTests(mockSpawnSendMessageSuccess());
  const ok = await sendMessageViaUserAccount('0670000000', 'Привіт');
  assert.equal(ok, true);
});

test('sendMessageViaUserAccount: спочатку username — той самий успішний spawn', async () => {
  saveUserTelegramEnv();
  process.env.TELEGRAM_USER_SESSION_PATH = '/tmp/mock-tg-session-path';
  process.env.TELEGRAM_API_ID = '11111';
  process.env.TELEGRAM_API_HASH = 'mockhash';
  setSpawnForTests(mockSpawnSendMessageSuccess());
  const ok = await sendMessageViaUserAccount('0670000000', 'Hi', { telegramUsername: 'testuser' });
  assert.equal(ok, true);
});

test('sendMessageViaUserAccount: false без env сесії', async () => {
  saveUserTelegramEnv();
  delete process.env.TELEGRAM_USER_SESSION_PATH;
  delete process.env.TELEGRAM_API_ID;
  delete process.env.TELEGRAM_API_HASH;
  setSpawnForTests(mock.fn(() => {
    throw new Error('spawn should not run');
  }) as unknown as typeof nodeSpawnType);
  const ok = await sendMessageViaUserAccount('0670000000', 'x');
  assert.equal(ok, false);
});

test('fetchTelegramGroupMessages: текст і upsert last ids', async () => {
  saveUserTelegramEnv();
  process.env.TELEGRAM_USER_SESSION_PATH = '/tmp/mock-tg-session-path';
  process.env.TELEGRAM_API_ID = '11111';
  process.env.TELEGRAM_API_HASH = 'mockhash';
  const upsert = mock.fn(async () => ({}));
  setTelegramPrismaForTests(
    asPrisma({
      telegramFetchState: { findMany: mock.fn(async () => []), upsert },
    })
  );
  setSpawnForTests(mockSpawnFetch('New msg\n__LAST_IDS__{"2":42}', 0));
  const text = await fetchTelegramGroupMessages({ limit: 5, fullFetch: true });
  assert.equal(text, 'New msg');
  assert.equal(upsert.mock.calls.length, 1);
  const up = upsert.mock.calls[0] as unknown as {
    arguments: [{ where: { topicId: number }; create: { lastMessageId: number } }];
  };
  assert.equal(up.arguments[0].where.topicId, 2);
  assert.equal(up.arguments[0].create.lastMessageId, 42);
});

test('fetchTelegramGroupMessages: null при ненульовому коді spawn', async () => {
  saveUserTelegramEnv();
  process.env.TELEGRAM_USER_SESSION_PATH = '/tmp/mock-tg-session-path';
  process.env.TELEGRAM_API_ID = '11111';
  process.env.TELEGRAM_API_HASH = 'mockhash';
  setTelegramPrismaForTests(asPrisma({ telegramFetchState: { findMany: mock.fn(async () => []) } }));
  setSpawnForTests(mockSpawnFetch('err', 1));
  const text = await fetchTelegramGroupMessages({ limit: 5, fullFetch: true });
  assert.equal(text, null);
});

test('fetchTelegramGroupMessages: null без env', async () => {
  saveUserTelegramEnv();
  delete process.env.TELEGRAM_USER_SESSION_PATH;
  delete process.env.TELEGRAM_API_ID;
  delete process.env.TELEGRAM_API_HASH;
  const text = await fetchTelegramGroupMessages({ fullFetch: true });
  assert.equal(text, null);
});
