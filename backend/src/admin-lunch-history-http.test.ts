/**
 * HTTP: GET /admin/lunch/history — історія днів для оцінки розпізнавання (без імен і Telegram-id).
 */
import { describe, expect, test } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { PrismaClient } from '@prisma/client';
import { createAdminLunchRouter } from './routes/admin-lunch';
import { ADMIN_AUTH_TOKEN } from './middleware/require-admin';

const auth = { Authorization: ADMIN_AUTH_TOKEN };

function makePrisma() {
  const queries: Array<Record<string, unknown>> = [];
  const t0 = new Date('2026-10-01T08:00:00.000Z');
  const prisma = {
    lunchDay: {
      findMany: async (args: Record<string, unknown>) => {
        queries.push(args);
        return [
          {
            id: 1,
            date: new Date('2026-10-01T00:00:00.000Z'),
            status: 'ordering',
            menuItems: [
              {
                dishId: 36,
                name: 'Пюре',
                priceUah: 45,
                dish: { trayRole: 'second', name: 'Пюре', synonyms: [{ rawText: 'картопляне пюре' }] },
              },
            ],
            orders: [
              {
                id: 10,
                rawText: 'пюре',
                unmatchedText: null,
                totalUah: 50,
                trayCountManual: false,
                createdAt: t0,
                updatedAt: new Date(t0.getTime() + 30_000),
                participantId: 99, // не має потрапити у відповідь
                lines: [{ dishId: 36, rawName: 'Пюре', qty: 1, unavailable: false, dish: { id: 36, name: 'Пюре' } }],
              },
              {
                id: 11,
                rawText: 'салат грецький',
                unmatchedText: null,
                totalUah: 30,
                trayCountManual: true,
                createdAt: t0,
                updatedAt: new Date(t0.getTime() + 10 * 60_000),
                lines: [{ dishId: 41, rawName: 'x', qty: 2, unavailable: false, dish: { id: 41, name: 'Салат «Грецький»' } }],
              },
            ],
          },
        ];
      },
    },
  };
  return { prisma: prisma as unknown as PrismaClient, queries };
}

function appWith(prisma: PrismaClient) {
  const app = express();
  app.use(express.json());
  app.use(createAdminLunchRouter({ prisma }));
  return app;
}

describe('GET /admin/lunch/history', () => {
  test('401 без токена', async () => {
    await request(appWith(makePrisma().prisma)).get('/admin/lunch/history').expect(401);
  });

  test('віддає меню, замовлення й прапорець touchedAfterCreate, без імен', async () => {
    const { prisma, queries } = makePrisma();
    const res = await request(appWith(prisma))
      .get('/admin/lunch/history?from=2026-10-01&to=2026-10-02')
      .set(auth)
      .expect(200);
    expect(res.body.from).toBe('2026-10-01');
    expect(res.body.to).toBe('2026-10-02');
    const day = res.body.days[0];
    expect(day.date).toBe('2026-10-01');
    expect(day.menu).toEqual([
      { dishId: 36, name: 'Пюре', priceUah: 45, trayRole: 'second', synonyms: ['картопляне пюре'] },
    ]);
    expect(day.orders.map((o: { id: number; touchedAfterCreate: boolean }) => [o.id, o.touchedAfterCreate])).toEqual([
      [10, false], // змінено через 30 с — автоматичне оновлення
      [11, true], // через 10 хв — правка людини
    ]);
    expect(day.orders[1].lines).toEqual([{ dishId: 41, name: 'Салат «Грецький»', qty: 2, unavailable: false }]);
    expect(JSON.stringify(res.body)).not.toMatch(/participant|telegram/i);
    const where = queries[0].where as { date: { gte: Date; lte: Date } };
    expect(where.date.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(where.date.lte.toISOString()).toBe('2026-10-02T00:00:00.000Z');
  });

  test('за замовчуванням — останні 14 днів', async () => {
    const { prisma, queries } = makePrisma();
    await request(appWith(prisma)).get('/admin/lunch/history').set(auth).expect(200);
    const where = queries[0].where as { date: { gte: Date; lte: Date } };
    const days = Math.round((where.date.lte.getTime() - where.date.gte.getTime()) / 86_400_000) + 1;
    expect(days).toBe(14);
  });

  test('некоректні дати й задовгий період → 400', async () => {
    const { prisma } = makePrisma();
    const app = appWith(prisma);
    await request(app).get('/admin/lunch/history?from=abc&to=2026-10-02').set(auth).expect(400);
    await request(app).get('/admin/lunch/history?from=2026-10-05&to=2026-10-01').set(auth).expect(400);
    await request(app).get('/admin/lunch/history?from=2026-01-01&to=2026-10-02').set(auth).expect(400);
  });
});
