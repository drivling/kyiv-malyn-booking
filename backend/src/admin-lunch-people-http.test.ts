/**
 * HTTP: розбір однієї людини, «хто писав у групі», прибирання замовлення (/admin/lunch/*).
 * Lunch-роутер монтуємо окремо з підміненим запуском розбору — Telegram тут не чіпаємо.
 */
import { describe, expect, test, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createAdminLunchRouter } from './routes/admin-lunch';
import { ADMIN_AUTH_TOKEN } from './middleware/require-admin';
import { isLunchSystemEcho, listLunchDayPeople } from './lunch-people';
import { todayKyivDate } from './lunch';
import type { LunchReparseResult } from './lunch-reparse';

const auth = { Authorization: ADMIN_AUTH_TOKEN };

type Person = {
  id: number;
  tgUserId: bigint;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  isBot: boolean;
  isMe: boolean;
};

const alina: Person = { id: 1, tgUserId: 111n, firstName: 'Аліна', lastName: null, username: 'alina', isBot: false, isMe: false };
const diana: Person = { id: 2, tgUserId: 222n, firstName: 'Діана', lastName: null, username: null, isBot: false, isMe: false };
const owner: Person = { id: 3, tgUserId: 5072659044n, firstName: 'Сергій', lastName: null, username: 'me', isBot: false, isMe: true };

function noon(): Date {
  // 12:00 за Києвом сьогодні — гарантовано всередині доби Києва
  const d = todayKyivDate();
  return new Date(d.getTime() + 9 * 3600_000);
}

function makePrisma(opts: { withChat?: boolean; orders?: Array<{ id: number; participantId: number; totalUah: number }> } = {}) {
  const at = noon();
  const msg = (id: number, sender: Person, text: string, extra: Record<string, unknown> = {}) => ({
    id,
    chatId: 7,
    tgMessageId: BigInt(id),
    senderPersonId: sender.id,
    sender,
    isOutgoing: sender.isMe,
    text,
    mediaKind: null as string | null,
    sentAt: new Date(at.getTime() + id * 1000),
    editedAt: null as Date | null,
    deletedAt: null as Date | null,
    ...extra,
  });
  const messages = [
    msg(101, alina, 'привіт'),
    msg(102, alina, 'Пюре, салат оливьє'),
    msg(103, diana, '', { mediaKind: 'photo' }),
    msg(104, owner, 'Діана, заказ:\n• Пюре — 40 грн'),
    msg(105, owner, 'Мені котлети'),
  ];
  const queries: Array<Record<string, unknown>> = [];
  const prisma = {
    dzhuraChat: {
      findFirst: async () => (opts.withChat === false ? null : { id: 7 }),
    },
    dzhuraMessage: {
      findMany: async (args: Record<string, unknown>) => {
        queries.push(args);
        return messages;
      },
    },
    lunchDay: { findUnique: async () => ({ id: 1 }) },
    lunchParticipant: {
      findMany: async () => [
        { id: 50, telegramUserId: '222', displayName: 'Діана' },
        { id: 51, telegramUserId: '5072659044', displayName: 'Сергій' },
      ],
      findUnique: async ({ where }: { where: { id: number } }) =>
        where.id === 50
          ? { id: 50, telegramUserId: '222', displayName: 'Діана' }
          : where.id === 60
            ? { id: 60, telegramUserId: 'name:марта', displayName: 'Марта' }
            : null,
    },
    lunchOrder: {
      findMany: async () => opts.orders ?? [{ id: 900, participantId: 50, totalUah: 45 }],
    },
  };
  return { prisma: prisma as unknown as PrismaClient, queries };
}

describe('isLunchSystemEcho', () => {
  test('відповіді слухача — луна, живі замовлення — ні', () => {
    expect(isLunchSystemEcho('Діана, заказ:\n• Пюре — 40 грн')).toBe(true);
    expect(isLunchSystemEcho('Меню на сьогодні:\n• Пюре — 40 грн')).toBe(true);
    expect(isLunchSystemEcho('Марта, сьогодні немає: Пюре.')).toBe(true);
    expect(isLunchSystemEcho('!зведення')).toBe(true);
    expect(isLunchSystemEcho('')).toBe(true);
    expect(isLunchSystemEcho('Пюре, котлети курячі')).toBe(false);
    expect(isLunchSystemEcho('оплатив 150')).toBe(false);
  });
});

describe('listLunchDayPeople', () => {
  test('без замовлення — першими; луна власника відфільтрована; фото видно', async () => {
    const { prisma } = makePrisma();
    const res = await listLunchDayPeople(prisma);
    expect(res.available).toBe(true);
    // Спершу ті, у кого замовлення немає (за іменем), потім з замовленням.
    // Замовлення в стабі є лише в Діани (participantId 50); власник (51) — без замовлення.
    expect(res.people.map((p) => [p.name, p.hasOrder])).toEqual([
      ['Аліна', false],
      ['Сергій', false],
      ['Діана', true],
    ]);

    const a = res.people.find((p) => p.name === 'Аліна')!;
    expect(a.tgUserId).toBe('111');
    expect(a.participantId).toBeNull();
    expect(a.messages.map((m) => m.text)).toEqual(['привіт', 'Пюре, салат оливьє']);

    const d = res.people.find((p) => p.name === 'Діана')!;
    expect(d.orderId).toBe(900);
    expect(d.orderTotalUah).toBe(45);
    expect(d.messages.map((m) => m.text)).toEqual(['[фото]']);

    const me = res.people.find((p) => p.isMe)!;
    expect(me.messages.map((m) => m.text)).toEqual(['Мені котлети']); // «Діана, заказ:…» — луна
  });

  test('чату обідів у Джурі нема — available:false', async () => {
    const { prisma } = makePrisma({ withChat: false });
    expect(await listLunchDayPeople(prisma)).toMatchObject({ available: false, people: [] });
  });

  test('запит обмежений добою Києва і не бере видалені', async () => {
    const { prisma, queries } = makePrisma();
    await listLunchDayPeople(prisma);
    const where = queries[0].where as { deletedAt: null; sentAt: { gte: Date; lt: Date } };
    expect(where.deletedAt).toBeNull();
    expect(where.sentAt.lt.getTime() - where.sentAt.gte.getTime()).toBeGreaterThanOrEqual(23 * 3600_000);
  });
});

/** Prisma-стаб, достатній для getLunchDaySummary «дня ще немає» (summary = порожній день). */
function emptySummaryPrisma(extra: Record<string, unknown> = {}): PrismaClient {
  return {
    lunchSettings: { upsert: async () => ({ trayPriceUah: 5 }) },
    lunchDish: { findMany: async () => [] },
    lunchDay: { findUnique: async () => null },
    lunchParticipant: {
      findUnique: async ({ where }: { where: { id: number } }) =>
        where.id === 50
          ? { id: 50, telegramUserId: '222', displayName: 'Діана' }
          : where.id === 60
            ? { id: 60, telegramUserId: 'name:марта', displayName: 'Марта' }
            : null,
    },
    ...extra,
  } as unknown as PrismaClient;
}

function appWith(prisma: PrismaClient, reparsePerson = vi.fn<NonNullable<Parameters<typeof createAdminLunchRouter>[0]['reparsePerson']>>()) {
  const app = express();
  app.use(express.json());
  app.use(createAdminLunchRouter({ prisma, reparsePerson }));
  return { app, reparsePerson };
}

describe('POST /admin/lunch/reparse-person', () => {
  test('401 без токена', async () => {
    const { app } = appWith(emptySummaryPrisma());
    await request(app).post('/admin/lunch/reparse-person').send({ tgUserId: '111' }).expect(401);
  });

  test('tgUserId → запуск розбору (notify за замовчуванням) і відповідь із reparse + summary', async () => {
    const prisma = emptySummaryPrisma();
    const ok: LunchReparseResult = { ok: true, orders: 1, details: [], person: { tgUserId: '111', name: 'Аліна' } };
    const fn = vi.fn(async () => ok);
    const { app } = appWith(prisma, fn as never);
    const res = await request(app).post('/admin/lunch/reparse-person').set(auth).send({ tgUserId: '111' }).expect(200);
    expect(fn).toHaveBeenCalledWith(prisma, { tgUserId: '111', notify: true });
    expect(res.body.ok).toBe(true);
    expect(res.body.reparse.person.name).toBe('Аліна');
    expect(res.body.summary).toBeDefined();
  });

  test('participantId → беремо telegramUserId учасника; notify:false передається', async () => {
    const prisma = emptySummaryPrisma();
    const fn = vi.fn(async () => ({ ok: true }) as LunchReparseResult);
    const { app } = appWith(prisma, fn as never);
    await request(app).post('/admin/lunch/reparse-person').set(auth).send({ participantId: 50, notify: false }).expect(200);
    expect(fn).toHaveBeenCalledWith(prisma, { tgUserId: '222', notify: false });
  });

  test('учасник із підсумку (name:…) без Telegram id → 400 з підказкою', async () => {
    const fn = vi.fn();
    const { app } = appWith(emptySummaryPrisma(), fn as never);
    const res = await request(app).post('/admin/lunch/reparse-person').set(auth).send({ participantId: 60 }).expect(400);
    expect(res.body.error).toMatch(/Telegram id/);
    expect(fn).not.toHaveBeenCalled();
  });

  test('сміття замість id → 400, невідомий participantId → 404', async () => {
    const { app } = appWith(emptySummaryPrisma());
    await request(app).post('/admin/lunch/reparse-person').set(auth).send({ tgUserId: 'abc' }).expect(400);
    await request(app).post('/admin/lunch/reparse-person').set(auth).send({ participantId: 999 }).expect(404);
    await request(app).post('/admin/lunch/reparse-person').set(auth).send({ participantId: -1 }).expect(400);
  });

  test('помилка розбору (listener мовчить) → 500 з текстом', async () => {
    const fn = vi.fn(async () => ({ ok: false, error: 'Таймаут очікування listener' }) as LunchReparseResult);
    const { app } = appWith(emptySummaryPrisma(), fn as never);
    const res = await request(app).post('/admin/lunch/reparse-person').set(auth).send({ tgUserId: '111' }).expect(500);
    expect(res.body.error).toMatch(/Таймаут/);
  });
});

describe('GET /admin/lunch/day-people', () => {
  test('віддає людей (BigInt як рядок) і потребує токен', async () => {
    const { prisma } = makePrisma();
    const { app } = appWith(prisma);
    await request(app).get('/admin/lunch/day-people').expect(401);
    const res = await request(app).get('/admin/lunch/day-people').set(auth).expect(200);
    expect(res.body.available).toBe(true);
    expect(res.body.people[0]).toMatchObject({ name: 'Аліна', tgUserId: '111', hasOrder: false });
  });
});

describe('DELETE /admin/lunch/orders/:id', () => {
  test('некоректний id → 400; невідоме замовлення → 404', async () => {
    const prisma = emptySummaryPrisma({ lunchOrder: { findUnique: async () => null } });
    const { app } = appWith(prisma);
    await request(app).delete('/admin/lunch/orders/abc').set(auth).expect(400);
    await request(app).delete('/admin/lunch/orders/5').set(auth).expect(404);
  });

  test('активне замовлення стає cancelled, відповідь містить summary', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const prisma = emptySummaryPrisma({
      lunchOrder: {
        findUnique: async () => ({ id: 5, status: 'active' }),
        update: async (args: Record<string, unknown>) => {
          updates.push(args);
          return {};
        },
      },
    });
    const { app } = appWith(prisma);
    const res = await request(app).delete('/admin/lunch/orders/5').set(auth).expect(200);
    expect(res.body.ok).toBe(true);
    expect(updates).toHaveLength(1);
    expect((updates[0].data as { status: string }).status).toBe('cancelled');
  });

  test('уже скасоване замовлення → 404', async () => {
    const prisma = emptySummaryPrisma({
      lunchOrder: { findUnique: async () => ({ id: 5, status: 'cancelled' }) },
    });
    const { app } = appWith(prisma);
    await request(app).delete('/admin/lunch/orders/5').set(auth).expect(404);
  });
});
