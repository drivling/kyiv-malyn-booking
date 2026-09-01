/**
 * Юніт-тести ключу злиття (без Prisma).
 */
import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { ViberListing } from '@prisma/client';
import {
  buildMergedUpdateData,
  listingsAreMergeDuplicates,
} from './viber-listing-dedupe-after-update';

const base = {
  listingType: 'driver',
  route: 'Kyiv-Malyn',
  date: new Date('2026-04-20T12:00:00.000Z'),
  departureTime: '08:00',
  phone: '0501234567',
  personId: 1 as number | null,
};

test('listingsAreMergeDuplicates: той самий телефон у той самий день', () => {
  assert.equal(
    listingsAreMergeDuplicates(base, {
      ...base,
      phone: '050-123-45-67',
    }),
    true,
  );
});

test('listingsAreMergeDuplicates: різний день — false', () => {
  assert.equal(
    listingsAreMergeDuplicates(base, {
      ...base,
      date: new Date('2026-04-21T12:00:00.000Z'),
    }),
    false,
  );
});

test('listingsAreMergeDuplicates: той самий personId без збігу телефонів', () => {
  assert.equal(
    listingsAreMergeDuplicates(
      { ...base, phone: '', personId: 5 },
      { ...base, phone: '', personId: 5 },
    ),
    true,
  );
});

test('listingsAreMergeDuplicates: різний час — false', () => {
  assert.equal(
    listingsAreMergeDuplicates(base, { ...base, departureTime: '09:00' }),
    false,
  );
});

const row = (over: Partial<ViberListing> = {}): ViberListing =>
  ({
    id: 1,
    rawMessage: 'x',
    source: 'Viber1',
    senderName: null,
    listingType: 'driver',
    route: 'Kyiv-Malyn',
    tripRouteId: null,
    fromPointId: null,
    toPointId: null,
    date: new Date('2026-04-20T00:00:00.000Z'),
    departureTime: '08:00',
    seats: null,
    phone: '0501234567',
    notes: null,
    priceUah: null,
    isActive: true,
    personId: null,
    authorNotifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as ViberListing;

test('buildMergedUpdateData: authorNotifiedAt переноситься, якщо будь-який рядок сповіщено', () => {
  const t = new Date('2026-04-19T10:00:00.000Z');
  // survivor вже сповіщено — лишаємо його
  assert.equal(
    buildMergedUpdateData(row({ authorNotifiedAt: t }), row({ id: 2, authorNotifiedAt: null }))
      .authorNotifiedAt?.valueOf(),
    t.valueOf(),
  );
  // survivor ще ні, twin — так: беремо з twin
  assert.equal(
    buildMergedUpdateData(row({ authorNotifiedAt: null }), row({ id: 2, authorNotifiedAt: t }))
      .authorNotifiedAt?.valueOf(),
    t.valueOf(),
  );
  // жоден не сповіщений — null
  assert.equal(
    buildMergedUpdateData(row({ authorNotifiedAt: null }), row({ id: 2, authorNotifiedAt: null }))
      .authorNotifiedAt ?? null,
    null,
  );
});
