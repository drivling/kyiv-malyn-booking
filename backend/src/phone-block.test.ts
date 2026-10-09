/**
 * Заборона номера: нормалізація, перевірка, троттлінг обліку спроб.
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import {
  BLOCKED_ATTEMPT_THROTTLE_MS,
  PhoneBlockedError,
  assertPhoneNotBlocked,
  isPhoneBlocked,
  isPhoneBlockedError,
  recordBlockedAttempt,
} from './phone-block';

type PersonRow = { id: number; phoneBlockedAt: Date | null; blockedAttemptAt: Date | null };

function makePrisma(rows: Record<string, PersonRow>) {
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const lookups: string[] = [];
  const prisma = {
    person: {
      findUnique: async ({ where }: { where: { phoneNormalized: string } }) => {
        lookups.push(where.phoneNormalized);
        return rows[where.phoneNormalized] ?? null;
      },
      update: async (args: { where: unknown; data: unknown }) => {
        updates.push(args);
        return {};
      },
    },
  } as unknown as PrismaClient;
  return { prisma, updates, lookups };
}

const blockedRow: PersonRow = { id: 7, phoneBlockedAt: new Date('2026-09-11T10:00:00Z'), blockedAttemptAt: null };

test('isPhoneBlocked: різні формати того самого номера дають один результат', async () => {
  const { prisma, lookups } = makePrisma({ '380679551952': blockedRow });
  for (const input of ['0679551952', '+38 (067) 955-19-52', '380679551952', '38-067-955-19-52']) {
    assert.equal(await isPhoneBlocked(prisma, input), true, input);
  }
  assert.deepEqual(new Set(lookups), new Set(['380679551952']));
});

test('isPhoneBlocked: незаблокований і невідомий номер — false', async () => {
  const { prisma } = makePrisma({
    '380679551952': { id: 7, phoneBlockedAt: null, blockedAttemptAt: null },
  });
  assert.equal(await isPhoneBlocked(prisma, '0679551952'), false);
  assert.equal(await isPhoneBlocked(prisma, '0501112233'), false);
});

test('isPhoneBlocked: порожній номер не ходить у базу', async () => {
  const { prisma, lookups } = makePrisma({});
  assert.equal(await isPhoneBlocked(prisma, ''), false);
  assert.equal(await isPhoneBlocked(prisma, null), false);
  assert.equal(lookups.length, 0);
});

test('isPhoneBlocked: fail-open, якщо prisma недоступна (вузький стаб у тестах)', async () => {
  const broken = {} as unknown as PrismaClient;
  assert.equal(await isPhoneBlocked(broken, '0679551952'), false);
});

test('assertPhoneNotBlocked: кидає PhoneBlockedError для забороненого', async () => {
  const { prisma } = makePrisma({ '380679551952': { ...blockedRow } });
  await assert.rejects(() => assertPhoneNotBlocked(prisma, '0679551952'), (err: unknown) => {
    assert.ok(err instanceof PhoneBlockedError);
    assert.ok(isPhoneBlockedError(err));
    assert.equal((err as PhoneBlockedError).phoneNormalized, '380679551952');
    return true;
  });
});

test('assertPhoneNotBlocked: мовчить для дозволеного', async () => {
  const { prisma, updates } = makePrisma({
    '380679551952': { id: 7, phoneBlockedAt: null, blockedAttemptAt: null },
  });
  await assertPhoneNotBlocked(prisma, '0679551952');
  assert.equal(updates.length, 0);
});

test('recordBlockedAttempt: перша спроба інкрементує лічильник', async () => {
  const { prisma, updates } = makePrisma({ '380679551952': { ...blockedRow } });
  await recordBlockedAttempt(prisma, '0679551952');
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, { id: 7 });
  const data = updates[0].data as { blockedAttemptCount: unknown };
  assert.deepEqual(data.blockedAttemptCount, { increment: 1 });
});

test('recordBlockedAttempt: у межах вікна троттлінгу нічого не пише', async () => {
  const { prisma, updates } = makePrisma({
    '380679551952': { ...blockedRow, blockedAttemptAt: new Date(Date.now() - 1000) },
  });
  await recordBlockedAttempt(prisma, '0679551952');
  assert.equal(updates.length, 0);
});

test('recordBlockedAttempt: після вікна пише знову', async () => {
  const { prisma, updates } = makePrisma({
    '380679551952': {
      ...blockedRow,
      blockedAttemptAt: new Date(Date.now() - BLOCKED_ATTEMPT_THROTTLE_MS - 1000),
    },
  });
  await recordBlockedAttempt(prisma, '0679551952');
  assert.equal(updates.length, 1);
});

test('recordBlockedAttempt: незаблокованому нічого не пише', async () => {
  const { prisma, updates } = makePrisma({
    '380679551952': { id: 7, phoneBlockedAt: null, blockedAttemptAt: null },
  });
  await recordBlockedAttempt(prisma, '0679551952');
  assert.equal(updates.length, 0);
});

test('recordBlockedAttempt: помилка БД не піднімається нагору', async () => {
  const broken = {
    person: {
      findUnique: async () => {
        throw new Error('db down');
      },
    },
  } as unknown as PrismaClient;
  await recordBlockedAttempt(broken, '0679551952');
});
