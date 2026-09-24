import { expect, test } from 'vitest';
import { toPublicListing } from './viber-listing-public';

test('toPublicListing не віддає телефон, сирий текст і службові поля', () => {
  const row = {
    id: 7,
    rawMessage: 'секрет',
    phone: '380501112233',
    personId: 42,
    authorNotifiedAt: new Date(),
    source: 'Viber1',
    senderName: 'Іван',
    listingType: 'driver',
    route: 'Kyiv-Malyn',
    tripRouteId: 1,
    fromPointId: 1,
    toPointId: 2,
    date: new Date('2026-12-01T00:00:00.000Z'),
    departureTime: '18:00',
    seats: 3,
    notes: null,
    priceUah: 250,
    isActive: true,
    createdAt: new Date('2026-11-30T10:00:00.000Z'),
    updatedAt: new Date('2026-11-30T10:00:00.000Z'),
  };
  const pub = toPublicListing(row) as Record<string, unknown>;
  expect(pub).not.toHaveProperty('phone');
  expect(pub).not.toHaveProperty('rawMessage');
  expect(pub).not.toHaveProperty('personId');
  expect(pub).not.toHaveProperty('authorNotifiedAt');
  expect(pub.date).toBe('2026-12-01T00:00:00.000Z');
  expect(pub.senderName).toBe('Іван');
  expect(pub.priceUah).toBe(250);
});
