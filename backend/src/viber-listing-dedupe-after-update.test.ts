/**
 * Юніт-тести ключу злиття (без Prisma).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { listingsAreMergeDuplicates } from './viber-listing-dedupe-after-update';

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
