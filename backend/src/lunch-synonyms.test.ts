/**
 * Синоніми страв: один текст — одна страва. Регрес 2026-10-02: хибна прив'язка
 * («салат оливʼє» → «Салат грецький») лишалась поруч із виправленням.
 */
import { describe, expect, test } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  addLunchDishSynonym,
  moveLunchDishSynonym,
  normalizeDishName,
  saveDishSynonym,
} from './lunch';

type Dish = { id: number; name: string; nameNorm: string };
type Syn = { id: number; dishId: number; rawText: string; rawNorm: string };

function makePrisma(dishes: Dish[], synonyms: Syn[]) {
  let nextId = Math.max(0, ...synonyms.map((s) => s.id)) + 1;
  const prisma = {
    lunchDish: {
      findUnique: async ({ where }: { where: { id: number } }) => dishes.find((d) => d.id === where.id) ?? null,
    },
    lunchDishSynonym: {
      findUnique: async ({
        where,
      }: {
        where: { id?: number; dishId_rawNorm?: { dishId: number; rawNorm: string } };
      }) => {
        if (where.id != null) return synonyms.find((s) => s.id === where.id) ?? null;
        const k = where.dishId_rawNorm!;
        return synonyms.find((s) => s.dishId === k.dishId && s.rawNorm === k.rawNorm) ?? null;
      },
      upsert: async ({
        where,
        create,
      }: {
        where: { dishId_rawNorm: { dishId: number; rawNorm: string } };
        create: { dishId: number; rawText: string; rawNorm: string };
      }) => {
        const k = where.dishId_rawNorm;
        const hit = synonyms.find((s) => s.dishId === k.dishId && s.rawNorm === k.rawNorm);
        if (hit) return hit;
        const row = { id: nextId++, ...create };
        synonyms.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: number }; data: { dishId: number } }) => {
        const s = synonyms.find((x) => x.id === where.id)!;
        s.dishId = data.dishId;
        return s;
      },
      delete: async ({ where }: { where: { id: number } }) => {
        const i = synonyms.findIndex((s) => s.id === where.id);
        if (i >= 0) synonyms.splice(i, 1);
      },
      deleteMany: async ({
        where,
      }: {
        where: { rawNorm?: string; dishId?: { not: number }; id?: number };
      }) => {
        let n = 0;
        for (let i = synonyms.length - 1; i >= 0; i--) {
          const s = synonyms[i];
          if (where.id != null && s.id !== where.id) continue;
          if (where.rawNorm != null && s.rawNorm !== where.rawNorm) continue;
          if (where.dishId != null && s.dishId === where.dishId.not) continue;
          synonyms.splice(i, 1);
          n++;
        }
        return { count: n };
      },
    },
  };
  return prisma as unknown as PrismaClient;
}

const DISHES: Dish[] = [
  { id: 1, name: 'Салат грецький', nameNorm: normalizeDishName('Салат грецький') },
  { id: 2, name: "Салат Олів'є", nameNorm: normalizeDishName("Салат Олів'є") },
  { id: 3, name: 'Пюре', nameNorm: normalizeDishName('Пюре') },
];

function wrongGreekSynonym(): Syn {
  const raw = 'салат оливьє';
  return { id: 10, dishId: 1, rawText: raw, rawNorm: normalizeDishName(raw) };
}

describe('lunch synonyms', () => {
  test('saveDishSynonym (ручна правка замовлення) забирає текст у хибної страви', async () => {
    const syns = [wrongGreekSynonym()];
    const prisma = makePrisma(DISHES, syns);

    await saveDishSynonym(prisma, 2, 'салат оливьє');

    expect(syns).toHaveLength(1);
    expect(syns[0].dishId).toBe(2);
  });

  test('addLunchDishSynonym з адмінки теж лишає єдиного власника', async () => {
    const syns = [wrongGreekSynonym()];
    const prisma = makePrisma(DISHES, syns);

    await addLunchDishSynonym(prisma, 2, 'Салат Оливьє');

    expect(syns.map((s) => s.dishId)).toEqual([2]);
  });

  test('канонічна назва не стає синонімом', async () => {
    const syns: Syn[] = [];
    const prisma = makePrisma(DISHES, syns);
    await saveDishSynonym(prisma, 3, 'пюре');
    expect(syns).toHaveLength(0);
    await expect(addLunchDishSynonym(prisma, 3, 'ПЮРЕ')).rejects.toThrow(/канонічна/);
  });

  test('moveLunchDishSynonym прибирає дублікати цього тексту на інших стравах', async () => {
    const raw = normalizeDishName('оливьє');
    const syns: Syn[] = [
      { id: 10, dishId: 1, rawText: 'оливьє', rawNorm: raw },
      { id: 11, dishId: 3, rawText: 'оливьє', rawNorm: raw },
    ];
    const prisma = makePrisma(DISHES, syns);

    await moveLunchDishSynonym(prisma, 10, 2);

    expect(syns.map((s) => [s.id, s.dishId])).toEqual([[10, 2]]);
  });

  test('moveLunchDishSynonym: у цілі вже є такий синонім — зайві копії видаляються', async () => {
    const raw = normalizeDishName('оливьє');
    const syns: Syn[] = [
      { id: 10, dishId: 1, rawText: 'оливьє', rawNorm: raw },
      { id: 12, dishId: 2, rawText: 'оливьє', rawNorm: raw },
      { id: 13, dishId: 3, rawText: 'оливьє', rawNorm: raw },
    ];
    const prisma = makePrisma(DISHES, syns);

    await moveLunchDishSynonym(prisma, 10, 2);

    expect(syns.map((s) => [s.id, s.dishId])).toEqual([[12, 2]]);
  });
});
