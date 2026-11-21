/**
 * createOrMergeViberListing: поїздки, дата яких уже минула (вчора чи раніше в Києві),
 * завжди зберігаються з isActive:false ("архів") — незалежно від джерела/викликача.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { createOrMergeViberListing, type ViberListingMergeInput } from './viber-listing-merge';
import { isPhoneBlockedError } from './phone-block';

function baseInput(over: Partial<ViberListingMergeInput> = {}): ViberListingMergeInput {
  return {
    rawMessage: 'text',
    listingType: 'driver',
    route: 'Kyiv-Malyn',
    date: new Date('2026-09-08T00:00:00.000Z'),
    departureTime: '08:00',
    seats: null,
    phone: '0501112233',
    notes: null,
    isActive: true,
    ...over,
  };
}

function makeStub(existing: unknown[] = []): { prisma: PrismaClient; created: any[]; updated: any[] } {
  const created: any[] = [];
  const updated: any[] = [];
  const prisma = {
    tripPoint: { findMany: vi.fn(async () => []) },
    tripRoute: { findUnique: vi.fn(async () => null) },
    viberListing: {
      findMany: vi.fn(async () => existing),
      create: vi.fn(async (args: { data: any }) => {
        const row = { id: 1, ...args.data };
        created.push(row);
        return row;
      }),
      update: vi.fn(async (args: { where: { id: number }; data: any }) => {
        const row = { id: args.where.id, ...args.data };
        updated.push(row);
        return row;
      }),
    },
  } as unknown as PrismaClient;
  return { prisma, created, updated };
}

test('нова поїздка на сьогодні — isActive:true, isPastDate:false', async () => {
  const { prisma, created } = makeStub();
  const today = new Date(); // isPastRideDate порівнює з реальним системним часом
  const r = await createOrMergeViberListing(prisma, baseInput({ date: today }));
  assert.equal(r.isPastDate, false);
  assert.equal(r.listing.isActive, true);
  assert.equal(r.isNew, true);
  assert.equal(created[0].isActive, true);
});

test('нова поїздка на вчора — архівується (isActive:false), isPastDate:true', async () => {
  const { prisma, created } = makeStub();
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 2); // напевно «вчора» в будь-якому TZ
  const r = await createOrMergeViberListing(prisma, baseInput({ date: yesterday, isActive: true }));
  assert.equal(r.isPastDate, true);
  assert.equal(r.listing.isActive, false);
  assert.equal(created[0].isActive, false);
});

test('мерж у минулу активну поїздку — стає isActive:false', async () => {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 2);
  const existingRow = {
    id: 42,
    listingType: 'driver',
    route: 'Kyiv-Malyn',
    date: yesterday,
    departureTime: '08:00',
    phone: '0501112233',
    personId: null,
    isActive: true, // раніше було активне (наприклад, ще до цього правила)
    notes: null,
    senderName: null,
    priceUah: null,
    rawMessage: 'old',
    source: 'Viber1',
    tripRouteId: null,
    fromPointId: null,
    toPointId: null,
  };
  const { prisma, updated } = makeStub([existingRow]);
  const r = await createOrMergeViberListing(
    prisma,
    baseInput({ date: yesterday, phone: '0501112233', isActive: true }),
  );
  assert.equal(r.isNew, false);
  assert.equal(r.isPastDate, true);
  assert.equal(r.listing.isActive, false);
  assert.equal(updated[0].isActive, false);
});

test('заборонений номер: оголошення не створюється, кидається PhoneBlockedError', async () => {
  const { prisma, created } = makeStub();
  // Стаб вище не має моделі person — додаємо її із заблокованим номером.
  (prisma as unknown as { person: unknown }).person = {
    findUnique: vi.fn(async () => ({ id: 7, phoneBlockedAt: new Date(), blockedAttemptAt: null })),
    update: vi.fn(async () => ({})),
  };

  await assert.rejects(
    () => createOrMergeViberListing(prisma, baseInput({ phone: '0501112233' })),
    (err: unknown) => isPhoneBlockedError(err),
  );
  assert.equal(created.length, 0, 'жодного оголошення створено не було');
});

test('незаблокований номер проходить як і раніше', async () => {
  const { prisma, created } = makeStub();
  (prisma as unknown as { person: unknown }).person = {
    findUnique: vi.fn(async () => ({ id: 7, phoneBlockedAt: null, blockedAttemptAt: null })),
    update: vi.fn(async () => ({})),
  };

  await createOrMergeViberListing(prisma, baseInput({ date: new Date() }));
  assert.equal(created.length, 1);
});

// ── «по дорозі»: пасажир Ірпінь/Буча ↔ Малин привʼязується до варіанта коридору Київ–Малин ──

function alongStub() {
  const points = [
    { id: 1, code: 'Kyiv', nameUk: 'Київ' },
    { id: 2, code: 'Malyn', nameUk: 'Малин' },
    { id: 5, code: 'Irpin', nameUk: 'Ірпінь' },
    { id: 6, code: 'Bucha', nameUk: 'Буча' },
  ];
  const routes = [
    { id: 4, slug: 'Kyiv-Malyn', corridorTripRouteId: null, stops: [1, 2] },
    { id: 8, slug: 'Kyiv-Malyn-Bucha', corridorTripRouteId: 4, stops: [1, 6, 2] },
    { id: 9, slug: 'Kyiv-Malyn-Irpin', corridorTripRouteId: 4, stops: [1, 5, 2] },
    { id: 1, slug: 'Malyn-Kyiv', corridorTripRouteId: null, stops: [2, 1] },
    { id: 12, slug: 'Malyn-Kyiv-Irpin', corridorTripRouteId: 1, stops: [2, 5, 1] },
  ].map((r) => ({ ...r, stops: r.stops.map((pointId, position) => ({ pointId, position })) }));
  const { prisma, created } = makeStub();
  const p = prisma as any;
  p.tripPoint.findMany = vi.fn(async () => points);
  p.tripRoute.findMany = vi.fn(async () => routes);
  return { prisma, created };
}

const passenger = (route: string, fromPointId: number, toPointId: number) =>
  baseInput({ listingType: 'passenger', route, fromPointId, toPointId });

test('пасажир Ірпінь→Малин (коридору Irpin-Malyn немає) — варіант «через Ірпінь»', async () => {
  const { prisma, created } = alongStub();
  await createOrMergeViberListing(prisma, passenger('Irpin-Malyn', 5, 2));
  assert.equal(created[0].tripRouteId, 9);
});

test('пасажир Буча→Малин — варіант «через Бучу»', async () => {
  const { prisma, created } = alongStub();
  await createOrMergeViberListing(prisma, passenger('Bucha-Malyn', 6, 2));
  assert.equal(created[0].tripRouteId, 8);
});

test('пасажир Малин→Ірпінь — зворотний варіант Малин–Київ через Ірпінь', async () => {
  const { prisma, created } = alongStub();
  await createOrMergeViberListing(prisma, passenger('Malyn-Irpin', 2, 5));
  assert.equal(created[0].tripRouteId, 12);
});

test('пара не лежить на жодному маршруті (Ірпінь→Буча) — без привʼязки', async () => {
  const { prisma, created } = alongStub();
  await createOrMergeViberListing(prisma, passenger('Irpin-Bucha', 5, 6));
  assert.equal(created[0].tripRouteId, null);
});

test('водій Ірпінь→Малин лишається без tripRouteId (інакше збирав би пасажирів із Києва)', async () => {
  const { prisma, created } = alongStub();
  await createOrMergeViberListing(
    prisma,
    baseInput({ listingType: 'driver', route: 'Irpin-Malyn', fromPointId: 5, toPointId: 2 }),
  );
  assert.equal(created[0].tripRouteId, null);
});
