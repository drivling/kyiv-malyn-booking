/**
 * createOrMergeViberListing: поїздки, дата яких уже минула (вчора чи раніше в Києві),
 * завжди зберігаються з isActive:false ("архів") — незалежно від джерела/викликача.
 */
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { createOrMergeViberListing, type ViberListingMergeInput } from './viber-listing-merge';

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
