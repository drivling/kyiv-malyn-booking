/**
 * «Оплатив» в адмінці дописує «✅ Оплатив» у нашу відповідь на замовлення в групі — правкою (kind: 'edit'),
 * як ручне редагування замовлення; ручна правка після оплати цю позначку не стирає.
 * Черга в групу (postTextToLunchGroup) підмінена — Telegram і listener тут не потрібні.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';

const posted = vi.hoisted(() => [] as Array<{ text: string; opts: Record<string, unknown> }>);
vi.mock('./lunch-telegram', () => ({
  postTextToLunchGroup: vi.fn(async (_prisma: unknown, text: string, opts: Record<string, unknown> = {}) => {
    posted.push({ text, opts });
    return { ok: true, queued: true };
  }),
}));

import { createAdminLunchRouter } from './routes/admin-lunch';
import { adminAuthToken, setAdminPassword } from './middleware/require-admin';
import { formatOrderConfirmText, formatPaidLine, updateLunchOrder } from './lunch';

const ADMIN_PASSWORD = 'lunch-paid-test';
const auth = { Authorization: adminAuthToken(ADMIN_PASSWORD) };

/** Сьогоднішнє замовлення Аліни: пюре + котлети + лоток = 120 грн. */
function payPrisma(opts: { replyMessageId?: bigint | null } = {}) {
  const payments: number[] = [];
  const order = {
    id: 9,
    dayId: 1,
    participantId: 50,
    status: 'active',
    totalUah: 120,
    trayCount: 1,
    trayTotalUah: 5,
    unmatchedText: null as string | null,
    replyMessageId: opts.replyMessageId === undefined ? 900n : opts.replyMessageId,
    sourceMessageId: 11n,
    participant: { id: 50, displayName: 'Аліна' },
    lines: [
      { id: 1, rawName: 'пюре', qty: 1, unitPriceUah: 45, lineTotalUah: 45, unavailable: false, dish: { name: 'Пюре' } },
      { id: 2, rawName: 'котлети', qty: 1, unitPriceUah: 70, lineTotalUah: 70, unavailable: false, dish: { name: 'Котлети курячі' } },
    ],
  };
  const prisma = {
    lunchSettings: { upsert: async () => ({ trayPriceUah: 5 }) },
    lunchDish: { findMany: async () => [] },
    // recordLunchPayment шукає день без include; зведення (з include) хай бачить «дня ще немає»
    lunchDay: { findUnique: async (args: { include?: unknown }) => (args.include ? null : { id: 1 }) },
    lunchOrder: { findUnique: async () => order },
    lunchPayment: {
      aggregate: async () => ({ _sum: { amountUah: payments.reduce((a, b) => a + b, 0) || null } }),
      create: async ({ data }: { data: { amountUah: number } }) => {
        payments.push(data.amountUah);
        return { id: payments.length };
      },
    },
  } as unknown as PrismaClient;
  return { prisma, payments };
}

function appWith(prisma: PrismaClient) {
  const app = express();
  setAdminPassword(app, ADMIN_PASSWORD);
  app.use(express.json());
  app.use(createAdminLunchRouter({ prisma }));
  return app;
}

beforeEach(() => {
  posted.length = 0;
});

describe('formatPaidLine', () => {
  test('немає оплат — рядка немає; повна, часткова й переплата', () => {
    expect(formatPaidLine(155, 0)).toBeNull();
    expect(formatPaidLine(155, 155)).toBe('✅ Оплатив');
    expect(formatPaidLine(155, 100)).toBe('Оплатив 100 грн, залишок 55 грн');
    expect(formatPaidLine(155, 200)).toBe('✅ Оплатив (переплата 45 грн)');
  });

  test('рядок іде одразу після «Разом» у тексті відповіді', () => {
    const text = formatOrderConfirmText({
      displayName: 'Аліна',
      lines: [{ menuItemName: 'Пюре', qty: 1, unitPriceUah: 45, lineTotalUah: 45 }],
      foodTotal: 45,
      trayCount: 1,
      trayPriceUah: 5,
      trayTotalUah: 5,
      totalUah: 50,
      paidUah: 50,
    });
    expect(text).toBe('Аліна, заказ:\n• Пюре — 45 грн (45/шт)\nЛотки: 1 × 5 = 5 грн\nРазом: 50 грн\n✅ Оплатив');
  });
});

describe('POST /admin/lunch/pay', () => {
  test('оплата всього боргу → правка нашої відповіді в групі з «✅ Оплатив», нової не пишемо', async () => {
    const { prisma, payments } = payPrisma();
    const res = await request(appWith(prisma)).post('/admin/lunch/pay').set(auth).send({ participantId: 50 }).expect(200);
    expect(payments).toEqual([120]);
    expect(res.body).toMatchObject({ ok: true, hasReply: true, telegramQueued: true, telegramError: null });
    expect(res.body.payment).toMatchObject({ orderId: 9, amountUah: 120, debt: 0 });
    expect(posted).toHaveLength(1);
    expect(posted[0].opts).toEqual({ kind: 'edit', telegramMessageId: '900' });
    expect(posted[0].text).toBe(
      'Аліна, заказ:\n• Пюре — 45 грн (45/шт)\n• Котлети курячі — 70 грн (70/шт)\nЛотки: 1 × 5 = 5 грн\nРазом: 120 грн\n✅ Оплатив'
    );
  });

  test('часткова оплата → у відповіді залишок', async () => {
    const { prisma } = payPrisma();
    await request(appWith(prisma)).post('/admin/lunch/pay').set(auth).send({ participantId: 50, amountUah: 100 }).expect(200);
    expect(posted[0].text).toMatch(/Разом: 120 грн\nОплатив 100 грн, залишок 20 грн$/);
  });

  test('нашої відповіді в групі немає → оплата є, у групу нічого не пишемо', async () => {
    const { prisma, payments } = payPrisma({ replyMessageId: null });
    const res = await request(appWith(prisma)).post('/admin/lunch/pay').set(auth).send({ participantId: 50 }).expect(200);
    expect(payments).toEqual([120]);
    expect(res.body).toMatchObject({ ok: true, hasReply: false, telegramQueued: false });
    expect(posted).toEqual([]);
  });
});

describe('POST /admin/lunch/pay · збій черги', () => {
  test('черга в групу впала → оплата все одно зарахована, помилка лише в telegramError', async () => {
    const { postTextToLunchGroup } = await import('./lunch-telegram');
    vi.mocked(postTextToLunchGroup).mockRejectedValueOnce(new Error('db down'));
    const { prisma, payments } = payPrisma();
    const res = await request(appWith(prisma)).post('/admin/lunch/pay').set(auth).send({ participantId: 50 }).expect(200);
    expect(payments).toEqual([120]);
    expect(res.body).toMatchObject({ ok: true, hasReply: true, telegramQueued: false, telegramError: 'db down' });
  });
});

describe('updateLunchOrder (ручна правка)', () => {
  test('після оплати правка відповіді зберігає «✅ Оплатив»', async () => {
    const prisma = {
      lunchSettings: { upsert: async () => ({ trayPriceUah: 5 }) },
      lunchOrder: {
        findUnique: async () => ({
          id: 9,
          dayId: 1,
          participantId: 50,
          status: 'active',
          unmatchedText: null,
          replyMessageId: 900n,
          sourceMessageId: 11n,
          participant: { displayName: 'Аліна' },
          day: { menuItems: [{ id: 3, dishId: 36, dish: { id: 36 } }] },
        }),
      },
      lunchDish: { findUnique: async () => ({ id: 36, name: 'Пюре', priceUah: 45, trayRole: 'second' }) },
      lunchPayment: { aggregate: async () => ({ _sum: { amountUah: 50 } }) },
      $transaction: async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          lunchOrderLine: { deleteMany: async () => ({}), createMany: async () => ({}) },
          lunchOrder: { update: async () => ({}) },
        }),
    } as unknown as PrismaClient;
    const out = await updateLunchOrder(prisma, 9, { lines: [{ dishId: 36, qty: 1 }] });
    expect(out.replyMessageId).toBe('900');
    expect(out.confirmText).toMatch(/Разом: 50 грн\n✅ Оплатив$/);
  });
});
