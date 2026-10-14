/**
 * Автор групи без username і номера: Person за числовим Telegram-id з технічним номером.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { findOrCreatePersonByTelegramUserId, resetTelegramPrismaForTests, setTelegramPrismaForTests } from './telegram';

type P = { id: number; phoneNormalized: string; fullName: string | null; telegramUserId: string | null };

function stub(initial: P[] = []) {
  const rows = [...initial];
  const updates: Array<{ id: number; data: Record<string, unknown> }> = [];
  const prisma = {
    person: {
      findFirst: async ({ where }: { where: { telegramUserId?: string; phoneNormalized?: { startsWith: string } } }) => {
        if (where.telegramUserId) return rows.find((r) => r.telegramUserId === where.telegramUserId) ?? null;
        if (where.phoneNormalized) {
          const m = rows.filter((r) => r.phoneNormalized.startsWith(where.phoneNormalized!.startsWith));
          return m.sort((a, b) => b.phoneNormalized.localeCompare(a.phoneNormalized))[0] ?? null;
        }
        return null;
      },
      create: async ({ data }: { data: Omit<P, 'id'> }) => {
        const row = { id: rows.length + 1, ...data, fullName: data.fullName ?? null } as P;
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        Object.assign(rows.find((r) => r.id === where.id)!, data);
        return {};
      },
    },
  } as unknown as PrismaClient;
  return { prisma, rows, updates };
}

afterEach(() => resetTelegramPrismaForTests());

describe('findOrCreatePersonByTelegramUserId', () => {
  it('створює Person з технічним номером і наступні виклики повертають того самого', async () => {
    const s = stub();
    setTelegramPrismaForTests(s.prisma);
    const a = await findOrCreatePersonByTelegramUserId('777000111', { fullName: 'Дима' });
    expect(a.phoneNormalized).toBe('380010000000');
    expect(s.rows[0]).toMatchObject({ telegramUserId: '777000111', fullName: 'Дима' });
    const again = await findOrCreatePersonByTelegramUserId('777000111');
    expect(again.id).toBe(a.id);
    expect(s.rows).toHaveLength(1);
  });

  it('інша людина отримує наступний технічний номер', async () => {
    const s = stub([{ id: 1, phoneNormalized: '380010000000', fullName: null, telegramUserId: '1' }]);
    setTelegramPrismaForTests(s.prisma);
    const b = await findOrCreatePersonByTelegramUserId('888000222');
    expect(b.phoneNormalized).toBe('380010000001');
  });

  it('дописує ім\'я, лише якщо його ще не було', async () => {
    const s = stub([{ id: 1, phoneNormalized: '380010000000', fullName: null, telegramUserId: '5551234' }]);
    setTelegramPrismaForTests(s.prisma);
    await findOrCreatePersonByTelegramUserId('5551234', { fullName: 'Олена' });
    expect(s.updates).toEqual([{ id: 1, data: { fullName: 'Олена' } }]);
    await findOrCreatePersonByTelegramUserId('5551234', { fullName: 'Інша' });
    expect(s.updates).toHaveLength(1);
  });

  it('некоректний id → помилка', async () => {
    setTelegramPrismaForTests(stub().prisma);
    await expect(findOrCreatePersonByTelegramUserId('0')).rejects.toThrow();
    await expect(findOrCreatePersonByTelegramUserId('abc')).rejects.toThrow();
  });
});
